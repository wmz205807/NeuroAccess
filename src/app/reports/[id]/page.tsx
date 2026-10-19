"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, FileX, FileText, Waves, AlertTriangle, Download } from "lucide-react";
import { StoredReport, getReportById, fetchServerReport, addReport } from "@/lib/reports-storage";
import { useLang } from "@/lib/language-context";
import ReportDetail from "@/components/ReportDetail";
import { downloadCSV } from "@/lib/csv-export";

import ReportEEGChart from "@/components/ReportEEGChart";

type Tab = "analysis" | "eeg";

// ── Error Boundary: 组件渲染异常不导致整页白屏 ──────────────────
import { Component, type ReactNode } from "react";
class ReportErrorBoundary extends Component<{ children: ReactNode; fallback: string }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500 dark:text-amber-400 mb-3" />
          <p className="text-sm text-[var(--color-text-secondary)]">{this.props.fallback}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, lang } = useLang();
  const [report, setReport] = useState<StoredReport | null | undefined>(
    undefined
  ); // undefined=loading, null=not found
  const [activeTab, setActiveTab] = useState<Tab>("analysis");

  useEffect(() => {
    let cancelled = false;
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("neuroaccess-token") || ""
        : "";
    if (!token) {
      router.push("/login");
      return;
    }
    const found = getReportById(id);

    // 本地波形状态：有波形且为新格式（wpSchema===2）才是真实波形；旧格式(min/max成对)是假波形，需从服务器取新波形。
    const localWp = (found?.analysis as any)?.waveform_preview;
    const hasLocalWp = !!(localWp?.channels && Object.keys(localWp.channels).length > 0);
    const localWpStale = hasLocalWp && (!localWp.wpSchema || localWp.wpSchema < 2);
    // 列表接口不再下发波形（轻量摘要）→ 本地报告可能是"无波形的摘要"。
    // 摘要先不渲染：等服务器完整报告到达再一次性渲染，避免波形页先显示服务端压缩版、
    // 切走再切回才变正确版的闪烁。本地已有真实波形时立即渲染（零延迟）。
    const localHasWaveform = hasLocalWp || !!((found?.analysis as any)?.band_waveforms);
    setReport(localHasWaveform ? found : undefined);
    // 后台同步：把服务端最新数据写回 localStorage 供下次打开更全。
    // 本地缺报告/缺波形、或本地波形是旧格式（假波形）时，用服务端完整报告渲染（一次性补齐真实波形）；
    // 本地已有新格式波形则绝不 setReport 覆盖已显示页面 —— 打开瞬间零延迟、无内容变化。
    // 注意：本地完全找不到报告时不能直接显示"没有报告"——本地缓存可能因存储配额被压缩掉，
    // 必须从服务器拉取；拉不到才真的是没有。
    const loadServerReport = async () => {
      const serverReport = await fetchServerReport(id).catch(() => null);
      if (serverReport?.analysis) {
        // 2026-10-18：原来只要「本地有新格式波形」就绝不覆盖 ⇒ 永远用 localStorage 里那份。
        // 但 localStorage 存的是 /api/analyze 的**降采样**预览（63 通道长文件只剩 ~21 点/秒），
        // 而服务器返回的是 DB 里的**全分辨率**（/api/reports/get 不再抽稀）⇒ 画出来一条稀疏折线，
        // 用户判定「很假」。这里改成**比点数**：服务器明显更密就用服务器的。
        const srvChs = (serverReport.analysis as any)?.waveform_preview?.channels || {};
        const srvNames = Object.keys(srvChs);
        const srvPts = srvNames.length ? (srvChs[srvNames[0]] || []).length : 0;
        const locChs = (localWp as any)?.channels || {};
        const locNames = Object.keys(locChs);
        const locPts = locNames.length ? (locChs[locNames[0]] || []).length : 0;
        const serverRicher = srvPts > locPts * 1.2;
        if (!cancelled && (!found || !hasLocalWp || localWpStale || serverRicher)) {
          setReport(serverReport as StoredReport);
        }
        try { addReport(serverReport as StoredReport); } catch {}
      } else if (!found && !cancelled) {
        // 本地与服务器都没有 → 才是真的不存在
        setReport(null);
      } else if (!cancelled && !localHasWaveform) {
        // 服务器取不到完整报告但本地有摘要 → 用摘要兜底（至少能看文字分析，波形显示不可用）
        setReport(found);
      }
      // 仅静默写回 AI 解释缓存到本地（下次打开即用），不触发任何重渲染
      const aid = (serverReport?.analysis || found?.analysis)?.analysis_id;
      if (aid) {
        fetch(`/api/analysis/explanations/${aid}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success && data.explanations) {
              const enriched = {
                ...(serverReport || found),
                analysis: { ...(serverReport || found).analysis, explanations: data.explanations },
              } as StoredReport;
              try {
                addReport(enriched);
              } catch {}
              // 同步更新当前 report state，避免深链/新会话首屏仍显示模板文案
              setReport((prev) =>
                prev ? { ...prev, analysis: { ...prev.analysis, explanations: data.explanations } } : prev
              );
            }
          })
          .catch(() => {});
      }
    };
    loadServerReport();

    return () => { cancelled = true; };
  }, [id, router]);


  // Loading state
  if (report === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]" />
      </div>
    );
  }

  // Not found
  if (report === null) {
    return (
      <motion.div
        className="mx-auto max-w-lg px-6 py-20 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <FileX className="mx-auto mb-4 h-12 w-12 text-[var(--color-text-secondary)]" />
        <h2 className="text-lg font-bold text-[var(--color-text)]">
          {t("noReports")}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {t("noReportsDesc")}
        </p>
        <Link
          href="/reports"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("reports")}
        </Link>
      </motion.div>
    );
  }

  // Found
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 0.8, 0.22, 1] }}
    >
      {/* Header with back button */}
      <div className="px-6 pt-6 flex items-center justify-between">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("reports")}
        </Link>
        <button
          onClick={() => downloadCSV(report.id, report.fileName || "report", lang)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] transition-colors"
          title="Download CSV data"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>

      {/* Tab bar */}
      <div className="px-6 pt-4">
        <div className="flex gap-1 border-b border-[var(--color-border)]">
          <button
            onClick={() => setActiveTab("analysis")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "analysis"
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <FileText className="h-4 w-4" />
            {t("reportAnalysisTab")}
          </button>
          <button
            onClick={() => setActiveTab("eeg")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "eeg"
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Waves className="h-4 w-4" />
            {t("eegChartTab")}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="p-6">
        {activeTab === "analysis" && (
          <div>
            <ReportErrorBoundary fallback={t("reportLoadError")}>
              <ReportDetail report={report} />
            </ReportErrorBoundary>
          </div>
        )}
        {activeTab === "eeg" && (
          <div>
            <ReportErrorBoundary fallback={t("noBandWaveform")}>
              <ReportEEGChart key={report.id + "eeg"} reportFileName={report.fileName} analysis={report.analysis} id={report.id} />
            </ReportErrorBoundary>
          </div>
        )}
      </div>
    </motion.div>
  );
}
