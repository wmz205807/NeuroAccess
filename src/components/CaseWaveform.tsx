"use client";

/**
 * 案例页的「原始波形」区块。
 *
 * 2026-10-18：用户指出「案例库用户只看得到分析，看不到原本的数据；看不到原始数据，
 * 分析就没有意义，要告诉用户为什么这么分析」。
 *
 * 这个组件做两件事：
 *   1. 把案例片段本身画出来（用首页/报告同一套 buildWaveformSvg 渲染器）
 *   2. 用一句话说明「上面那些频段数字是怎么来的」——先 FFT 再算相对功率，
 *      用户可以拿波形自己核对结论。
 *
 * 数据来自 /api/cases/waveform（读 EDF 抽点，**不调用 AI、不消耗 token**）。
 */

import { useEffect, useState } from "react";
import { buildWaveformSvg, svgToDataUrl } from "@/lib/waveform-svg";
import { useLang } from "@/lib/language-context";
import { Loader2, Waves, ChevronLeft, ChevronRight } from "lucide-react";

const TXT: Record<string, any> = {
  zh: {
    title: "原始波形",
    sub: "案例附带的真实记录片段，未经任何加工（只去掉了直流偏置）",
    why: "上面那些频段数字就是这张图算出来的：先把这段记录做 FFT，再按 δ / θ / α / β 四个频段求相对功率。所以你可以对着波形核对 —— 比如发作段是不是肉眼就能看出「又慢又大」、快波明显变少。",
    loading: "正在读取原始记录…",
    failed: "波形加载失败",
    prev: "上一段",
    next: "下一段",
    pageTpl: (a: number, b: number) => `第 ${a} / ${b} 段（每段 10 秒）`,
  },
  en: {
    title: "Raw waveform",
    sub: "The real recorded segment attached to this case, unprocessed (DC offset removed)",
    why: "The band-power figures above come from this very plot: the segment is FFT'd, then relative power is computed for δ / θ / α / β. So you can check the conclusion yourself — e.g. whether the seizure segment really looks 'slow and large' with fast activity clearly reduced.",
    loading: "Loading the raw recording…",
    failed: "Failed to load waveform",
    prev: "Previous",
    next: "Next",
    pageTpl: (a: number, b: number) => `Segment ${a} / ${b} (10 s each)`,
  },
};

export default function CaseWaveform({ caseId }: { caseId: string }) {
  const { lang } = useLang();
  const t = TXT[lang] || TXT.en;
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const resp = await fetch(`/api/cases/waveform?case_id=${encodeURIComponent(caseId)}&page=${page}`);
        const j = await resp.json();
        if (cancelled) return;
        if (!j?.success || !j.channels || !Array.isArray(j.times) || j.times.length < 2) {
          setFailed(true);
          setLoading(false);
          return;
        }
        const durWin = Math.abs(j.times[j.times.length - 1] - j.times[0]) || 0;
        const svg = buildWaveformSvg(
          { waveform_preview: { channels: j.channels, times: j.times, duration_seconds: durWin, sampling_rate: j.samplingRate } },
          0,
        );
        setSrc(svg ? svgToDataUrl(svg) : null);
        setTotalPages(j.totalPages || 1);
        setLoading(false);
      } catch {
        if (!cancelled) { setFailed(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [caseId, page]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <div className="text-xs font-semibold text-[var(--color-text)]">{t.title}</div>
        <div className="text-[11px] text-[var(--color-text-secondary)]">{t.sub}</div>
      </div>

      <div className="mt-2 rounded-lg bg-[var(--color-surface)] overflow-hidden">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--color-text-secondary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.loading}
          </div>
        ) : failed || !src ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--color-text-secondary)]">
            <Waves className="mr-2 h-4 w-4 opacity-50" />{t.failed}
          </div>
        ) : (
          <img
            src={src}
            alt="Case EEG Waveform"
            draggable={false}
            className="block h-auto w-full select-none"
            style={{ maxHeight: "60vh", objectFit: "contain" }}
          />
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={13} />{t.prev}
          </button>
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {t.pageTpl(page + 1, totalPages)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.next}<ChevronRight size={13} />
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">{t.why}</p>
    </div>
  );
}
