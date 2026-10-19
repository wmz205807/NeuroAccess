"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  GitCompare,
  FileText,
  Activity,
  BarChart3,
  Brain,
  Waves,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useLang } from "@/lib/language-context";
import { formatDuration } from "@/lib/duration";
import { useAuth } from "@/lib/auth-context";
import { StoredReport, loadReports, fetchServerReport } from "@/lib/reports-storage";
import { isPlaceholderSvg } from "@/lib/waveform-svg";

/* ── Helpers ──────────────────────────────────────────────────── */

const modeKey: Record<string, string> = {
  Beginner: "beginnerModeLabel",
  Student: "studentModeLabel",
  Research: "researchModeLabel",
};

function scoreColor(q: number | null | undefined): string {
  if (q == null) return "text-[var(--color-text-secondary)]";
  if (q >= 80) return "text-emerald-600 dark:text-emerald-400 font-bold";
  if (q >= 60) return "text-yellow-600 dark:text-yellow-400 font-bold";
  if (q >= 40) return "text-orange-600 dark:text-orange-400 font-bold";
  return "text-red-600 dark:text-red-400 font-bold";
}

const bandColors: Record<string, string> = {
  delta: "#ef4444",
  theta: "#facc15",
  alpha: "#3b82f6",
  beta: "#22c55e",
  gamma: "#a855f7",
};

