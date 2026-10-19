"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLang } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import { MessageSquare, Send, CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import { addNotification } from "@/components/NotificationToast";

/** 与后端 backend/app.py 的校验保持一致（超出会被拒） */
const MAX_FEEDBACK_LEN = 2000;
/** 快到上限时把计数器变成警示色，提前给反馈 */
const WARN_AT = 1800;

export interface FeedbackEntry {
  id: string;
  reportId: string;
  message: string; // free text
  timestamp: string;
}

const FEEDBACK_KEY = "neuroaccess-feedback";

function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFeedback(entries: FeedbackEntry[]) {
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries)); } catch {}
}

interface FeedbackPanelProps {
  reportId?: string;
}

export default function FeedbackPanel({ reportId }: FeedbackPanelProps) {
  const { t } = useLang();
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [sending, setSending] = useState(false);

  // 反馈携带登录 token，让后端能关联到账号（feedback.user_id）
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // 挂载时自动把上次因网络失败缓存在本地的反馈补传到服务器（防丢失）
  useEffect(() => {
    const pending = loadFeedback();
    if (!pending.length) return;
    (async () => {
      const remaining: FeedbackEntry[] = [];
      let retried = 0;
      for (const entry of pending) {
        try {
          const resp = await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ name: "", email: "", type: entry.reportId ? "report" : "general", message: entry.message, rating: "" }),
          });
          const data = await resp.json().catch(() => null);
          if (resp.ok && data && data.success === true) retried++;
          else remaining.push(entry);
        } catch {
          remaining.push(entry);
        }
      }
      saveFeedback(remaining); // 成功的移除，失败的保留待下次
      if (retried > 0) console.log(`[Feedback] 已补传 ${retried} 条离线反馈`);
    })();
  }, []);

  const handleSubmit = async () => {
    const message = text.trim();
    // 2026-10-15：加 submitting 门闩 —— 此前是异步提交但按钮不锁，可以连点重复提交
    if (!message || sending || message.length > MAX_FEEDBACK_LEN) return;
    setSending(true);

    const payload = {
      name: "",
      email: "",
      type: reportId ? "report" : "general",
      message,
      rating: "",
    };

    let delivered = false;
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => null);
      // 后端超长/超限等错误也返回 HTTP 200 + success:false，必须检查 success
      delivered = Boolean(resp.ok && data && data.success === true);
    } catch {
      delivered = false;
    }

    if (delivered) {
      addNotification(t("feedbackThankYou"), "success");
    } else {
      // 没送达就落本地、下次挂载自动补传 —— 但绝不假装成功
      // （此前无论成功失败都只显示「感谢」，超 2000 字的反馈会静默丢失）
      const entry: FeedbackEntry = {
        id: `${reportId || "general"}_${Date.now()}`,
        reportId: reportId || "general",
        message,
        timestamp: new Date().toISOString(),
      };
      const entries = loadFeedback();
      entries.unshift(entry);
      saveFeedback(entries);
      setSavedLocally(true);
      addNotification(
        t("feedbackSavedLocally") || "已暂存到本地，恢复后会重试发送",
        "info",
      );
    }

    setSending(false);
    setSubmitted(true);
  };

  const canSubmit =
    text.trim().length > 0 && text.trim().length <= MAX_FEEDBACK_LEN && !sending;

  if (submitted) {
    // 2026-10-15：区分「已送达」与「仅暂存本地」—— 此前两种情况都显示绿色「感谢」，
    // 而被后端拒收（如超 2000 字）的反馈会让用户误以为已经提交成功。
    // 配色也从写死的 emerald 改走设计 token，跟随主题。
    return (
      <motion.div
        role="status"
        aria-live="polite"
        className={`rounded-2xl border bg-[var(--color-surface)] p-8 text-center ${
          savedLocally ? "border-[var(--color-warn)]" : "border-[var(--color-ok)]"
        }`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        {savedLocally ? (
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-[var(--color-warn)]" aria-hidden="true" />
        ) : (
          <CheckCircle className="mx-auto mb-3 h-10 w-10 text-[var(--color-ok)]" aria-hidden="true" />
        )}
        <p className="text-sm font-medium text-[var(--color-text)]">
          {savedLocally
            ? t("feedbackSavedLocally") || "已暂存到本地，恢复后会重试发送"
            : t("feedbackThankYou")}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="mb-5 flex items-center gap-3">
        <MessageSquare className="h-5 w-5 text-[var(--color-text-secondary)]" />
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">{t("feedbackTitle")}</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">{t("feedbackSubtitle")}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={MAX_FEEDBACK_LEN}
            placeholder={t("feedbackPlaceholder")}
            aria-label={t("feedbackTitle")}
            className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/50 focus:border-[var(--color-primary)]/30 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/10"
          />
          {/* 字数反馈：此前完全没有长度提示，而超过 2000 字后端会直接拒收、
              前端却照样显示「感谢」—— 现在提前告知并在服务端上限处硬截断 */}
          <div className="mt-1.5 flex justify-end">
            <span
              aria-live="polite"
              className={`font-mono text-[11px] tabular-nums ${
                text.length > WARN_AT
                  ? "text-[var(--color-warn)]"
                  : "text-[var(--color-text-secondary)] opacity-70"
              }`}
            >
              {text.length} / {MAX_FEEDBACK_LEN}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-busy={sending}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-6 py-2.5 text-sm font-medium text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {t("feedbackSubmit")}
        </button>
      </div>
    </motion.div>
  );
}
