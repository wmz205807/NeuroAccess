"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";

interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "error";
  timestamp: number;
}

// 全局通知状态（模块级单例）
let _notifications: Notification[] = [];
let _listeners: Set<(ns: Notification[]) => void> = new Set();

function notify(listeners: Set<(ns: Notification[]) => void>) {
  listeners.forEach((l) => l([..._notifications]));
}

// 用 Web Audio API 合成简短通知音（避免外部资源）
function playTone(type: "success" | "error") {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("neuroaccess-notifications") === "false") return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    if (type === "success") {
      // C5 → E5 双音
      [523.25, 659.25].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, now + i * 0.12);
        g.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
        g.gain.linearRampToValueAtTime(0, now + i * 0.12 + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.12);
        o.stop(now + i * 0.12 + 0.18);
      });
    } else {
      // 失败：单音下滑
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(330, now);
      o.frequency.linearRampToValueAtTime(220, now + 0.25);
      g.gain.setValueAtTime(0.15, now);
      g.gain.linearRampToValueAtTime(0, now + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.3);
    }
  } catch (e) { /* 忽略音频错误 */ }
}

export function addNotification(message: string, type: "info" | "success" | "error" = "info") {
  const N = { id: Math.random().toString(36).slice(2), message, type, timestamp: Date.now() };
  _notifications = [..._notifications, N];
  notify(_listeners);
  if (type === "success" || type === "error") playTone(type);
  // 自动消除
  setTimeout(() => {
    _notifications = _notifications.filter((n) => n.id !== N.id);
    notify(_listeners);
  }, 5000);
}

// 通知 toast 层（放在 layout 里）
export default function NotificationToast() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("neuroaccess-notifications");
    if (stored === "false") setEnabled(false);
  }, []);

  useEffect(() => {
    const listener = (ns: Notification[]) => setNotifications(ns);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  if (!enabled) return null;

  return (
    /* 2026-10-15 反馈通道改造：
       · 宽度改为 min(24rem, 100vw-2rem)，小屏不再溢出
       · 配色改走设计 token（原来写死 emerald-950/red-950，浅色模式下会变成黑底）
       · 图标 + 左侧色条区分「成功 / 失败 / 提示」，扫一眼就能分辨
       · 补 role="status"/"alert" 与 aria-live，让读屏软件也能收到反馈 */
    <div className="fixed top-4 right-4 z-[10001] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {notifications.map((n) => {
          const isError = n.type === "error";
          const isSuccess = n.type === "success";
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              // 无障碍：错误用 role="alert"（立即播报），其余用 role="status"（礼貌播报）
              role={isError ? "alert" : "status"}
              aria-live={isError ? "assertive" : "polite"}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border border-l-2 bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] ${
                isError
                  ? "border-[var(--color-border)] border-l-[var(--color-danger)]"
                  : isSuccess
                    ? "border-[var(--color-border)] border-l-[var(--color-ok)]"
                    : "border-[var(--color-border)] border-l-[var(--color-primary)]"
              }`}
            >
              {isError ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" aria-hidden="true" />
              ) : isSuccess ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ok)]" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              )}
              <span className="flex-1 leading-relaxed">{n.message}</span>
              <button
                type="button"
                aria-label="Close notification"
                onClick={() => {
                  _notifications = _notifications.filter((x) => x.id !== n.id);
                  notify(_listeners);
                }}
                className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function isNotificationEnabled(): boolean {
  return localStorage.getItem("neuroaccess-notifications") !== "false";
}

export function setNotificationEnabled(enabled: boolean) {
  localStorage.setItem("neuroaccess-notifications", String(enabled));
}
