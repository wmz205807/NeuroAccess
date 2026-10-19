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
      </div>
    </footer>
  );
}