const bandLabels: Record<string, string> = {
  alpha: "Alpha",
  beta: "Beta",
  delta: "Delta",
  theta: "Theta",
  gamma: "Gamma",
};

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--color-text-secondary)]">
        <span>{label}</span>
        <span className="font-medium">{Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────── */

export default function ComparePage() {
  const { t } = useLang();
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();

  const [reports, setReports] = useState<StoredReport[]>([]);
  const [selA, setSelA] = useState<string>("");
  const [selB, setSelB] = useState<string>("");

  useEffect(() => {
    if (!loading) {
      try {
        const list = loadReports();
        setReports(list);
        // 直接进入 /reports/compare 时本地缓存可能还没同步（reconcile 在报告列表页/登录时执行），
        // 这里主动做一次服务端对账，确保下拉框有报告可选。
        import("@/lib/reports-storage").then(({ reconcileReportsWithServer }) =>
          reconcileReportsWithServer().then((merged) => {
            if (merged !== null) setReports(merged);
          })
        ).catch(() => {});

        // 优先级 1: URL ?ids=xxx,yyy 参数
        const urlIds = (searchParams?.get("ids") || "").split(",").filter(Boolean);
        if (urlIds.length === 2) {
          setSelA(urlIds[0]);
          setSelB(urlIds[1]);
          return;
        }

        // 优先级 2: sessionStorage 预选
        try {
          const preSel = JSON.parse(
            sessionStorage.getItem("neuroaccess-compare-ids") || "[]"
          );
          if (Array.isArray(preSel) && preSel.length === 2) {
            setSelA(preSel[0]);
            setSelB(preSel[1]);
            sessionStorage.removeItem("neuroaccess-compare-ids");
          }
        } catch {}
      } catch {
        setReports([]);
      }
    }
  }, [loading, user, searchParams]);

  const reportA = useMemo(
    () => reports.find((r) => r.id === selA) || null,
    [reports, selA]
  );
  const reportB = useMemo(
    () => reports.find((r) => r.id === selB) || null,
    [reports, selB]
  );

  // 列表里的报告是轻量摘要（无波形）。选中后若缺 waveform_preview，
  // 从服务器拉取完整报告补全波形，供 MiniWaveform 渲染。
  useEffect(() => {
    let cancelled = false;
    const ensureFull = async (id: string) => {
      if (!id || cancelled) return;
      const cur = reports.find((r) => r.id === id);
      if (cur && ((cur.analysis as any)?.waveform_preview || cur.eegData)) return;
      const full = await fetchServerReport(id).catch(() => null);
      if (!cancelled && full?.analysis) {
        setReports((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, analysis: full.analysis, eegData: full.eegData } : r
          )
        );
      }
    };
    ensureFull(selA);
    ensureFull(selB);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selA, selB]);

  const availableReports = useMemo(
    () =>
      reports.filter((r) => {
        return true; // allow selecting any report
      }),
    [reports]
  );

  /* ── extract analysis helpers ──────────────────────────────── */

  function getBandpower(r: StoredReport): Record<string, number> {
    const a = r.analysis as any;
    return a?.bandpower || a?.frequency_analysis?.bandpower || {};
  }

  function getBandpowerPercent(r: StoredReport): Record<string, string> {
    const a = r.analysis as any;
    return (
      a?.bandpower_percent ||
      a?.frequency_analysis?.bandpower_percent ||
      {}
    );
  }

  function getScores(r: StoredReport): Record<string, number> {
    const a = r.analysis as any;
    return (
      a?.eeg_literacy_scores ||
      a?.literacy_scores ||
      {}
    );
  }

  /* ── Loading state ──────────────────────────────────────────── */

  if (loading) {
    return (
      <motion.div
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-primary)] border-t-transparent" />
      </motion.div>
    );
  }

  if (!user) {
    return (
      <motion.div
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-[var(--color-text-secondary)]/50" />
          <p className="text-lg font-medium">{t("pleaseLogin")}</p>
        </div>
      </motion.div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <motion.div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 0.8, 0.22, 1] }}
    >
      <section className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-8 pb-[env(safe-area-inset-bottom,16px)]">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)] mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("reports")}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("compareReports")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {t("compareSubtitle")}
          </p>
        </div>

        {/* Report selectors */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                  A
                </span>
              </div>
              <span className="text-sm font-bold">{t("reportA")}</span>
              {reportA && (
                <Check className="ml-auto h-4 w-4 text-emerald-500" />
              )}
            </div>
            <select
              value={selA}
              onChange={(e) => setSelA(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            >
              <option value="">{t("selectReport")}</option>
              {availableReports.map((r) => (
                <option key={r.id} value={r.id} disabled={r.id === selB}>
                  {r.fileName}
                </option>
              ))}
            </select>
            {reportA && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-secondary)]">
                <span>
                  {t("date")}: {reportA.date}
                </span>
                <span>
                  {t("mode")}: {reportA.mode}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950/30">
                <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                  B
                </span>
              </div>
              <span className="text-sm font-bold">{t("reportB")}</span>
              {reportB && (
                <Check className="ml-auto h-4 w-4 text-emerald-500" />
              )}
            </div>
            <select
              value={selB}
              onChange={(e) => setSelB(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            >
              <option value="">{t("selectReport")}</option>
              {availableReports.map((r) => (
                <option key={r.id} value={r.id} disabled={r.id === selA}>
                  {r.fileName}
                </option>
              ))}
            </select>
            {reportB && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-secondary)]">
                <span>
                  {t("date")}: {reportB.date}
                </span>
                <span>
                  {t("mode")}: {reportB.mode}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 交换 A/B 按钮：把右侧报告放到左边（或反之），让用户决定哪份在右边 */}
        {reportA && reportB && (
          <div className="-mt-2 mb-6 flex justify-center">
            <button
              onClick={() => { setSelA(selB); setSelB(selA); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
            >
              <GitCompare className="h-3.5 w-3.5" /> {t("swapAB") || "交换 A/B"}
            </button>
          </div>
        )}

        {/* Comparison content */}
        <AnimatePresence>
          {reportA && reportB ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* ── Quality Scores ───────────────────────────── */}
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
                    <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h2 className="text-base font-bold">
                    {t("signalQuality")}
                  </h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
                    <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                      {t("reportA")}: {reportA.fileName}
                    </div>
                    <div
                      className={`text-2xl font-bold tabular-nums ${scoreColor(reportA.quality)}`}
                    >
                      {reportA.quality != null
                        ? Number(reportA.quality).toFixed(0)
                        : "-"}
                    </div>
                    <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          (reportA.quality || 0) >= 70
                            ? "bg-emerald-500"
                            : (reportA.quality || 0) >= 50
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, reportA.quality || 0))}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
                    <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                      {t("reportB")}: {reportB.fileName}
                    </div>
                    <div
                      className={`text-2xl font-bold tabular-nums ${scoreColor(reportB.quality)}`}
                    >
                      {reportB.quality != null
                        ? Number(reportB.quality).toFixed(0)
                        : "-"}
                    </div>
                    <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          (reportB.quality || 0) >= 70
                            ? "bg-emerald-500"
                            : (reportB.quality || 0) >= 50
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, reportB.quality || 0))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Overview comparison ──────────────────────── */}
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/30">
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h2 className="text-base font-bold">
                    {t("eegOverview")}
                  </h2>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">
                          {t("reportA")}
                        </th>
                        <th className="py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">
                          {t("reportB")}
                        </th>
                        <th className="py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">
                          {t("fileName")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        {
                          label: t("fileName"),
                          a: reportA.fileName,
                          b: reportB.fileName,
                        },
                        {
                          label: t("channelCount"),
                          a:
                            (reportA.analysis as any)?.channel_count ??
                            "-",
                          b:
                            (reportB.analysis as any)?.channel_count ??
                            "-",
                        },
                        {
                          label: t("samplingRate"),
                          a: (reportA.analysis as any)?.sampling_rate
                            ? `${(reportA.analysis as any).sampling_rate} Hz`
                            : "-",
                          b: (reportB.analysis as any)?.sampling_rate
                            ? `${(reportB.analysis as any).sampling_rate} Hz`
                            : "-",
                        },
                        {
                          label: t("duration"),
                          a: formatDuration(reportA.analysis, t),
                          b: formatDuration(reportB.analysis, t),
                        },
                        {
                          label: t("date"),
                          a: reportA.date,
                          b: reportB.date,
                        },
                        {
                          label: t("mode"),
                          a: t(modeKey[reportA.mode] || reportA.mode),
                          b: t(modeKey[reportB.mode] || reportB.mode),
                        },
                      ] as { label: string; a: any; b: any }[]).map(
                        (row, i) => (
                          <tr
                            key={i}
                            className="border-b border-[var(--color-border)] last:border-0"
                          >
                            <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-text)]">
                              {String(row.a)}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-text)]">
                              {String(row.b)}
                            </td>
                            <td className="py-2.5 text-right text-xs text-[var(--color-text-secondary)]">
                              {row.label}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ── Bandpower comparison (百分比，跨文件可比) ───── */}
              {(() => {
                // 用 bandpower_percent（百分比）对比：绝对功率受幅值/量纲影响（模拟器 vs 真实差异巨大），
                // 百分比是频段占比，跨文件可比，且与报告详情页一致
                const pctA = getBandpowerPercent(reportA);
                const pctB = getBandpowerPercent(reportB);
                const bpA: Record<string, number> = {};
                const bpB: Record<string, number> = {};
                for (const b of Object.keys(bandLabels)) {
                  bpA[b] = parseFloat(String((pctA as any)[b] || 0)) || 0;
                  bpB[b] = parseFloat(String((pctB as any)[b] || 0)) || 0;
                }
                const bpAll = { ...bpA, ...bpB };
                if (Object.keys(bpAll).length === 0) return null;

                const allBands = Object.keys(bandLabels);
                const bandKeys = allBands.filter((b) => b in bpAll);
                if (bandKeys.length === 0)
                  return null;

                return (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/30">
                        <BarChart3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <h2 className="text-base font-bold">
                        {t("bandpower")} (%)
                      </h2>
                    </div>

                    {/* 左右两列：A 报告全部频段在左卡片、B 报告全部频段在右卡片 */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {/* Report A card */}
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                        <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)] truncate">
                          <span className="text-blue-500 font-bold mr-1">A</span>
                          {t("reportA")}: {reportA.fileName}
                        </div>
                        <div className="space-y-3">
                          {bandKeys.map((band) => {
                            const val = bpA[band] || 0;
                            return (
                              <div key={band}>
                                <div className="mb-1 flex items-center justify-between text-xs">
                                  <span className="capitalize text-[var(--color-text-secondary)]">{band}</span>
                                  <span className="font-mono tabular-nums text-[var(--color-text)]">{Number(val).toFixed(1)}%</span>
                                </div>
                                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                                  <motion.div
                                    className="h-full rounded-full"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(val, 100)}%` }}
                                    transition={{ duration: 0.6 }}
                                    style={{ backgroundColor: bandColors[band] }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Report B card */}
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                        <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)] truncate">
                          <span className="text-violet-500 font-bold mr-1">B</span>
                          {t("reportB")}: {reportB.fileName}
                        </div>
                        <div className="space-y-3">
                          {bandKeys.map((band) => {
                            const val = bpB[band] || 0;
                            return (
                              <div key={band}>
                                <div className="mb-1 flex items-center justify-between text-xs">
                                  <span className="capitalize text-[var(--color-text-secondary)]">{band}</span>
                                  <span className="font-mono tabular-nums text-[var(--color-text)]">{Number(val).toFixed(1)}%</span>
                                </div>
                                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                                  <motion.div
                                    className="h-full rounded-full"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(val, 100)}%` }}
                                    transition={{ duration: 0.6 }}
                                    style={{ backgroundColor: bandColors[band], opacity: 0.85 }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })()}

              {/* ── Literacy Scores comparison ───────────────── */}
              {(() => {
                const scoresA = getScores(reportA);
                const scoresB = getScores(reportB);
                const scoreKeys = [
                  {
                    key: "learning_readability_score",
                    label: t("learningReadability"),
                    color: "bg-blue-500",
                  },
                  {
                    key: "signal_clarity_score",
                    label: t("signalClarity"),
                    color: "bg-emerald-500",
                  },
                  {
                    key: "beginner_friendliness_score",
                    label: t("beginnerFriendliness"),
                    color: "bg-violet-500",
                  },
                  {
                    key: "research_usefulness_score",
                    label: t("researchUsefulness"),
                    color: "bg-amber-500",
                  },
                  {
                    key: "noise_complexity_score",
                    label: t("noiseComplexity"),
                    color: "bg-rose-500",
                  },
                ];
                const hasAny =
                  scoreKeys.some(
                    (sk) =>
                      (scoresA as any)?.[sk.key] != null ||
                      (scoresB as any)?.[sk.key] != null
                  );
                if (!hasAny) return null;

                return (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/30">
                        <Brain className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                      </div>
                      <h2 className="text-base font-bold">
                        {t("eegLiteracyScores")}
                      </h2>
                    </div>

                    <div className="space-y-4">
                      {scoreKeys.map((sk) => {
                        const va =
                          (scoresA as any)?.[sk.key] ?? 0;
                        const vb =
                          (scoresB as any)?.[sk.key] ?? 0;
                        return (
                          <div key={sk.key}>
                            <div className="mb-1 text-xs text-[var(--color-text-secondary)]">
                              {sk.label}
                            </div>
                            <div className="flex gap-2 items-end">
                              <div className="flex-1">
                                <div className="mb-0.5 text-[10px] text-[var(--color-text-secondary)]">
                                  A: {Math.round(va)}
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${sk.color}`}
                                    style={{
                                      width: `${Math.min(100, Math.max(0, va))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="flex-1">
                                <div className="mb-0.5 text-[10px] text-[var(--color-text-secondary)]">
                                  B: {Math.round(vb)}
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${sk.color}`}
                                    style={{
                                      width: `${Math.min(100, Math.max(0, vb))}%`,
                                      opacity: 0.5,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })()}

              {/* ── Waveform Preview ─────────────────────────── */}
              {(() => {
                // 列表接口返回的是轻量摘要（无波形），即使 ensureFull 补全失败，
                // 这里也始终展示"波形对比"区块（内部用服务器 SVG 兜底），避免区块空白。
                if (!reportA && !reportB) return null;

                return (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 dark:bg-cyan-950/30">
                        <Waves className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                      </div>
                      <h2 className="text-base font-bold">
                        {t("comparisonWaveform")}
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {reportA && (
                        <MiniWaveform
                          report={reportA}
                          label={t("reportA")}
                          color="#3b82f6"
                        />
                      )}
                      {reportB && (
                        <MiniWaveform
                          report={reportB}
                          label={t("reportB")}
                          color="#8b5cf6"
                        />
                      )}
                    </div>
                  </section>
                );
              })()}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-16 text-center"
            >
              <GitCompare className="mx-auto mb-4 h-12 w-12 text-[var(--color-text-secondary)]/70" />
              <p className="text-[var(--color-text-secondary)]">
                {t("selectTwoReports")}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </motion.div>
  );
}

/* ── Mini Waveform Canvas ──────────────────────────────────────── */

function MiniWaveform({
  report,
  label,
  color,
}: {
  report: StoredReport;
  label: string;
  color: string;
}) {
  const { t } = useLang();
  const wp = (report as any)?.analysis?.waveform_preview;
  const eegData = wp || null;
  const hasChannels = !!(eegData?.channels && Object.keys(eegData.channels).length > 0);
  // 列表摘要是轻量数据（无波形）。本地无波形时回退到服务器 SVG 渲染
  // （与报告详情波形页 /api/waveform-image 同源，读 DB 全分辨率波形），保证对比页始终能看到波形。
  const serverSvg = hasChannels
    ? null
    : `/api/waveform-image?rid=${encodeURIComponent(report.id)}&page=0&_t=${Date.now()}`;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {label}: {report.fileName}
        </span>
      </div>
      {hasChannels ? (
        <CanvasWaveform eegData={eegData} color={color} />
      ) : serverSvg && !isPlaceholderSvg(serverSvg) ? (
        <img
          src={serverSvg}
          alt={`EEG ${report.fileName}`}
          className="w-full rounded-lg"
          style={{ height: 120, background: "var(--color-bg)", objectFit: "cover", objectPosition: "left center" }}
        />
      ) : null}
      <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
        {t("channelCount")}: {(report.analysis as any)?.channel_count || "-"}
      </div>
    </div>
  );
}

/* ── Canvas-based waveform ────────────────────────────────────── */

import { useRef, useEffect as useLayoutEffect } from "react";

function CanvasWaveform({
  eegData,
  color,
}: {
  eegData: any;
  color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !eegData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Determine data shape
    let channels: number[][] = [];
    if (Array.isArray(eegData)) {
      // shape: [nSamples, nChannels]
      if (eegData.length > 0 && Array.isArray(eegData[0])) {
        const nCh = eegData[0].length;
        for (let c = 0; c < nCh; c++) {
          channels.push(eegData.map((row: any) => Number(row[c]) || 0));
        }
      } else {
        // single channel
        channels = [eegData.map((v: any) => Number(v) || 0)];
      }
    } else if (eegData?.channels && Array.isArray(eegData.channels)) {
      // shape: { channels: number[][], times: number[] }
      channels = eegData.channels.map((ch: any) =>
        (Array.isArray(ch) ? ch : []).map((v: any) => Number(v) || 0)
      );
    } else if (
      eegData?.channels &&
      typeof eegData.channels === "object" &&
      !Array.isArray(eegData.channels)
    ) {
      // shape: { channels: { name: number[] } }  ← waveform_preview 结构
      channels = Object.values(eegData.channels as Record<string, number[]>).map(
        (ch: any) => (Array.isArray(ch) ? ch : []).map((v: any) => Number(v) || 0)
      );
    } else if (eegData?.data && Array.isArray(eegData.data)) {
      if (Array.isArray(eegData.data[0])) {
        channels = (eegData.data as number[][]).map((ch) =>
          ch.map((v) => Number(v) || 0)
        );
      } else {
        channels = [(eegData.data as number[]).map((v) => Number(v) || 0)];
      }
    }

    if (channels.length === 0) return;

    const maxChannels = Math.min(channels.length, 8);
    const channelHeight = h / maxChannels;

    for (let c = 0; c < maxChannels; c++) {
      const data = channels[c];
      if (!data || data.length === 0) continue;

      const yOffset = c * channelHeight;
      const midY = yOffset + channelHeight / 2;

      // Compute amplitude range
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
      const range = max - min || 1;
      const amp = (channelHeight * 0.35) / range;

      // Draw grid line（canvas 2D 不解析 CSS var，取实际色值）
      let borderColor = "#e5e7eb";
      try {
        borderColor = getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim() || borderColor;
      } catch {}
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      // Draw waveform
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // 数据点少于像素宽度时把波形拉伸铺满整个区域（短文件不再只占左侧一小截），
      // 数据点多时按比例采样每个像素列的代表点。
      const nD = data.length;
      for (let x = 0; x < w; x++) {
        const idx = nD <= 1 ? 0 : Math.min(Math.round((x / Math.max(1, w - 1)) * (nD - 1)), nD - 1);
        const y = midY - (data[idx] - min) * amp + (range * amp) / 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [eegData, color]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: 120, background: "var(--color-bg)" }}
    />
  );
}
