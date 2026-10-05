"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Download,
  Trash2,
  X,
  Calendar,
  Brain,
  Eye,
  AlertTriangle,
  Waves,
  GitCompare,
  Star,
  RefreshCw,
} from "lucide-react";
import { useLang } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/duration";
import {
  StoredReport,
  loadReports,
  deleteReport as deleteReportFromStorage,
  deleteServerReport,
  reconcileReportsWithServer,
  getFavorites,
  saveFavorites,
  isFavorite,
  toggleFavorite,
  markDeleted,
} from "@/lib/reports-storage";


/* 分数颜色 */
function scoreColor(q: number | null | undefined): string {
  if (q == null) return "text-[var(--color-text-secondary)]";
  // 与评分逻辑弹窗的"分数参考区间"一致：80 实验室级 / 60 临床可用 / 40 可用 / <40 较差
  if (q >= 80) return "text-emerald-600 dark:text-emerald-400 font-bold";
  if (q >= 60) return "text-yellow-600 dark:text-yellow-400 font-bold";
  if (q >= 40) return "text-orange-600 dark:text-orange-400 font-bold";
  return "text-red-600 dark:text-red-400 font-bold";
}

const modeKey: Record<string, string> = {
  Beginner: "beginnerModeLabel",
  Student: "studentModeLabel",
  Research: "researchModeLabel",
};

/* ── 复用 Dashboard 的分析显示组件 ───────────────────────────── */

