"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/lib/language-context";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { setNotificationEnabled } from "@/components/NotificationToast";
import DownloadDataButton from "@/components/DownloadDataButton";
import { useDownloadBtnHidden, setDownloadBtnHidden } from "@/lib/download-btn-state";
import { Settings, Moon, Sun, Monitor, User, X, Eye, Key, MessageSquare, FileText, CheckCircle2, AlertTriangle, Cpu, Bell } from "lucide-react";
const FeedbackPanel = dynamic(() => import("@/components/FeedbackPanel"), { ssr: false, loading: () => null });
const SurveyPanel = dynamic(() => import("@/components/SurveyPanel"), { ssr: false, loading: () => null });

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

// ── 自定义通知开关（避免 Tailwind peer 全白渲染问题）───────────────
function NotifyToggle() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(localStorage.getItem("neuroaccess-notifications") !== "false");
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        setNotificationEnabled(next);
      }}
      className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
      style={{ backgroundColor: enabled ? "#10b981" : "rgba(115,115,115,0.35)" }}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        style={{ transform: enabled ? "translateX(20px)" : "translateX(0px)" }}
      />
    </button>
  );
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { lang, setLang, t } = useLang();
  const { theme, setTheme } = useTheme();
  const { user, token, logout, updateUser } = useAuth();
  const downloadHidden = useDownloadBtnHidden();

  const [showFeedback, setShowFeedback] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyLoginHint, setSurveyLoginHint] = useState(false);

  const [aiStatus, setAiStatus] = useState<{ online: boolean; model: string; mode: string } | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";


  // 点击遮罩关闭
  function handleOverlay(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // AI 状态
  useEffect(() => {
    if (!open) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setAiStatus({
          online: data.ai_online ?? false,
          model: data.ai_model || "—",
          mode: data.ai_mode || "API",
        });
      } catch {
        setAiStatus({ online: false, model: "—", mode: "API" });
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 30000);
    return () => clearInterval(id);
  }, [open]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex"
            onClick={handleOverlay}
          >
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

          {/* 面板：从左侧滑入 */}
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="relative z-10 w-80 max-w-full h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] shadow-2xl flex flex-col"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--color-border)]">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Settings className="w-4 h-4" />
                {t("settings")}
              </h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors"
              >
                <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* 主题 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("theme")}
                </h3>
                <div className="space-y-1">
                  <ThemeOption
                    icon={<Sun className="w-4 h-4" />}
                    label={t("lightMode")}
                    active={theme === "light"}
                    onClick={() => setTheme("light")}
                  />
                  <ThemeOption
                    icon={<Moon className="w-4 h-4" />}
                    label={t("darkMode")}
                    active={theme === "dark"}
                    onClick={() => setTheme("dark")}
                  />
                  <ThemeOption
                    icon={<Monitor className="w-4 h-4" />}
                    label={t("systemMode")}
                    active={theme === "system"}
                    onClick={() => setTheme("system")}
                  />
                </div>
              </section>

              {/* 语言 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("language")}
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  <LangBtn code="en" label="English" active={lang === "en"} onClick={() => setLang("en")} />
                  <LangBtn code="zh" label="中文" active={lang === "zh"} onClick={() => setLang("zh")} />
                  <LangBtn code="de" label="Deutsch" active={lang === "de"} onClick={() => setLang("de")} />
                  <LangBtn code="ja" label="日本語" active={lang === "ja"} onClick={() => setLang("ja")} />
                </div>
              </section>

              {/* 反馈 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("feedback")}
                </h3>
                <div className="rounded-xl bg-[var(--color-bg)]">
                  <button
                    onClick={() => setShowFeedback(true)}
                    className="w-full flex items-center justify-between p-3 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors rounded-xl"
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[var(--color-text-secondary)]" />
                      {t("feedback")}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">{t("clickToOpen")}</span>
                  </button>
                  <p className="px-3 pb-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)] opacity-60">
                    {t("feedbackHint")}
                  </p>
                </div>
          </section>

          {/* 问卷调查 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("surveyTitle")}
                </h3>
                <div className="rounded-xl bg-[var(--color-bg)]">
                  <button
                    onClick={() => {
                      if (!user || !token) {
                        setSurveyLoginHint(true);
                        setTimeout(() => setSurveyLoginHint(false), 3000);
                      } else {
                        setShowSurvey(true);
                      }
                    }}
                    className="w-full flex items-center justify-between p-3 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors rounded-xl"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--color-text-secondary)]" />
                      {t("surveyTitle")}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">{t("clickToOpen")}</span>
                  </button>
                  {surveyLoginHint && (
                    <p className="px-3 pb-2 text-xs text-amber-500 dark:text-amber-400">{t("surveyLoginRequired")}</p>
                  )}
                </div>
              </section>

          {/* 消息通知 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("notifications") || "Notifications"}
                </h3>
                <div className="rounded-xl bg-[var(--color-bg)] p-3 flex items-center justify-between">
                  <span className="text-sm flex items-center gap-2 text-[var(--color-text)]">
                    <Bell className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    {t("analysisCompleteNotify") || "Analysis complete notification"}
                  </span>
                  <NotifyToggle />
                </div>
              </section>

          {/* 下载数据（首页按钮隐藏后在此显示） */}
              {downloadHidden && (
                <section>
                  <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                    {t("downloadData")}
                  </h3>
                  <div className="space-y-2">
                    <DownloadDataButton />
                    <button
                      type="button"
                      onClick={() => setDownloadBtnHidden(false)}
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-xs py-2.5 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      {t("showDownloadBtn")}
                    </button>
                  </div>
                </section>
              )}

          {/* 关于 */}
              <section>
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  {t("about")}
                </h3>
                <div className="rounded-xl bg-[var(--color-bg)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {t("version")}
                    </span>
                    <span className="text-sm font-mono text-[var(--color-text)]">v2.5</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {t("projectPositioning")}
                    </span>
                    <span className="text-sm text-[var(--color-text)] text-right max-w-[60%]">
                      {t("projectDescription")}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[var(--color-border)]">
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                      {t("projectDescLong")}
                    </p>
                  </div>
                </div>
              </section>

              {/* AI 状态 — 仅未登录时显示 */}
              {!token && aiStatus && aiStatus.online && (
                <section>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] border-t border-[var(--color-border)] pt-4">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
                    <span className="text-green-700 dark:text-green-400">{aiStatus.model}</span>
                  </div>
                </section>
              )}

            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Feedback Modal — portal to document.body */}
    {showFeedback && typeof document !== 'undefined' && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowFeedback(false)} />
        <div className="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)]">
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            <h2 className="text-sm font-semibold">{t("feedback")}</h2>
            <button onClick={() => setShowFeedback(false)} className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <div className="p-5 space-y-6">
            <FeedbackPanel />
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Survey Modal — portal to document.body */}
    {showSurvey && typeof document !== 'undefined' && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSurvey(false)} />
        <div className="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)]">
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            <h2 className="text-sm font-semibold">{t("surveyTitle")}</h2>
            <button onClick={() => setShowSurvey(false)} className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <div className="p-5">
            <SurveyPanel />
          </div>
        </div>
      </div>,
      document.body
    )}
  </>)
}



function ThemeOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
        active
          ? "bg-[var(--color-text)] text-[var(--color-bg)] shadow-lg"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function LangBtn({
  code,
  label,
  active,
  onClick,
}: {
  code: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
        active
          ? "bg-[var(--color-text)] text-[var(--color-bg)] shadow-lg"
          : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-border)]"
      }`}
    >
      <span className="block text-[10px] opacity-60 uppercase leading-none mb-0.5">{code}</span>
      <span>{label}</span>
    </button>
  );
}
