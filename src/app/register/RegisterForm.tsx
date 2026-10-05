"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLang } from "@/lib/language-context";
import Link from "next/link";
import { translations } from "@/lib/translations";
import AuthSettingsBar from "@/components/AuthSettingsBar";
import TurnstileModal from "@/components/TurnstileModal";

interface RegisterFormProps {
  lang: string;
}

export default function RegisterForm({ lang }: RegisterFormProps) {
  const router = useRouter();
  const { register, token } = useAuth();
  const { lang: ctxLang } = useLang();
  const effectiveLang = ctxLang || lang;

  // 已登录则重定向到首页：token 一旦设置即跳转，不等人机验证/对账流程完成。
  useEffect(() => {
    if (token) {
      router.push("/");
    }
  }, [token]);

  const tf = (key: string, fallback: string) => {
    const val = translations[effectiveLang as keyof typeof translations]?.[key];
    return val || fallback;
  };

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [codeSentMsg, setCodeSentMsg] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  // ── Turnstile 人机验证 ──
  const [turnstileOpen, setTurnstileOpen] = useState(false);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
  const pendingRegRef = useRef<{ username: string; email: string; password: string; code: string; inviteCode?: string } | null>(null);
  const turnstileRetryRef = useRef(0);
  const [devCode, setDevCode] = useState("");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, []);

  const handleSendCode = async () => {
    if (!email || countdown > 0 || sendingRef.current) return;
    // 发送前先校验邮箱格式，非法则本地提示，不发请求
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(tf("invalidEmail", "Please enter a valid email address") || "Please enter a valid email address");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError("");
    setCodeSentMsg(false);
    setDevCode("");
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/auth/register-verification-code`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }),
      });
      let data: any;
      try { data = await resp.json(); } catch { data = { detail: tf("sendCodeFailed", "Failed to send verification code") }; }
      if (resp.ok && data.success) {
        setCountdown(60);
        // email_sent 才是「邮件是否真的发出」的真源：SMTP 未配置/发送失败时后端仍返回
        // success=true（验证码已生成入库），但绝不能提示「验证码已发送到你的邮箱」。
        // 字段缺失视为已发送，兼容旧后端。
        const sentOk = !data.email_sent || data.email_sent === "sent";
        setCodeSentMsg(sentOk);
        if (!sentOk) setError(tf("sendCodeFailed", "Failed to send verification code"));
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setCountdown(prev => { if (prev <= 1) { clearInterval(countdownRef.current!); countdownRef.current = null; return 0; } return prev - 1; });
        }, 1000);
        if (process.env.NODE_ENV === "development" && data.dev_code) { setDevCode(data.dev_code); }
      } else {
        setCodeSentMsg(false);
        setError(data.detail || data.error || tf("sendCodeFailed", "Failed to send verification code"));
      }
    } catch (err: any) {
      setError(err.message || tf("networkErrorMsg", "Network error"));
    } finally { sendingRef.current = false; setSending(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError(tf("passwordMismatch", "Passwords do not match")); return; }
    setSubmitting(true);
    try {
      const result = await register(username, email, password, code, undefined, inviteCode);
      if (result.success) { router.push("/"); }
      else if (result.needsCaptcha) {
        pendingRegRef.current = { username, email, password, code, inviteCode };
        setTurnstileOpen(true);
      }
      else { setError(result.error || tf("registerFailed", "Registration failed")); }
    } catch (err: any) { setError(err.message || tf("networkErrorMsg", "Network error")); }
    finally { setSubmitting(false); }
  };

  // ── Turnstile 人机验证回调 ──
  const handleTurnstileVerify = async (cfToken: string) => {
    try {
      const pending = pendingRegRef.current;
      if (!pending) { setError(tf("verificationStateLost", "Verification state lost, please register again")); setTurnstileOpen(false); return; }
      const result = await register(pending.username, pending.email, pending.password, pending.code, cfToken, pending.inviteCode);
      if (result.success) { turnstileRetryRef.current = 0; window.location.assign("/"); }
      else if (result.needsCaptcha) {
        // token 无效/过期：保留 pending，重开验证弹窗重试；超过 3 次停止，避免无限闪烁
        turnstileRetryRef.current += 1;
        if (turnstileRetryRef.current >= 3) {
          pendingRegRef.current = null;
          setTurnstileOpen(false);
          setError(tf("verificationFailed", "Human verification failed, please try again"));
          return;
        }
        pendingRegRef.current = pending;
        setTurnstileOpen(false);
        setTimeout(function(){ setTurnstileOpen(true); }, 60);
        return;
      }
      else { setTurnstileOpen(false); setError(result.error || tf("registerFailed", "Registration failed")); }
      pendingRegRef.current = null;
    } catch (err: any) {
      pendingRegRef.current = null;
      setTurnstileOpen(false);
      setError(err.message || tf("networkErrorMsg", "Network error"));
    }
  };

  return (
    <motion.div className="min-h-full flex items-center justify-center bg-[var(--color-bg)] relative z-10 pb-16" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.05 }}>
      <div className="absolute top-4 right-4 z-20"><AuthSettingsBar /></div>
      <div className="w-full max-w-md p-5 sm:p-8 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] mx-3 sm:mx-auto">
        <div className="mb-6 p-3 rounded-xl bg-gradient-to-r from-blue-50/80 to-cyan-50/80 dark:from-blue-950/30 dark:to-cyan-950/30 border border-blue-200/50 dark:border-blue-800/30 text-xs leading-relaxed text-[var(--color-text)]">
          {tf("siteIntro", "")}
          <span className="mt-2 block font-semibold text-blue-600 dark:text-blue-400 text-[11px]">{tf("freePlatform", "")}</span>
        </div>
        <div className="text-center mb-8">
          <img src="/neuroaccess-logo.png" alt="NeuroAccess" width={48} height={48} className="w-12 h-12 rounded-xl mx-auto mb-3 object-cover" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">NeuroAccess</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{tf("register", "Register")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("username", "Username")}</label>
            <input type="text" value={username}
              onChange={(e) => {
                const v = e.target.value;
                setUsername(v); // 始终同步 state，避免显示值与提交值不一致
                if (v === "") { setError(tf("usernameRequired", "Please enter a username")); return; }
                const firstChar = Array.from(v)[0]||"";
                const isLetterStart = /^\p{L}/u.test(firstChar);
                if (!isLetterStart) { setError(tf("usernameMustStartWithLetter", "Username must start with a letter")); return; }
                if (/[!@#$%^&*()+\=\[\]{}|\\;:'"`/<>?~.,。]/.test(v)) { setError(tf("usernameNoSpecialChars", "Username cannot contain special characters")); return; }
                if (/\s{2,}/.test(v)) { setError(tf("noConsecutiveSpaces", "Username cannot have consecutive spaces")); return; }
                const vlen = Array.from(v).filter(ch => !/[\u0300-\u036f\u0483-\u0489]/.test(ch)).length;
                if (vlen >= 2 && vlen <= 20) { setError(""); }
                else if (vlen === 1) { setError(tf("usernameTooShort", "Username must be at least 2 characters")); }
                else if (vlen > 20) { setError(tf("usernameTooLong", "Username must be at most 20 characters")); }
              }}
              className="w-full px-3.5 py-2.5 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
              placeholder={tf("username", "Username")} required minLength={2} maxLength={20} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("email", "Email")}</label>
            <div className="flex gap-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="flex-1 px-3.5 py-2.5 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
                placeholder={tf("email", "Email")} required />
              <button type="button" onClick={handleSendCode} disabled={!email || countdown > 0 || sending}
                className="px-4 py-2.5 rounded-xl bg-[var(--color-primary)] text-[var(--color-bg)] text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap">
                {countdown > 0 ? `${countdown}s` : tf("sendCode", "Get code")}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("verificationCode", "Verification code")}</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
              placeholder={tf("verificationCode", "Verification code")} required maxLength={6} />
            {process.env.NODE_ENV === "development" && devCode && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                {tf("emailNotConfigured", "Email service not configured, dev code")}: <code className="font-mono font-bold text-base">{devCode}</code>
              </p>)}
            {codeSentMsg && (
              <p className="mt-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-2">
                {tf("codeSentToEmail", "Verification code sent to your email, valid for 10 minutes")}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("inviteCode", "School invite code (optional)")}</label>
            <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
              placeholder={tf("inviteCodePlaceholder", "e.g. NA-8F2C1A")} maxLength={16} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("password", "Password")}</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 pr-10 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
                placeholder={tf("password", "Password")} required minLength={6} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors" tabIndex={0} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">{tf("confirmPassword", "Confirm Password")}</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 pr-10 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
                placeholder={tf("confirmPassword", "Confirm Password")} required />
            </div>
          </div>
          {error && (<div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-sm">{error}</div>)}
          <button type="submit" disabled={submitting} className="w-full py-2.5 px-4 rounded-2xl bg-[var(--color-primary)] text-[var(--color-bg)] font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity">
            {submitting ? "..." : tf("registerButton", "Register")}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
          {tf("hasAccount", "Already have an account?")}{" "}
          <Link href="/login" className="font-medium underline underline-offset-2 hover:opacity-70 transition-opacity">{tf("login", "Login")}</Link>
        </div>
      </div>
      <TurnstileModal siteKey={turnstileSiteKey} open={turnstileOpen} onVerify={handleTurnstileVerify} onClose={() => { setTurnstileOpen(false); pendingRegRef.current = null; }} />
    </motion.div>
  );
}
