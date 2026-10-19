"use client";

import { useState } from "react";
import { DownloadCloud, BookOpen, GraduationCap, EyeOff, X } from "lucide-react";
import { useLang } from "@/lib/language-context";
import { setDownloadBtnHidden } from "@/lib/download-btn-state";

export default function DownloadDataButton({ fixed = false }: { fixed?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  // 2026-10-18：按用户要求**恢复右下角悬浮形态（原来的位置）**。
  // 历史：10-15 曾把它从悬浮改到页脚（与免责声明同排）；用户明确要求改回原处。
  const btnClass = fixed
    ? "fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-xl bg-yellow-300 hover:bg-yellow-400 active:bg-yellow-500 text-yellow-800 font-semibold text-sm px-5 py-3 shadow-md transition-colors"
    : "inline-flex items-center gap-2 rounded-xl bg-yellow-300 hover:bg-yellow-400 active:bg-yellow-500 text-yellow-800 font-semibold text-sm px-4 py-2.5 shadow-sm transition-colors";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass}>
        <DownloadCloud className="h-5 w-5" aria-hidden="true" />
        <span>{t("downloadTestEEG")}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* 显式 `text-left`：浮层会继承祖先的 text-align。
              2026-10-18 曾因按钮被移进 <footer className="text-center">，导致整个弹窗
              的文字被居中（满宽按钮不受影响 ⇒ 只有文字跑偏）。按钮现已恢复为右下角
              悬浮、不再位于页脚子树中，这里保留 text-left 作为防御。 */}
          <div className="relative z-10 w-full max-w-md text-left bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--color-border)] shrink-0">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <DownloadCloud className="w-4 h-4" />
                {t("downloadData")}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors">
                <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-xs text-[var(--color-text-secondary)]">{t("downloadDataDesc")}</p>

              <div className="rounded-xl border border-[var(--color-border)] p-4">
                <div className="flex items-start gap-3">
                  <BookOpen className="w-5 h-5 text-blue-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text)]">{t("packBeginner")}</div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{t("packBeginnerDesc")}</div>
                  </div>
                </div>
                <a
                  href="/downloads/eeg-sample-data.zip?v=2"
                  download
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2.5 transition-colors"
                >
                  <DownloadCloud className="h-4 w-4" />
                  {t("downloadSample")}
                </a>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-4">
                <div className="flex items-start gap-3">
                  <GraduationCap className="w-5 h-5 text-emerald-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text)]">{t("packAdvanced")}</div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{t("packAdvancedDesc")}</div>
                  </div>
                </div>
                <a
                  href="/downloads/eeg-real-data.zip?v=2"
                  download
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 transition-colors"
                >
                  <DownloadCloud className="h-4 w-4" />
                  {t("downloadReal")}
                </a>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDownloadBtnHidden(true);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-xs py-2.5 transition-colors"
              >
                <EyeOff className="h-4 w-4" />
                {t("hideDownloadBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
