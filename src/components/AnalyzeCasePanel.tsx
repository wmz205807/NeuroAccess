"use client";

import { useState, useRef, useCallback } from "react";
import { useLang } from "@/lib/language-context";
import type { Status } from "@/lib/analysis-context";
import AnalysisSteps from "@/components/AnalysisSteps";
import ReportEEGChart from "@/components/ReportEEGChart";
import { Play, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
 * 案例页的「分析这段真实记录」面板
 *
 * 为什么需要它：案例页宣称所用片段是真实记录，那就应该让读者能亲自跑一遍，
 * 看到真实波形与实测指标 —— 而不是只能读文字。这里直接调用后端
 * /api/cases/analyze，复用与首页完全相同的分析流程，并展示真实上报的分析阶段。
 * 免登录、结果不落库（不会写入任何人的报告列表）。
 * ──────────────────────────────────────────────────────────────────────────── */

type L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

const T: Record<L, {
  cta: string; running: string; done: string; again: string;
  failed: string; quality: string; bands: string; aiWait: string;
}> = {
  zh: {
    cta: "分析这段真实记录", running: "正在分析…", done: "分析完成", again: "重新分析",
    failed: "分析失败", quality: "信号质量评分", bands: "各频段相对功率",
    aiWait: "AI 分级解读生成中…",
  },
  en: {
    cta: "Analyze this real recording", running: "Analyzing…", done: "Analysis complete", again: "Analyze again",
    failed: "Analysis failed", quality: "Signal quality score", bands: "Relative band power",
    aiWait: "Generating AI explanations…",
  },
  es: {
    cta: "Analizar este registro real", running: "Analizando…", done: "Análisis completado", again: "Analizar de nuevo",
    failed: "Error en el análisis", quality: "Puntuación de calidad de señal", bands: "Potencia relativa por banda",
    aiWait: "Generando explicaciones con IA…",
  },
  fr: {
    cta: "Analyser cet enregistrement réel", running: "Analyse en cours…", done: "Analyse terminée", again: "Réanalyser",
    failed: "Échec de l'analyse", quality: "Score de qualité du signal", bands: "Puissance relative par bande",
    aiWait: "Génération des explications par IA…",
  },
  de: {
    cta: "Diese echte Aufzeichnung analysieren", running: "Analyse läuft…", done: "Analyse abgeschlossen", again: "Erneut analysieren",
    failed: "Analyse fehlgeschlagen", quality: "Signalqualitätswert", bands: "Relative Bandleistung",
    aiWait: "KI-Erläuterungen werden erstellt…",
  },
  ja: {
    cta: "この実際の記録を分析", running: "分析中…", done: "分析が完了しました", again: "再分析",
    failed: "分析に失敗しました", quality: "信号品質スコア", bands: "各帯域の相対パワー",
    aiWait: "AI解説を生成中…",
  },
  ko: {
    cta: "이 실제 기록 분석하기", running: "분석 중…", done: "분석 완료", again: "다시 분석",
    failed: "분석 실패", quality: "신호 품질 점수", bands: "대역별 상대 파워",
    aiWait: "AI 해설 생성 중…",
  },
};

export default function AnalyzeCasePanel({ caseId }: { caseId: string }) {
  const { lang } = useLang();
  const txt = T[(lang as L)] || T.en;

  const [status, setStatus] = useState<Status>("pending");
  const [stage, setStage] = useState<string | undefined>(undefined);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const running = status === "computing" || status === "explaining";

  const run = useCallback(async () => {
    if (running) return;
    const pid = `case-${caseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setError(null);
    setAnalysis(null);
    setStage(undefined);
    setStatus("computing");

    const poll = async () => {
      try {
        const r = await fetch(`/api/analysis/progress/${encodeURIComponent(pid)}`);
        const d = await r.json();
        if (d?.success && d.stage) setStage(d.stage);
      } catch {
        /* 轮询失败不影响分析本身 */
      }
    };
    timerRef.current = setInterval(poll, 600);
    poll();

    try {
      const res = await fetch("/api/cases/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, language: lang, progress_id: pid }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || txt.failed);

      const a = data.analysis || {};
      setAnalysis(a);
      setStatus("explaining");

      const aid = a.analysis_id;
      if (aid) {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const pr = await fetch(`/api/analysis/explanations/${aid}`);
            const pd = await pr.json();
            if (pd?.success && pd.explanations) {
              setAnalysis((prev: any) => ({ ...prev, explanations: pd.explanations }));
              break;
            }
            if (pd && pd.success === false) break;
          } catch {
            /* 网络抖动继续重试 */
          }
        }
      }
      setStatus("completed");
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("failed");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [caseId, lang, running, txt.failed]);

  const bands = [
    { key: "delta", label: "δ", cls: "text-red-600 dark:text-red-400" },
    { key: "theta", label: "θ", cls: "text-yellow-600 dark:text-yellow-400" },
    { key: "alpha", label: "α", cls: "text-blue-600 dark:text-blue-400" },
    { key: "beta",  label: "β", cls: "text-green-600 dark:text-green-400" },
    { key: "gamma", label: "γ", cls: "text-purple-600 dark:text-purple-400" },
  ];
  const bp = analysis?.bandpower_percent || analysis?.frequency_analysis?.bandpower_percent || {};
  const quality = analysis?.signal_quality_score;
  const explanations = analysis?.explanations?.[lang] || analysis?.explanations?.en;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={running}
          className="rounded-xl bg-[var(--color-primary)] px-3.5 py-2 text-xs font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {txt.running}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Play className="h-3.5 w-3.5" />
              {status === "completed" || status === "failed" ? txt.again : txt.cta}
            </span>
          )}
        </button>
        {status === "completed" && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {txt.done}
          </span>
        )}
      </div>

      {/* 真实分步进度 */}
      {running && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <AnalysisSteps status={status} stage={stage} variant="card" />
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{txt.failed}: {error}</span>
        </div>
      )}

      {analysis && (
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          {/* 波形 */}
          <ReportEEGChart
            reportFileName={analysis.file_name || caseId}
            analysis={analysis}
            id={`case-${caseId}`}
          />

          {/* 质量 + 频段 */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <div className="text-[10px] text-[var(--color-text-secondary)]">{txt.quality}</div>
              <div className="mt-1 text-2xl font-bold text-[var(--color-text)]">
                {quality != null ? Number(quality).toFixed(0) : "-"}
              </div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">/ 100</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] p-3 sm:col-span-2">
              <div className="mb-2 text-[10px] text-[var(--color-text-secondary)]">{txt.bands}</div>
              <div className="grid grid-cols-5 gap-2">
                {bands.map((b) => (
                  <div key={b.key} className="text-center">
                    <div className={`text-sm font-bold ${b.cls}`}>{bp[b.key] ?? "0%"}</div>
                    <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">{b.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI 三档解释 */}
          {status === "explaining" && !explanations && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {txt.aiWait}
            </div>
          )}
          {explanations && (
            <div className="grid gap-3 lg:grid-cols-3">
              {(["beginner", "student", "research"] as const).map((k) =>
                explanations[k] ? (
                  <div key={k} className="rounded-xl border border-[var(--color-border)] p-3">
                    <p className="whitespace-pre-line text-xs leading-6 text-[var(--color-text-secondary)]">
                      {explanations[k]}
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
