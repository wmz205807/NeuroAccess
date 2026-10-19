"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react";
import { useLang } from "@/lib/language-context";

/**
 * 路由级错误边界（Next.js App Router 约定文件）。
 *
 * 2026-10-16 新增：此前全站**没有任何 error.tsx**，某个页面组件一旦抛错，
 * 用户看到的就是一片空白（只剩侧栏），既没有解释也没有出路。
 * 这里给出「发生了什么 + 能做什么」：重试当前片段，或回首页。
 *
 * 注意：error.tsx 必须是客户端组件，并接收 { error, reset }。
 * 它只能捕获**渲染期**错误；事件处理器里的错误不会冒到这里（那些走 toast）。
 *
 * 配色全部走设计 token，暗/亮主题自适应。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLang();

  useEffect(() => {
    // 保留现场，方便排查；digest 是 Next 给服务端错误的指纹
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-warn)]/10">
          <AlertTriangle className="h-6 w-6 text-[var(--color-warn)]" aria-hidden="true" />
        </div>

        <h1 className="text-base font-bold text-[var(--color-text)]">{t("unknownError")}</h1>

        {/* 技术细节：给得出就展示，方便用户截图反馈 */}
        {(error?.message || error?.digest) && (
          <p className="mt-2 break-words font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">
            {error.message}
            {error.digest ? ` (${error.digest})` : ""}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("retry")}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-text-secondary)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("backToHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
