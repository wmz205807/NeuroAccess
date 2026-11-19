"use client";

import { translations } from "@/lib/translations";
import { useLang } from "@/lib/language-context";

interface PublicPreviewFooterProps {
  lang?: string;
}

export default function PublicPreviewFooter({ lang: serverLang }: PublicPreviewFooterProps) {
  const { lang: clientLang } = useLang();
  const lang = serverLang || clientLang;
  // Helper: get translation directly from translations object
  const tf = (key: string, fallback: string) => {
    const val = translations[lang as keyof typeof translations]?.[key];
    return val || fallback;
  };

  // 视觉：参考 BCI World —— 1px 细线分隔、无投影、mono 小字排版。
  // 链接仍刻意使用原生 <a> 全页导航（next/link 在该环境不提交导致链接点不动）。
  //
  // 2026-10-16 移动端适配：这些链接原来只有十几像素高，手指很容易点错。
  // 现在小屏给出 44px 的触控高度（桌面端 sm: 以上保持原来的紧凑排版）。
  const linkCls =
    "label-mono inline-flex min-h-[44px] items-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors lg:min-h-0";

  return (
    <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 text-center">
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <a href="/disclaimer" className={linkCls}>
          {tf("disclaimerTitle", "Disclaimer")}
        </a>
        <span className="hidden text-[var(--color-border-strong)] select-none sm:inline">/</span>
        <a href="/privacy" className={linkCls}>
          {tf("privacyPolicy", "Privacy Policy")}
        </a>
        <span className="hidden text-[var(--color-border-strong)] select-none sm:inline">/</span>
        <a href="/terms" className={linkCls}>
          {tf("termsOfService", "Terms of Service")}
        </a>
        <span className="hidden text-[var(--color-border-strong)] select-none sm:inline">/</span>
        <a
          href="https://github.com/wmz205807/NeuroAccess"
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkCls} gap-1.5`}
          aria-label="GitHub（开源代码仓库）"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
          </svg>
          GitHub
        </a>
      </div>
    </footer>
  );
}
