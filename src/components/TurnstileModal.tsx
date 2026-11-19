"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/language-context";

interface Props {
  siteKey: string;
  open: boolean;
  onVerify: (token: string) => void;
  onClose?: () => void;
}

export default function TurnstileModal({ siteKey, open, onVerify, onClose }: Props) {
  const { t } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cbName = useRef(`__turnstile_cb_${Date.now()}`);
  const expName = useRef(`__turnstile_exp_${Date.now()}`);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 2026-10-25：验证卡住时必须给用户明确反馈 + 重试入口（之前是无限转圈，用户以为"没反应")
  const [errMsg, setErrMsg] = useState("");
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !siteKey) return;

    const doVerify = (token: string) => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (slowTimer.current) { clearTimeout(slowTimer.current); slowTimer.current = null; }
      setErrMsg("");
      setSlow(false);
      onVerify(token);
    };
    // token 过期/失效：重置控件并清空隐藏输入，提示用户重新验证。
    // 不要复用成功回调——否则会把 undefined token 发去登录/注册（后端拒绝→弹窗闪烁）。
    const doExpired = () => {
      if (widgetId.current && (window as any).turnstile) {
        try { (window as any).turnstile.reset(widgetId.current); } catch {}
      }
      const resp = containerRef.current?.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null;
      if (resp) { try { resp.value = ""; } catch {} }
      setSlow(false);
      setErrMsg("验证未能完成，请点击下方重试");
    };

    (window as any)[cbName.current] = doVerify;
    (window as any)[expName.current] = doExpired;

    const renderWidget = () => {
      if (!containerRef.current) return;
      if (widgetId.current) return;
      if (!(window as any).turnstile) { setTimeout(renderWidget, 100); return; }
      try {
        widgetId.current = (window as any).turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: cbName.current,
          "expired-callback": expName.current,
          "error-callback": expName.current,
          size: "flexible",
          theme: "auto",
        });
        // 轮询 hidden input，兜底 callback 不触发的情况
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
          const resp = containerRef.current?.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null;
          if (resp && resp.value) {
            doVerify(resp.value);
          }
        }, 300);
      } catch {}
    };

    setErrMsg("");
    setSlow(false);
    // 20 秒拿不到 token 就提示（不算失败，仍可继续等待，但用户知道发生了什么）
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlow(true), 20000);

    if (!(window as any).turnstile) {
      if (!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async = true;
        s.defer = true;
        s.onload = () => setTimeout(renderWidget, 50);
        document.head.appendChild(s);
      } else {
        renderWidget();
      }
    } else {
      renderWidget();
    }

    return () => {
      if (slowTimer.current) { clearTimeout(slowTimer.current); slowTimer.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (widgetId.current && (window as any).turnstile) {
        try { (window as any).turnstile.remove(widgetId.current); } catch {}
        widgetId.current = null;
      }
      delete (window as any)[cbName.current];
      delete (window as any)[expName.current];
    };
  }, [open, siteKey]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--color-surface)] rounded-2xl p-4 sm:p-6 shadow-2xl border border-[var(--color-border)] max-w-sm w-full text-center relative max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-primary)]"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{t("humanVerification")}</h3>
        <div ref={containerRef} className="flex justify-center" />
        {errMsg && <p className="mt-3 text-xs text-red-500">{errMsg}</p>}
        {!errMsg && slow && <p className="mt-3 text-xs text-amber-500">网络较慢，验证还没完成……可点击重试</p>}
        {(errMsg || slow) && (
          <button
            type="button"
            onClick={() => {
              setErrMsg(""); setSlow(false);
              if (widgetId.current && (window as any).turnstile) {
                try { (window as any).turnstile.reset(widgetId.current); } catch {}
              }
              if (slowTimer.current) clearTimeout(slowTimer.current);
              slowTimer.current = setTimeout(() => setSlow(true), 20000);
            }}
            className="mt-3 mx-auto block px-4 py-2 rounded-xl bg-[var(--color-primary)] text-sm font-medium text-[var(--color-surface)]"
          >
            重试
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-xl text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{t("cancel")}</button>
        )}
      </div>
    </div>
  );
}
