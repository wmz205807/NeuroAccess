"use client";

import { useEffect, useState, useRef } from "react";
import FloatingField from "@/components/ui/FloatingField";
import CodeInput from "@/components/ui/CodeInput";
import AvatarEditor from "@/components/ui/AvatarEditor";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLang } from "@/lib/language-context";
import { t } from "@/lib/translations";
import { getDisplayInitial } from "@/lib/display-initial";
import { ArrowLeft, User, Key, Mail, AlertTriangle, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";


const AVATAR_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6",
];

/**
 * 后端 email_sent 才是「邮件是否真的发出」的唯一真源（'sent' / 'not_configured' / 'failed'）。
 * 接口的 success 只代表验证码已生成入库 —— SMTP 挂了也照样是 success。
 * 所以这里必须单独看 email_sent，否则会骗用户「验证码已发送到你的邮箱」。
 * 字段缺失（旧后端）视为已发送，保证向后兼容。
 */
const emailSentOk = (emailSent?: string) => !emailSent || emailSent === "sent";

export default function AccountPage() {
  const { user, token, logout, updateUser, updateProfile, changePassword, sendVerificationCode, updateEmail, sendOldEmailCode, verifyOldEmail, sendDeleteAccountCode, deleteAccount, loading } = useAuth();
  const { lang } = useLang();
  const router = useRouter();

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

  // 主动登出/注销时先立旗：否则下面「!user → /login」会抢在业务代码的 router.push 之前触发，
  // 使「退出登录」落到 /login（代码本意是回首页），注销成功的「账号已注销」提示也来不及显示就被弹走。
  const leavingRef = useRef(false);

  // Redirect if not logged in (but wait for loading to finish)
  useEffect(() => {
    if (!loading && !user && !leavingRef.current) router.push("/login");
  }, [loading, user, router]);

  // 防连点: 所有发送验证码都用同一个 ref
  const codeSendingRef = useRef(false);

  // ---------- 编辑资料 ----------
  // 兼容旧默认值 'blue'（数据库老默认值），归一化为色板里的 #3B82F6
  const normalizeAvatarColor = (c?: string) =>
    c === "blue" ? "#3B82F6" : (c && AVATAR_COLORS.includes(c) ? c : AVATAR_COLORS[0]);
  const [editUsername, setEditUsername] = useState(user?.username || "");
  const [editAvatarUrl, setEditAvatarUrl] = useState(normalizeAvatarColor(user?.avatar_color));
  // 2026-11-05（用户要求）：除预设颜色外支持自定义头像图片
  const [avatarImage, setAvatarImage] = useState(user?.avatar_url || "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarEditFile, setAvatarEditFile] = useState<File | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");

  // 实时校验 username（保证保存按钮可正确禁用）
  const validateUsername = (v: string): { ok: boolean; error: string } => {
    if (!v || v === "") {
      return { ok: false, error: t(lang, "usernameRequired") };
    }
    // 第一个字符必须是文字
    const firstChar = getDisplayInitial(v);
    const isLetterStart = /^\p{L}/u.test(firstChar);
    if (!isLetterStart) {
      return { ok: false, error: t(lang, "usernameMustStartWithLetter") };
    }
    // 禁止特殊符号（允许字母/数字/空格/中日韩/emoji/下划线/连字符）
    if (/[!@#$%^&*()+\=\[\]{}|\\;:'"`/<>?~.,。]/.test(v)) {
      return { ok: false, error: t(lang, "usernameNoSpecialChars") };
    }
    // 禁止连续空格
    if (/\s{2,}/.test(v)) {
      return { ok: false, error: t(lang, "noConsecutiveSpaces") };
    }
    // 视觉长度 1-20
    const vlen = Array.from(v).filter(ch => !/[\u0300-\u036f\u0483-\u0489]/.test(ch)).length;
    if (vlen < 1) {
      return { ok: false, error: t(lang, "usernameRequired") };
    }
    if (vlen < 2) {
      return { ok: false, error: t(lang, "usernameTooShort") };
    }
    if (vlen > 20) {
      return { ok: false, error: t(lang, "usernameTooLong") };
    }
    return { ok: true, error: "" };
  };

  const usernameValidation = validateUsername(editUsername);

  useEffect(() => {
    if (user) {
      setEditUsername(user.username || "");
      setEditAvatarUrl(normalizeAvatarColor(user?.avatar_color));
      setAvatarImage(user?.avatar_url || "");
    }
  }, [user]);

  // 选图后先进编辑器（拖动/缩放），确认再上传
  const handleAvatarPick = (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setEditError("只支持 PNG / JPG / WEBP 图片");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setEditError("图片不能超过 2MB");
      return;
    }
    setEditError("");
    setAvatarEditFile(file);
  };

  // 上传编辑后的头像（后端只收 png/jpg/webp，≤2MB）
  const uploadAvatarBlob = async (blob: Blob) => {
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("file", new File([blob], "avatar.png", { type: "image/png" }));
      const resp = await fetch(`${API_BASE}/api/account/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const r = await resp.json();
      if (r.success && r.avatar_url) {
        // 只更新预览；真正入库要等用户点下面的「保存」
        setAvatarImage(r.avatar_url);
        setAvatarEditFile(null);
      } else {
        setEditError(r.error || "上传失败");
      }
    } catch (e: any) {
      setEditError(e.message || "上传失败");
    }
    setAvatarUploading(false);
  };

  const submitProfileUpdate = async () => {
    setEditError("");
    setEditSuccess("");
    // 客户端再次校验：未通过则直接拒绝提交
    const v = validateUsername(editUsername);
    if (!v.ok) {
      setEditError(v.error);
      return;
    }
    setEditLoading(true);
    try {
      const result = await updateProfile({ username: editUsername, avatar_color: editAvatarUrl, avatar_url: avatarImage });
      if (result.success) {
        setEditSuccess(t(lang, "profileUpdated"));
        // 更新本地用户状态
        if (user) {
          const updated = { ...user, username: editUsername, avatar_color: editAvatarUrl, avatar_url: avatarImage };
          updateUser(updated);
        }
      } else {
        setEditError(result.error || t(lang, "failedToUpdateProfile"));
      }
    } catch (e: any) {
      setEditError(e.message || t(lang, "failedToUpdateProfile"));
    }
    setEditLoading(false);
  };

  // ---------- 修改密码 ----------
  const [pwCode, setPwCode] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwShowNew, setPwShowNew] = useState(false);
  const [pwShowConfirm, setPwShowConfirm] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwCountdown, setPwCountdown] = useState(0);

  useEffect(() => {
    if (pwCountdown <= 0) return;
    const t = setTimeout(() => setPwCountdown(pwCountdown - 1), 1000);
    return () => clearTimeout(t);
  }, [pwCountdown]);

  const sendPwCode = async () => {
    if (codeSendingRef.current) return;
    codeSendingRef.current = true;
    setPwError("");
    setPwLoading(true);
    try {
      const result = await sendVerificationCode({});
      if (result.success) {
        // 2026-11-06：只有邮件真的发出去才进倒计时；失败时不要锁住按钮（否则用户要白等 60 秒）
        if (emailSentOk(result.emailSent)) {
          setPwCountdown(60);
          setPwSuccess(t(lang, "codeSentToEmail"));
        } else {
          setPwError(t(lang, "sendCodeFailed"));
        }
      } else {
        setPwError(result.error || t(lang, "sendCodeFailed"));
      }
    } catch (e: any) {
      setPwError(e.message || t(lang, "networkError"));
    } finally {
      setPwLoading(false);
      codeSendingRef.current = false;
    }
  };

  const submitPwChange = async () => {
    setPwError("");
    setPwSuccess("");
    if (pwNew !== pwConfirm) {
      setPwError(t(lang, "passwordMismatch"));
      return;
    }
    if (pwNew.length < 6) {
      setPwError(t(lang, "passwordTooShort"));
      return;
    }
    if (!pwCode) {
      setPwError(t(lang, "verificationCodeRequired"));
      return;
    }
    setPwLoading(true);
    try {
      const result = await changePassword({ verification_code: pwCode, new_password: pwNew });
      if (result.success) {
        setPwSuccess(t(lang, "passwordChanged"));
        setPwCode("");
        setPwNew("");
        setPwConfirm("");
      } else {
        setPwError(result.error || t(lang, "failedToChangePasswordMsg"));
      }
    } catch (e: any) {
      setPwError(e.message || t(lang, "failedToChangePasswordMsg"));
    }
    setPwLoading(false);
  };

  // ---------- 修改邮箱（两步验证） ----------
  // Step 1: 验证旧邮箱
  const [oldEmailVerified, setOldEmailVerified] = useState(false);
  const [oldEmailCode, setOldEmailCode] = useState("");
  const [oldEmailLoading, setOldEmailLoading] = useState(false);
  const [oldEmailCountdown, setOldEmailCountdown] = useState(0);

  useEffect(() => {
    if (oldEmailCountdown <= 0) return;
    const t2 = setTimeout(() => setOldEmailCountdown(oldEmailCountdown - 1), 1000);
    return () => clearTimeout(t2);
  }, [oldEmailCountdown]);

  const handleSendOldEmailCode = async () => {
    if (codeSendingRef.current) return;
    codeSendingRef.current = true;
    setEmailError(""); setOldEmailLoading(true);
    try {
      const result = await sendOldEmailCode();
      if (result.success) {
        if (emailSentOk(result.emailSent)) {
          setOldEmailCountdown(60);
          setEmailSuccess(t(lang, "codeSentToEmail"));
        } else {
          setEmailError(t(lang, "sendCodeFailed"));
        }
      } else {
        setEmailError(result.error || t(lang, "sendCodeFailed"));
      }
    } catch (e: any) {
      setEmailError(e.message || t(lang, "networkError"));
    } finally {
      codeSendingRef.current = false;
    }
    setOldEmailLoading(false);
  };

  const handleVerifyOldEmail = async () => {
    setEmailError(""); setEmailSuccess("");
    if (!oldEmailCode) { setEmailError(t(lang, "verificationCodeRequired")); return; }
    setOldEmailLoading(true);
    try {
      const result = await verifyOldEmail(oldEmailCode);
      if (result.success) {
        setOldEmailVerified(true);
        setEmailSuccess(t(lang, "oldEmailVerified"));
      } else {
        setEmailError(result.error || t(lang, "verificationCodeFailed"));
      }
    } catch (e: any) {
      setEmailError(e.message || t(lang, "verificationCodeFailed"));
    }
    setOldEmailLoading(false);
  };

  // Step 2: 设置新邮箱（原流程）
  const [emailNew, setEmailNew] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const [emailCountdown, setEmailCountdown] = useState(0);

  useEffect(() => {
    if (emailCountdown <= 0) return;
    const t2 = setTimeout(() => setEmailCountdown(emailCountdown - 1), 1000);
    return () => clearTimeout(t2);
  }, [emailCountdown]);

  const sendEmailCode = async () => {
    if (codeSendingRef.current) return;
    codeSendingRef.current = true;
    setEmailError("");
    if (!emailNew || !emailNew.includes("@")) {
      setEmailError(t(lang, "validEmailRequired"));
      return;
    }
    setEmailLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/send-email-change-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({ new_email: emailNew }),
      });
      let result: any;
      try {
        result = await resp.json();
      } catch {
        result = { detail: t(lang, "sendCodeFailed") };
      }
      if (resp.ok && result.success) {
        if (emailSentOk(result.email_sent)) {
          setEmailCountdown(60);
          setEmailSuccess(t(lang, "codeSentToEmail"));
        } else {
          setEmailError(t(lang, "sendCodeFailed"));
        }
      } else {
        setEmailError(result.detail || result.error || t(lang, "sendCodeFailed"));
      }
    } catch (e: any) {
      setEmailError(e.message || t(lang, "networkError"));
    } finally {
      codeSendingRef.current = false;
    }
    setEmailLoading(false);
  };

  const submitEmailChange = async () => {
    setEmailError("");
    setEmailSuccess("");
    if (!emailCode) {
      setEmailError(t(lang, "verificationCodeRequired"));
      return;
    }
    setEmailLoading(true);
    try {
      const result = await updateEmail({ new_email: emailNew, verification_code: emailCode });
      if (result.success) {
        setEmailSuccess(t(lang, "emailUpdated"));
        setEmailNew("");
        setEmailCode("");
        setOldEmailVerified(false); // reset for next time
      } else {
        setEmailError(result.error || t(lang, "failedToChangeEmail"));
      }
    } catch (e: any) {
      setEmailError(e.message || t(lang, "failedToChangeEmail"));
    }
    setEmailLoading(false);
  };

  // ---------- 注销账号 ----------
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState("");

  const sendDeleteCode = async () => {
    if (codeSendingRef.current) return;
    codeSendingRef.current = true;
    setDeleteError("");
    setDeleteLoading(true);
    try {
      const result = await sendDeleteAccountCode();
      if (result.success) {
        if (emailSentOk(result.emailSent)) setDeleteSuccess(t(lang, "codeSentToEmail"));
        else setDeleteError(t(lang, "sendCodeFailed"));
      } else {
        setDeleteError(result.error || t(lang, "sendCodeFailed"));
      }
    } catch (e: any) {
      setDeleteError(e.message || t(lang, "networkError"));
    } finally {
      codeSendingRef.current = false;
    }
    setDeleteLoading(false);
  };

  const submitDeleteAccount = async () => {
    setDeleteError("");
    setDeleteSuccess("");
    if (!deleteCode) {
      setDeleteError(t(lang, "verificationCodeRequired"));
      return;
    }
    const confirmMsg = t(lang, "deleteAccountConfirm");
    if (!window.confirm(confirmMsg)) {
      return;
    }
    // 先立旗：deleteAccount 内部成功时会立刻 setUser(null)，否则本页的 !user → /login 会抢先跳走
    leavingRef.current = true;
    setDeleteLoading(true);
    try {
      const result = await deleteAccount({ verification_code: deleteCode });
      if (result.success) {
        setDeleteSuccess(t(lang, "accountDeleted"));
        setTimeout(() => { logout(); router.push("/login"); }, 1500);
      } else {
        leavingRef.current = false;
        setDeleteError(result.error || t(lang, "failedToDeleteAccount"));
      }
    } catch (e: any) {
      leavingRef.current = false;
      setDeleteError(e.message || t(lang, "failedToDeleteAccount"));
    }
    setDeleteLoading(false);
  };

  // 注销成功的瞬间 user 已被清空，但本页还要停留 1.5s 把「账号已注销」提示显示给用户。
  // 若此处仍按 !user 兜底成 loading 骨架，提示会被整个替换掉、用户根本看不到。
  if (loading || (!user && !deleteSuccess)) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-[var(--color-text-secondary)]">{t(lang, "loading")}</div>
      </div>
    );
  }

  return (
    <motion.div
      className="min-h-screen bg-[var(--color-bg)] overflow-y-auto"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 0.8, 0.22, 1] }}
    >
      {/* Header */}
      <header className="h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-4">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">{t(lang, "back")}</span>
        </button>
        <span className="ml-4 text-sm font-semibold text-[var(--color-text)]">
          {t(lang, "accountSettings")}
        </span>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6 pb-[env(safe-area-inset-bottom,16px)]">
        {/* 1. 编辑资料 */}
        <section className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <User className="w-4 h-4" />
              {t(lang, "editProfile")}
            </h3>
          </div>
          <div className="p-5 space-y-4">
            {/* 大号头像预览 */}
            <div className="flex justify-center mb-2">
              <button
                type="button"
                onClick={async () => {
                  if (avatarImage) {
                    try {
                      const resp = await fetch(avatarImage);
                      const blob = await resp.blob();
                      setAvatarEditFile(new File([blob], "avatar.png", { type: blob.type || "image/png" }));
                    } catch {
                      avatarFileRef.current?.click();
                    }
                  } else {
                    avatarFileRef.current?.click();
                  }
                }}
                title="点击编辑头像"
                aria-label="点击编辑头像"
                className="rounded-full transition-transform hover:scale-105 focus-visible:outline-none"
              >
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold border-4 border-[var(--color-border)] overflow-hidden"
                style={{ backgroundColor: avatarImage ? "#0b111c" : (editAvatarUrl || "#3B82F6") }}
              >
                {avatarImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarImage} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  getDisplayInitial(editUsername || user?.username || "?")
                )}
              </div>
              </button>
            </div>
            {/* 头像颜色选择 */}
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-2">
                {t(lang, "avatarColor")}
              </label>
              <div className="flex flex-row gap-4 flex-wrap justify-center">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => { setEditAvatarUrl(color); setAvatarImage(""); }}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold transition-all shrink-0 ${
                      editAvatarUrl === color && !avatarImage ? "ring-2 ring-offset-2 ring-[var(--color-primary)] scale-125" : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {getDisplayInitial(editUsername || user?.username || "?")}
                  </button>
                ))}
                {/* 2026-11-05：自定义头像图片上传 */}
                <button
                  type="button"
                  onClick={() => avatarFileRef.current?.click()}
                  disabled={avatarUploading}
                  title="上传自定义头像"
                  aria-label="上传自定义头像"
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 border-dashed transition-all ${
                    avatarImage ? "border-[var(--color-primary)] text-[var(--color-primary)] scale-110" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  } disabled:opacity-50`}
                >
                  {avatarUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  )}
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { handleAvatarPick(e.target.files?.[0] || null); e.currentTarget.value = ""; }}
                />
              </div>
            </div>
            {/* 用户名 */}
            <FloatingField
              id="acct-username"
              label={t(lang, "username")}
              value={editUsername}
              onChange={(v) => {
                // 实时同步到 state 并显示错误（不阻塞输入）
                setEditUsername(v);
                const result = validateUsername(v);
                if (!result.ok) {
                  setEditError(result.error);
                } else {
                  setEditError("");
                }
              }}
              autoComplete="username"
              tone="subtle"
            />
            {/* 保存按钮 */}
            <button
              onClick={submitProfileUpdate}
              disabled={editLoading || !usernameValidation.ok}
              className="w-full rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editLoading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <>{t(lang, "save")}</>
              )}
            </button>
            {editError && <p className="text-xs text-red-500 dark:text-red-400">{editError}</p>}
            {editSuccess && <p className="text-xs text-emerald-500 dark:text-emerald-400">{editSuccess}</p>}
          </div>
        </section>

        {/* 2. 修改密码 */}
        <section className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Key className="w-4 h-4" />
              {t(lang, "changePassword")}
            </h3>
          </div>
          <div className="p-5 space-y-4">
            {/* 验证码 */}
            <div className="flex gap-2">
                <div className="flex-1">
                  <CodeInput
                    value={pwCode}
                    onChange={setPwCode}
                    label={t(lang, "verificationCode")}
                    tone="subtle"
                  />
                </div>
                <button
                  onClick={sendPwCode}
                  disabled={pwLoading || pwCountdown > 0}
                  className="self-stretch rounded-xl border border-[var(--color-border)] px-4 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {pwCountdown > 0 ? `${pwCountdown}s` : (t(lang, "sendCode"))}
                </button>
              </div>
            {/* 新密码 */}
            <FloatingField
              id="acct-pw-new"
              label={t(lang, "newPassword")}
              type={pwShowNew ? "text" : "password"}
              value={pwNew}
              onChange={setPwNew}
              autoComplete="new-password"
              tone="subtle"
              right={
                <button type="button" onClick={() => setPwShowNew(!pwShowNew)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--color-text-secondary)]"
                  aria-label={pwShowNew ? "Hide password" : "Show password"}>
                  {pwShowNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            {/* 确认密码 */}
            <FloatingField
              id="acct-pw-confirm"
              label={t(lang, "confirmPassword")}
              type={pwShowConfirm ? "text" : "password"}
              value={pwConfirm}
              onChange={setPwConfirm}
              autoComplete="new-password"
              tone="subtle"
              right={
                <button type="button" onClick={() => setPwShowConfirm(!pwShowConfirm)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--color-text-secondary)]"
                  aria-label={pwShowConfirm ? "Hide password" : "Show password"}>
                  {pwShowConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            {/* 修改按钮 */}
            <button
              onClick={submitPwChange}
              disabled={pwLoading}
              className="w-full rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] transition-colors hover:opacity-90 disabled:opacity-40"
            >
              {pwLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden="true" /> : (t(lang, "changePassword"))}
            </button>
            {pwError && <p className="text-xs text-red-500 dark:text-red-400">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-emerald-500 dark:text-emerald-400">{pwSuccess}</p>}
          </div>
        </section>

        {/* 3. 修改邮箱（两步验证） */}
        <section className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Mail className="w-4 h-4" />
              {t(lang, "changeEmail")}
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {t(lang, "currentEmail")}: <span className="text-[var(--color-text)]">{user?.email}</span>
            </p>

            {/* Step 1: 验证旧邮箱 */}
            {!oldEmailVerified && (
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 p-4 space-y-3">
                <p className="text-xs font-medium text-[var(--color-text)]">{t(lang, "verifyCurrentEmail")}</p>
                <button onClick={handleSendOldEmailCode} disabled={oldEmailLoading || oldEmailCountdown > 0}
                  className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-40">
                  {oldEmailCountdown > 0 ? `${oldEmailCountdown}s` : (t(lang, "sendCodeToCurrentEmail"))}
                </button>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <CodeInput
                      value={oldEmailCode}
                      onChange={setOldEmailCode}
                      label={t(lang, "enterCode")}
                      tone="subtle"
                    />
                  </div>
                  <button onClick={handleVerifyOldEmail} disabled={oldEmailLoading || !oldEmailCode}
                    className="self-stretch rounded-xl bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-bg)] hover:opacity-90 disabled:opacity-40">
                    {oldEmailLoading ? "..." : t(lang, "verify")}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: 设置新邮箱（旧邮箱验证通过后显示） */}
            {oldEmailVerified && (
              <>
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">{t(lang, "oldEmailVerified")}</p>
                </div>
                {/* 新邮箱 */}
                <div className="flex gap-2">
                    <FloatingField
                      id="acct-new-email"
                      label={t(lang, "newEmail")}
                      type="email"
                      value={emailNew}
                      onChange={setEmailNew}
                      autoComplete="email"
                      inputMode="email"
                      tone="subtle"
                      className="flex-1"
                    />
                    <button onClick={sendEmailCode} disabled={emailLoading || emailCountdown > 0}
                      className="self-stretch rounded-xl border border-[var(--color-border)] px-4 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-40 whitespace-nowrap">
                      {emailCountdown > 0 ? `${emailCountdown}s` : (t(lang, "sendCode"))}
                    </button>
                  </div>
                {/* 验证码 */}
                <CodeInput
                  value={emailCode}
                  onChange={setEmailCode}
                  label={t(lang, "verificationCode")}
                  tone="subtle"
                />
                <button onClick={submitEmailChange} disabled={emailLoading}
                  className="w-full rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] transition-colors hover:opacity-90 disabled:opacity-40">
                  {emailLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden="true" /> : (t(lang, "confirmChange"))}
                </button>
              </>
            )}

            {emailError && <p className="text-xs text-red-500 dark:text-red-400">{emailError}</p>}
            {emailSuccess && <p className="text-xs text-emerald-500 dark:text-emerald-400">{emailSuccess}</p>}
          </div>
        </section>

        {/* 4. 注销账号 */}
        <section className="rounded-2xl bg-[var(--color-surface)] border-2 border-red-300 dark:border-red-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-red-300 dark:border-red-700">
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {t(lang, "deleteAccount")}
            </h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="rounded-xl bg-red-50 dark:bg-red-950/30 p-4">
              <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                {t(lang, "deleteAccountWarning")}
              </p>
            </div>
            {/* 发送验证码 */}
            <button
              onClick={sendDeleteCode}
              disabled={deleteLoading}
              className="w-full rounded-xl border border-red-300 dark:border-red-700 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
            >
              {t(lang, "sendCodeToCurrentEmail")}
            </button>
            {/* 验证码 */}
            <CodeInput
              value={deleteCode}
              onChange={setDeleteCode}
              label={t(lang, "verificationCode")}
              tone="subtle"
            />
            {/* 注销按钮 */}
            <button
              onClick={submitDeleteAccount}
              disabled={deleteLoading}
              className="w-full rounded-xl bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 dark:hover:bg-red-800 disabled:opacity-40"
            >
              {deleteLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden="true" /> : (t(lang, "confirmDeleteAccount"))}
            </button>
            {deleteError && <p className="text-xs text-red-500 dark:text-red-400">{deleteError}</p>}
            {deleteSuccess && <p className="text-xs text-emerald-500 dark:text-emerald-400">{deleteSuccess}</p>}
          </div>
        </section>

        {/* 退出登录 */}
        <div className="pt-4">
          <button
            onClick={() => { leavingRef.current = true; logout(); router.push("/login"); }}
            className="w-full rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors"
          >
            {t(lang, "logout")}
          </button>
        </div>
      </div>

      {/* 头像编辑器：选图后先调整位置/缩放，确认再上传 */}
      {avatarEditFile && (
        <AvatarEditor
          file={avatarEditFile}
          busy={avatarUploading}
          onCancel={() => setAvatarEditFile(null)}
          onConfirm={uploadAvatarBlob}
        />
      )}
    </motion.div>
  );
}