function OverviewCard({ analysis }: { analysis: any }) {
  const { t } = useLang();
  if (!analysis) return null;
  const items = [
    { label: t("fileName"),    value: analysis.file_name || "-" },
    { label: t("channelCount"), value: analysis.channel_count ?? "-" },
    { label: t("samplingRate"), value: analysis.sampling_rate ?? "-" },
    { label: t("duration"),     value: formatDuration(analysis, t) },
    { label: t("signalQuality"), value: analysis.signal_quality_score != null ? Number(analysis.signal_quality_score).toFixed(0) : "-" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4 shadow-sm">
          <div className="text-[10px] sm:text-xs text-[var(--color-text-secondary)]">{it.label}</div>
          <div className="mt-1 truncate text-xs sm:text-sm font-bold text-[var(--color-text)]">{String(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--color-text-secondary)]">
        <span>{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function LiteracyScores({ scores }: { scores: any }) {
  const { t } = useLang();
  if (!scores || typeof scores !== "object") return null;
  const list = [
    { key: "learning_readability_score",  label: t("learningReadability"), color: "bg-blue-500" },
    { key: "signal_clarity_score",        label: t("signalClarity"),       color: "bg-emerald-500" },
    { key: "beginner_friendliness_score", label: t("beginnerFriendliness"), color: "bg-violet-500" },
    { key: "research_usefulness_score",  label: t("researchUsefulness"),  color: "bg-amber-500" },
    { key: "noise_complexity_score",     label: t("noiseComplexity"),     color: "bg-rose-500" },
  ];
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="mb-3 text-sm font-bold text-[var(--color-text)]">{t("eegLiteracyScores")}</div>
      <div className="space-y-3">
        {list.map((it) => (
          <ScoreBar key={it.key} label={it.label} value={scores[it.key] ?? 0} color={it.color} />
        ))}
      </div>
    </div>
  );
}

function ExplanationCards({ analysis }: { analysis: any }) {
  const { lang, t } = useLang();
  // 支持新旧两种数据结构
  const explanations = analysis?.explanations?.[lang] || analysis?.explanations;
  if (!explanations) return null;

  const cards = [
    { key: "beginner", label: t("beginnerMode"), hint: t("beginnerHint") },
    { key: "student",  label: t("studentMode"),  hint: t("studentHint") },
    { key: "research", label: t("researchMode"),  hint: t("researchHint") },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.key} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{c.hint}</div>
            <h4 className="text-sm font-bold text-[var(--color-text)]">{c.label}</h4>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--color-text-secondary)]">
              {explanations[c.key] || t("explanationFailed")}
            </p>
          </div>
        ))}
      </div>

      {/* Confidence + Limitations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="text-sm font-bold text-[var(--color-text)]">{t("interpretationConfidence")}</div>
          <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {(() => {
              const lvl = analysis.confidence?.level;
              if (!lvl) return "-";
              const k = `confidence${lvl}`;
              const l = t(k);
              return l === k ? lvl : l;
            })()}
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{analysis.confidence?.reason || ""}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 lg:col-span-2">
          <div className="text-sm font-bold text-[var(--color-text)]">{t("whatDataCannotTell")}</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
            {(analysis.limitations || []).map((x: string, i: number) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  );
}

function BandpowerChart({ bandpowerPercent }: { bandpowerPercent: Record<string, string> | undefined }) {
  const { t } = useLang();
  if (!bandpowerPercent || Object.keys(bandpowerPercent).length === 0) return null;
  // 固定频段展示顺序：α β δ θ γ（a, b, d, t, g）
  const BAND_DISPLAY_ORDER = ["alpha", "beta", "delta", "theta", "gamma"];
  const entries = BAND_DISPLAY_ORDER
    .filter((b) => bandpowerPercent[b] !== undefined)
    .map((b) => [b, bandpowerPercent[b]] as [string, string]);
  const maxVal = Math.max(...entries.map(([, v]) => parseFloat(v)), 1);
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="mb-3 text-sm font-bold text-[var(--color-text)]">{t("bandpowerPercent")}</div>
      <div className="space-y-2">
        {entries.map(([band, val]) => {
          const num = parseFloat(val);
          return (
            <div key={band} className="flex items-center gap-3">
              <span className="w-12 capitalize text-xs font-medium text-[var(--color-text-secondary)]">{band}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min((num / maxVal) * 100, 100)}%`,
                    backgroundColor:
                      band === "delta" ? "#ef4444" :
                      band === "alpha" ? "#3b82f6" :
                      band === "theta" ? "#facc15" :
                      band === "beta"  ? "#22c55e" :
                      band === "gamma" ? "#a855f7" : "#ef4444",
                  }}
                />
              </div>
              <span className="w-16 text-right text-xs font-mono text-[var(--color-text-secondary)]">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 导出 PDF：新窗口打开报告 HTML 再打印 ─────────────────────── */

function buildReportHtml(report: StoredReport, lang: string, t: (key: string) => string): string {
  const esc = (s: any): string =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const a = report.analysis as any;
  const bp = a?.bandpower as Record<string, number> | undefined;
  const scores = a?.eeg_literacy_scores as Record<string, number> | undefined;
  // 支持新旧两种数据结构
  const explanations = (a?.explanations?.[lang] || a?.explanations) as Record<string, string> | undefined;

  const scoreList = scores ? [
    { key: "learning_readability_score", label: t("learningReadability") },
    { key: "signal_clarity_score", label: t("signalClarity") },
    { key: "beginner_friendliness_score", label: t("beginnerFriendliness") },
    { key: "research_usefulness_score", label: t("researchUsefulness") },
    { key: "noise_complexity_score", label: t("noiseComplexity") },
  ] : [];

  const expCards = explanations ? [
    { key: "beginner", label: t("beginnerMode"), hint: t("beginnerHint") },
    { key: "student", label: t("studentMode"), hint: t("studentHint") },
    { key: "research", label: t("researchMode"), hint: t("researchHint") },
  ] : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>NeuroAccess Report - ${esc(report.fileName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #666; margin-bottom: 28px; }
  h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
  .meta-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .meta-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta-value { font-size: 14px; font-weight: 600; margin-top: 2px; color: #111; }
  .overview-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
  .overview-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
  .overview-label { font-size: 11px; color: #6b7280; }
  .overview-value { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .bp-row { display: flex; align-items: center; gap: 12px; margin-bottom: 7px; }
  .bp-label { width: 50px; font-size: 12px; text-transform: capitalize; color: #374151; }
  .bp-bar { flex: 1; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .bp-fill { height: 100%; border-radius: 4px; }
  .bp-val { width: 48px; font-size: 12px; text-align: right; font-family: monospace; color: #374151; }
  .score-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .score-label { width: 160px; font-size: 12px; color: #374151; }
  .score-bar { flex: 1; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .score-fill { height: 100%; border-radius: 4px; }
  .score-val { width: 40px; font-size: 12px; text-align: right; color: #374151; }
  .exp-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
  .exp-hint { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
  .exp-title { font-size: 14px; font-weight: 600; margin-bottom: 7px; color: #111; }
  .exp-text { font-size: 13px; line-height: 1.7; color: #374151; white-space: pre-line; }
  .confidence-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px; flex: 1; }
  .limitations-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px; flex: 2; }
  .box-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #111; }
  .box-text { font-size: 12px; color: #374151; line-height: 1.6; }
  .two-col { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 12px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <h1>NeuroAccess EEG Report</h1>
  <p class="subtitle">${esc(report.fileName)} &nbsp;·&nbsp; ${esc(report.date)}</p>

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">${t("fileName")}</div><div class="meta-value">${esc(report.fileName)}</div></div>
    <div class="meta-item"><div class="meta-label">${t("date")}</div><div class="meta-value">${esc(report.date)}</div></div>
    <div class="meta-item"><div class="meta-label">${t("mode")}</div><div class="meta-value">${esc(t(modeKey[report.mode] || report.mode))}</div></div>
    <div class="meta-item"><div class="meta-label">${t("signalQuality")}</div><div class="meta-value">${a?.signal_quality_score != null ? Number(Number(a.signal_quality_score).toFixed(3)) : "-"}</div></div>
    <div class="meta-item"><div class="meta-label">${t("channelCount")}</div><div class="meta-value">${a?.channel_count ?? "-"}</div></div>
    <div class="meta-item"><div class="meta-label">${t("samplingRate")}</div><div class="meta-value">${a?.sampling_rate ?? "-"} Hz</div></div>
  </div>

  ${bp && Object.keys(bp).length > 0 ? `
  <h2>Bandpower</h2>
  <div style="margin-bottom:20px">
    ${Object.entries(bp).map(([band, value]) => {
      const max = Math.max(...Object.values(bp));
      const pct = max > 0 ? (Number(value) / max) * 100 : 0;
      const color = band === "delta" ? "#ef4444" : band === "alpha" ? "#3b82f6" : band === "theta" ? "#facc15" : band === "beta" ? "#22c55e" : band === "gamma" ? "#a855f7" : "#ef4444";
      return `<div class="bp-row"><span class="bp-label">${esc(band)}</span><div class="bp-bar"><div class="bp-fill" style="width:${pct}%;background:${color}"></div></div><span class="bp-val">${Number(value).toFixed(1)}</span></div>`;
    }).join("")}
  </div>` : ""}

  ${scores ? `
  <h2>${t("eegLiteracyScores")}</h2>
  <div style="margin-bottom:20px">
    ${scoreList.map(it => {
      const v = scores[it.key] ?? 0;
      const barColors = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#f43f5e"];
      const idx = scoreList.indexOf(it);
      return `<div class="score-row"><span class="score-label">${esc(it.label)}</span><div class="score-bar"><div class="score-fill" style="width:${Math.min(100,Math.max(0,v))}%;background:${barColors[idx]}"></div></div><span class="score-val">${v}</span></div>`;
    }).join("")}
  </div>` : ""}

  ${explanations ? `
  <h2>Interpretations</h2>
  <div style="margin-bottom:20px">
    ${expCards.map(c => `<div class="exp-card"><div class="exp-hint">${esc(c.hint)}</div><div class="exp-title">${esc(c.label)}</div><div class="exp-text">${esc(explanations[c.key] || "-")}</div></div>`).join("")}
  </div>
  <div class="two-col">
    <div class="confidence-box"><div class="box-title">${esc(t("interpretationConfidence"))}</div><div class="box-text">${a?.confidence?.level ? (() => { const k = `confidence${a.confidence.level}`; const l = t(k); return esc(l === k ? a.confidence.level : l); })() : "-"}</div><div style="font-size:11px;color:#6b7280;margin-top:4px">${esc(a?.confidence?.reason || "")}</div></div>
    <div class="limitations-box"><div class="box-title">${esc(t("whatDataCannotTell"))}</div><ul style="padding-left:18px;font-size:12px;color:#374151;line-height:1.7">${(a?.limitations || []).map((x: any)=>`<li>${esc(x)}</li>`).join("")}</ul></div>
  </div>` : ""}

  <script>
    // 自动触发打印对话框，打印后自动关闭窗口
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
        // 打印对话框关闭后（或取消后）自动关闭窗口
        setTimeout(function() { window.close(); }, 500);
      }, 300);
    });
  <\/script>
</body>
</html>`;
}

/* ── Reports Page ─────────────────────────────────────────────── */

type ReportFilter = "all" | "favorites" | "eeg";

export default function ReportsPage() {
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<StoredReport | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const { lang, t } = useLang();
  const { user, loading } = useAuth();
  const router = useRouter();

  // 加载时从 localStorage 读取报告
  useEffect(() => {
    if (!loading) {
      setReports(loadReports());
      try { setFavorites(getFavorites()); } catch {}
      // 与服务器对账：服务器为真相源，排除已删 id、丢弃本地残留（已删/过期快照）
      reconcileReportsWithServer().then((merged) => {
        if (merged !== null) setReports(merged);
      });
    }
  }, [loading]);

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const filteredReports = reports.filter((r) => {
    if (filter === "all") return true;
    if (filter === "favorites") return favorites.includes(r.id);
    if (filter === "eeg") return !!(r.hasEegData || r.eegData);
    return true;
  });

  const allSelected = filteredReports.length > 0 && selected.length === filteredReports.length;
  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : filteredReports.map((r) => r.id));
  };

  const handleExport = (report: StoredReport) => {
    const html = buildReportHtml(report, lang, t);
    const printWin = window.open("", "_blank", "width=1000,height=800,scrollbars=yes");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
    } else {
      // 弹窗被拦截，提示用户允许弹窗
      alert(t("popupBlocked"));
    }
  };

  const handleDelete = (report: StoredReport) => {
    setDeleteTarget(report);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    // 本地记录已删 id（永久保留，不再清除），服务器也会记录删除墓碑 → 已删报告不会被拉回
    markDeleted(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    deleteReportFromStorage(id);
    deleteServerReport(id).catch(() => {});
    setSelected((prev) => prev.filter((x) => x !== id));
    setDeleteTarget(null);
  };

  const confirmBatchDelete = () => {
    setReports((prev) => prev.filter((r) => !selected.includes(r.id)));
    selected.forEach((id) => {
      markDeleted(id);
      deleteReportFromStorage(id);
      deleteServerReport(id).catch(() => {});
    });
    setSelected([]);
    setBatchDeleteOpen(false);
  };

  const handleCompare = () => {
    if (selected.length === 2) {
      sessionStorage.setItem("neuroaccess-compare-ids", JSON.stringify(selected));
      router.push("/reports/compare");
    }
  };

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
          <p className="text-lg font-medium text-[var(--color-text)]">{t("pleaseLogin")}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.05 }}
    >
      <section className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-8 pb-[env(safe-area-inset-bottom,16px)]">
        {/* 标题栏 */}
        <div className="mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("reportsTitle")}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t("reportsSubtitle")}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-[var(--color-text)]">{reports.length}</span>
              <span className="text-sm text-[var(--color-text-secondary)]">{t("totalReports") || "总报告数"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.length === 2 ? (
              <button
                onClick={handleCompare}
                className="flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--color-surface)] shadow-lg shadow-[var(--color-primary)]/10 transition-all duration-300 hover:opacity-90"
              >
                <GitCompare className="h-4 w-4" />
                {t("compareSelected")}
              </button>
            ) : (
              <Link
                href="/reports/compare"
                className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
              >
                <GitCompare className="h-4 w-4" />
                {t("compareReports")}
              </Link>
            )}
            <button onClick={() => setShowFormula(true)} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]">
              {t("scoringLogic")}
            </button>
          </div>
        </div>

        {/* 统计卡片已移除 */}

        {/* 筛选栏 */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-amber-500 text-white"
                : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {t("allReports") || "All"}
          </button>
          <button
            onClick={() => setFilter("favorites")}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              filter === "favorites"
                ? "bg-amber-500 text-white"
                : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Star className={`inline h-3 w-3 mr-1 ${filter === "favorites" ? "fill-current" : ""}`} />
            {t("favorites") || "Favorites"}
          </button>
          {selected.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  const next = new Set(favorites);
                  const allSelected = selected.every((id) => next.has(id));
                  if (allSelected) {
                    selected.forEach((id) => next.delete(id));
                  } else {
                    selected.forEach((id) => next.add(id));
                  }
                  const list = Array.from(next);
                  saveFavorites(list);
                  setFavorites(list);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
                title={t("batchFavorite") || "批量收藏"}
              >
                <Star className="h-3 w-3" />
                {t("batchFavorite") || "批量收藏"}
              </button>
              <button
                onClick={() => setBatchDeleteOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                title={t("delete") || "批量删除"}
              >
                <Trash2 className="h-3 w-3" />
                {t("batchDeleteCount").replace("{count}", String(selected.length))}
              </button>
            </div>
          )}
        </div>

        {/* 报告列表 */}
        {filteredReports.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-16 text-center"
          >
            <FileText className="mx-auto mb-4 h-12 w-12 text-[var(--color-text-secondary)]/70" />
            <p className="text-[var(--color-text-secondary)]">{t("noReports")}</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]/70">{t("noReportsDesc")}</p>
          </motion.div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {/* 表头 — 桌面端显示，移动端隐藏 */}
            <div className="hidden sm:grid grid-cols-[40px_1fr_140px_80px_100px_120px] gap-4 px-5 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                />
              </div>
              <div>{t("fileName")}</div>
              <div>{t("date")}</div>
              <div className="text-center">{t("duration") || "时长"}</div>
              <div className="text-center">{t("quality")}</div>
              <div className="text-right">{t("actions")}</div>
            </div>

            {/* 行 */}
            <AnimatePresence>
              {filteredReports.map((report, i) => (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                  transition={{ delay: i * 0.0125 }}
                  className="sm:grid grid-cols-[40px_1fr_140px_80px_100px_120px] gap-4 px-5 py-3.5 border-t border-[var(--color-border)] hover:bg-[var(--color-bg)]/50 transition-colors items-center"
                >
                  {/* 移动端：卡片式布局 */}
                  <div className="sm:hidden flex flex-col gap-2 w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={selected.includes(report.id)}
                          onChange={(e) => { e.stopPropagation(); toggleSelect(report.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer accent-[var(--color-primary)] flex-shrink-0"
                        />
                        <FileText className="h-4 w-4 flex-shrink-0 text-[var(--color-text-secondary)]" />
                        <span className="truncate text-sm font-mono">{report.fileName}</span>
                      </div>
                      <div className="flex items-center justify-center flex-shrink-0">
                        <span className={`text-sm ${scoreColor(report.quality)}`}>
                          {report.quality != null ? Number(report.quality).toFixed(0) : "-"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-8">
                      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                        <Calendar className="h-3 w-3" />
                        <span>{report.date}</span>
                        <span>·</span>
                        <span>{formatDuration(report.analysis, t)}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = toggleFavorite(report.id);
                            setFavorites((prev) => next ? [...prev, report.id] : prev.filter((x) => x !== report.id));
                          }}
                          className={`rounded-lg p-1.5 transition-colors ${favorites.includes(report.id) ? "text-amber-500" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-amber-500"}`}
                          title="Favorite"
                        >
                          <Star className={`h-3.5 w-3.5 ${favorites.includes(report.id) ? "fill-current" : ""}`} />
                        </button>
                        <Link href={`/reports/${report.id}`} onClick={(e) => e.stopPropagation()} className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]" title={t("viewDetail")}>
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                        <button onClick={(e) => { e.stopPropagation(); handleExport(report); }} className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]" title={t("exportPdf")}>
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(report); }} className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-red-50 hover:text-red-500 dark:text-red-400" title={t("delete")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 桌面端：表格式布局 */}
                  <div className="hidden sm:contents">
                  <input
                    type="checkbox"
                    checked={selected.includes(report.id)}
                    onChange={(e) => { e.stopPropagation(); toggleSelect(report.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-[var(--color-text-secondary)]" />
                    <span className="truncate text-sm font-mono">{report.fileName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                    <Calendar className="h-3 w-3" />
                    {report.date}
                  </div>
                  <div className="flex items-center justify-center text-xs text-[var(--color-text-secondary)]">
                    {formatDuration(report.analysis, t)}
                  </div>
                  <div className="flex items-center justify-center">
                    <span className={`text-sm ${scoreColor(report.quality)}`}>
                      {report.quality != null ? Number(report.quality).toFixed(0) : "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = toggleFavorite(report.id);
                        setFavorites((prev) => next ? [...prev, report.id] : prev.filter((x) => x !== report.id));
                      }}
                      className={`rounded-lg p-2 transition-colors ${favorites.includes(report.id) ? "text-amber-500" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-amber-500"}`}
                      title="Favorite"
                    >
                      <Star className={`h-4 w-4 ${favorites.includes(report.id) ? "fill-current" : ""}`} />
                    </button>
                    <Link href={`/reports/${report.id}`} onClick={(e) => e.stopPropagation()} className="rounded-lg p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] inline-flex" title={t("viewDetail")}>
                      <Eye className="h-4 w-4" />
                    </Link>
                    <button onClick={(e) => { e.stopPropagation(); handleExport(report); }} className="rounded-lg p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]" title={t("exportPdf")}>
                      <Download className="h-4 w-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(report); }} className="rounded-lg p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-red-50 hover:text-red-500 dark:text-red-400" title={t("delete")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* 浮动对比按钮：选 2 个时显示 */}
        <AnimatePresence>
          {false && selected.length === 2 && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={() => router.push(`/reports/compare?ids=${selected[0]},${selected[1]}`)}
              className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-3 text-sm font-semibold text-white shadow-2xl hover:opacity-90 transition-opacity"
            >
              <GitCompare className="h-4 w-4" />
              {t("compareReports") || "对比选中的 2 个报告"}
            </motion.button>
          )}
        </AnimatePresence>
      </section>

      {/* 批量删除确认弹窗 */}
      <AnimatePresence>
        {batchDeleteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => setBatchDeleteOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-6 w-6 text-red-500 dark:text-red-400" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[var(--color-text)]">{t("batchDelete")}</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t("batchDeleteConfirm").replace("{count}", String(selected.length))}
                </p>
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-6 py-4">
                <button
                  onClick={() => setBatchDeleteOpen(false)}
                  className="flex-1 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={confirmBatchDelete}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                >
                  {t("confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除确认弹窗 */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-6 w-6 text-red-500 dark:text-red-400" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[var(--color-text)]">{t("confirmDelete")}</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">{t("confirmDeleteDesc")}</p>
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-6 py-4">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                >
                  {t("confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scoring Formula Modal */}
      <AnimatePresence>
        {showFormula && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFormula(false)}
          >
            <motion.div
              className="mx-4 w-full max-w-lg rounded-2xl bg-[var(--color-surface)] p-6 shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-4 text-lg font-bold text-[var(--color-text)]">{t("scoringLogic")}</h3>
              <div className="space-y-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                <p className="font-mono text-[var(--color-text)]">{t("scoringFormulaDesc")}</p>
                <p>{t("scoringNoiseDesc")}</p>
                <p>{t("scoringArtifactDesc")}</p>
                <p className="font-semibold text-[var(--color-text)]">{t("scoringRangeTitle")}</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>{t("scoringRangeExcellent")}</li>
                  <li>{t("scoringRangeGood")}</li>
                  <li>{t("scoringRangeFair")}</li>
                  <li>{t("scoringRangePoor")}</li>
                  <li>{t("scoringRangeBad")}</li>
                </ul>
              </div>
              <button
                onClick={() => setShowFormula(false)}
                className="mt-5 w-full rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
              >
                {t("close")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
