"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useLang } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import { Shield, ExternalLink, LogOut } from "lucide-react";

export default function PostLoginModals() {
  const { t, lang } = useLang();
  const router = useRouter();
  const pathname = usePathname() || "/";
  const { user, token, termsAccepted, needsUsernameSetup, acceptTerms, setNeedsUsernameSetup, updateUser, logout } = useAuth();

  const [showTerms, setShowTerms] = useState(false);
  const [showUsernameSetup, setShowUsernameSetup] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedDisclaimer, setAgreedDisclaimer] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState("");

  // Check on mount and when user/token changes
  useEffect(() => {
    if (user && token) {
      if (!termsAccepted) {
        setShowTerms(true);
        setShowUsernameSetup(false);
      } else if (needsUsernameSetup) {
        setShowTerms(false);
        setShowUsernameSetup(true);
      } else {
        // 已登录且已同意条款 ⇒ 不再弹
        setShowTerms(false);
        setShowUsernameSetup(false);
      }
    } else {
      // 2026-10-18：**游客进入工作台时**要勾选免责声明 / 隐私政策 / 服务条款。
      //   只在首页（= 真正以游客身份使用）才要求：
      //   · 登录页 / 注册页不弹（用户还没选择进入游客模式，不该提前拦）
      //   · 其他内容页（案例库 / 知识库 / 模拟器）不弹，可以先逛
      // 用 sessionStorage 记本次访问内的同意（刷新不重复打扰）；
      // 退站后由 layout.tsx 的内联脚本（依据 na-last-hide > 30s）清掉 ⇒ 下次必须重新勾选。
      const onAuthPage = pathname.startsWith("/login") || pathname.startsWith("/register");
      const enterGuestMode = pathname === "/" || pathname === "/dashboard";
      let guestOk = false;
      try { guestOk = sessionStorage.getItem("na-guest-consent") === "true"; } catch {}
      setShowTerms(enterGuestMode && !onAuthPage && !guestOk);
      setShowUsernameSetup(false);
    }
  }, [user, token, termsAccepted, needsUsernameSetup, pathname]);

    const handleAcceptTerms = async () => {
      if (!agreedPrivacy || !agreedTerms || !agreedDisclaimer) return;
      // 游客：没有账号，不调后端 acceptTerms；只记本次访问的同意（退站即清）
      if (!user) {
        try { sessionStorage.setItem("na-guest-consent", "true"); } catch {}
        try { localStorage.setItem("neuroaccess-disclaimer-accepted", "true"); } catch {}
        try { window.dispatchEvent(new Event("neuroaccess:disclaimer-accepted")); } catch {}
        setShowTerms(false);
        return;
      }
      setTermsLoading(true);
    setTermsError("");
    try {
      const ok = await acceptTerms();
      if (ok) {
        // 若用户在弹窗中已勾选"免责声明"，同步写入独立免责声明存储，
        // 避免紧接着又弹出 DisclaimerModal 造成重复打扰。
        if (agreedDisclaimer) {
          try { localStorage.setItem("neuroaccess-disclaimer-accepted", "true"); } catch {}
        }
        // 通知已挂载的 DisclaimerModal 立即关闭，避免已打开的弹窗残留
        try { window.dispatchEvent(new Event("neuroaccess:disclaimer-accepted")); } catch {}
        setShowTerms(false);
        // Check if needs username setup
        if (needsUsernameSetup) {
          setShowUsernameSetup(true);
        }
      } else {
        setTermsError(t("networkError"));
      }
    } catch (e: any) {
      setTermsError(e.message || t("networkError"));
    } finally {
      setTermsLoading(false);
    }
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError("");
    const trimmed = username.trim();
    if (!trimmed || trimmed === "User") {
      setUsernameError(t("usernameInvalid"));
      return;
    }
    setUsernameLoading(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const resp = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await resp.json();
      if (data.success) {
        setShowUsernameSetup(false);
        setNeedsUsernameSetup(false);
        // Update user in context
        if (data.user) {
          updateUser(data.user);
        }
      } else {
        setUsernameError(data.error || t("failed"));
      }
    } catch (e: any) {
      setUsernameError(e.message || t("networkError"));
    } finally {
      setUsernameLoading(false);
    }
  };

  if (!showTerms && !showUsernameSetup) return null;

  return (
    <>
      {/* Terms Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-6 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">
                    {t("termsTitle")}
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {t("termsSubtitle")}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-3">
              {/* Privacy Policy */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                <input
                  type="checkbox"
                  checked={agreedPrivacy}
                  onChange={(e) => setAgreedPrivacy(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
                <div className="flex-1">
                  <span className="text-sm text-[var(--color-text)]">
                    {t("agreePrivacy")}{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {t("privacyPolicy")}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </span>
                </div>
              </label>

              {/* Terms of Service */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
                <div className="flex-1">
                  <span className="text-sm text-[var(--color-text)]">
                    {t("agreeTerms")}{" "}
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {t("termsOfService")}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </span>
                </div>
              </label>

              {/* Disclaimer */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                <input
                  type="checkbox"
                  checked={agreedDisclaimer}
                  onChange={(e) => setAgreedDisclaimer(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
                <div className="flex-1">
                  <span className="text-sm text-[var(--color-text)]">
                    {t("agreeDisclaimer")}{" "}
                    <Link
                      href="/disclaimer"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {t("disclaimer")}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </span>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div className="p-6 pt-4 border-t border-[var(--color-border)] flex flex-col gap-3">
              {termsError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-sm">
                  {termsError}
                </div>
              )}
              <button
                onClick={handleAcceptTerms}
                disabled={!agreedPrivacy || !agreedTerms || !agreedDisclaimer || termsLoading}
                className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {termsLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{t("analyzing")}</span>
                  </>
                ) : (
                  t("acceptTermsBtn")
                )}
              </button>
              {/* 不愿意接受条款的退出入口：清会话并回登录页，避免用户被锁死在弹窗里 */}
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                className="w-full min-h-[44px] py-2 px-4 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t("logout") || "退出登录"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Username Setup Modal */}
      {showUsernameSetup && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">
                    {t("setupUsername")}
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {t("setupUsernameHint")}
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleUsernameSubmit} className="p-6 space-y-4">
              {usernameError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-sm">
                  {usernameError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-[var(--color-text)]">
                  {t("username")}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("usernamePlaceholder")}
                  className="w-full px-3.5 py-2.5 rounded-xl border transition-colors bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)]/30"
                  autoFocus
                  required
                />
              </div>
              <button
                type="submit"
                disabled={usernameLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all"
              >
                {usernameLoading ? "..." : (t("confirm"))}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Content viewer removed — links now navigate to actual pages for consistency with footer */}
    </>
  );
}
