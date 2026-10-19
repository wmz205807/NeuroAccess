"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useLang } from "@/lib/language-context";
import { formatDuration } from "@/lib/duration";
import { useAuth } from "@/lib/auth-context";
import { useAnalysis } from "@/lib/analysis-context";
import DownloadDataButton from "@/components/DownloadDataButton";
import { useDownloadBtnHidden } from "@/lib/download-btn-state";
import AnalysisSteps from "@/components/AnalysisSteps";
import ReportEEGChart from "@/components/ReportEEGChart";
import {
  UploadCloud,
  DownloadCloud,
  FileText,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
    Cpu, Pause, RefreshCw, RotateCcw,
    Info,
  } from "lucide-react";

type Status = "pending" | "reading" | "computing" | "analysisReady" | "explaining" | "completed" | "failed";

// ── 游客相关文案（自包含七语言，避免污染共享的 translations.ts）────────
type GL = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";
const GUEST_TXT: Record<GL, {
  sampleNames: Record<string, string>;
  resultTitle: string;
  saveTitle: string;
  saveBody: string;
  saveCta: string;
  signIn: string;
  bandPowerTitle: string;
  qualityTitle: string;
}> = {
  zh: {
    sampleNames: { clean: "示例：干净 EEG", noisy: "示例：含噪 EEG", frequency: "示例：频率示例（真实 64 通道）" },
    resultTitle: "分析结果",
    saveTitle: "创建账户即可保存这份报告",
    saveBody: "当前结果只存在于本次浏览会话中，不会保存。注册后可以保存分析历史、在不同设备上查看报告。",
    saveCta: "创建账户",
    signIn: "登录",
    bandPowerTitle: "各频段相对功率",
    qualityTitle: "信号质量评分",
  },
  en: {
    sampleNames: { clean: "Sample: Clean EEG", noisy: "Sample: Noisy EEG", frequency: "Sample: Frequency example (real 64-ch)" },
    resultTitle: "Analysis result",
    saveTitle: "Create an account to save this report",
    saveBody: "This result only exists in your current browsing session and is not stored. With an account you can keep your analysis history and view reports across devices.",
    saveCta: "Create an account",
    signIn: "Sign in",
    bandPowerTitle: "Relative band power",
    qualityTitle: "Signal quality score",
  },
  ja: {
    sampleNames: { clean: "サンプル：クリーン EEG", noisy: "サンプル：ノイズ入り EEG", frequency: "サンプル：周波数の例（実 64ch）" },
    resultTitle: "分析結果",
    saveTitle: "アカウントを作成するとこのレポートを保存できます",
    saveBody: "この結果は現在の閲覧セッション内にのみ存在し、保存されません。アカウントがあれば分析履歴を保存し、別の端末でも確認できます。",
    saveCta: "アカウントを作成",
    signIn: "ログイン",
    bandPowerTitle: "各帯域の相対パワー",
    qualityTitle: "信号品質スコア",
  },
  es: {
    sampleNames: { clean: "Muestra: EEG limpio", noisy: "Muestra: EEG con ruido", frequency: "Muestra: ejemplo de frecuencia (64 canales reales)" },
    resultTitle: "Resultado del análisis",
    saveTitle: "Crea una cuenta para guardar este informe",
    saveBody: "Este resultado solo existe en tu sesión de navegación actual y no se almacena. Con una cuenta puedes conservar tu historial y ver informes en otros dispositivos.",
    saveCta: "Crear una cuenta",
    signIn: "Iniciar sesión",
    bandPowerTitle: "Potencia relativa por banda",
    qualityTitle: "Puntuación de calidad de señal",
  },
  fr: {
    sampleNames: { clean: "Exemple : EEG propre", noisy: "Exemple : EEG bruité", frequency: "Exemple : fréquences (64 canaux réels)" },
    resultTitle: "Résultat de l'analyse",
    saveTitle: "Créez un compte pour enregistrer ce rapport",
    saveBody: "Ce résultat n'existe que dans votre session de navigation actuelle et n'est pas conservé. Avec un compte, vous conservez votre historique et retrouvez vos rapports sur d'autres appareils.",
    saveCta: "Créer un compte",
    signIn: "Se connecter",
    bandPowerTitle: "Puissance relative par bande",
    qualityTitle: "Score de qualité du signal",
  },
  de: {
    sampleNames: { clean: "Beispiel: Sauberes EEG", noisy: "Beispiel: Verrauschtes EEG", frequency: "Beispiel: Frequenzen (echte 64 Kanäle)" },
    resultTitle: "Analyseergebnis",
    saveTitle: "Konto erstellen, um diesen Bericht zu speichern",
    saveBody: "Dieses Ergebnis existiert nur in Ihrer aktuellen Browsersitzung und wird nicht gespeichert. Mit einem Konto behalten Sie Ihren Verlauf und sehen Berichte auf anderen Geräten.",
    saveCta: "Konto erstellen",
    signIn: "Anmelden",
    bandPowerTitle: "Relative Bandleistung",
    qualityTitle: "Signalqualitätswert",
  },
  ko: {
    sampleNames: { clean: "샘플: 깨끗한 EEG", noisy: "샘플: 잡음 있는 EEG", frequency: "샘플: 주파수 예시(실제 64채널)" },
    resultTitle: "분석 결과",
    saveTitle: "계정을 만들면 이 보고서를 저장할 수 있습니다",
    saveBody: "이 결과는 현재 브라우징 세션에만 존재하며 저장되지 않습니다. 계정이 있으면 분석 기록을 보관하고 다른 기기에서도 볼 수 있습니다.",
    saveCta: "계정 만들기",
    signIn: "로그인",
    bandPowerTitle: "대역별 상대 파워",
    qualityTitle: "신호 품질 점수",
  },
};



// ── 水平进度条 ──────────────────────────────────────────────────────
function ProgressBar({ status }: { status: Status }) {
  const { t } = useLang();
  const map: Record<Status, { label: string; pct: number; color: string }> = {
    pending:     { label: "pending", pct: 0,   color: "bg-[var(--color-border)]" },
    reading:     { label: "reading", pct: 33,  color: "bg-blue-500" },
    computing:   { label: "computing", pct: 66, color: "bg-amber-500" },
    analysisReady: { label: "analysisReady", pct: 80, color: "bg-emerald-500" },
    explaining:  { label: "explaining", pct: 80, color: "bg-purple-500" },
    completed:   { label: "completed", pct: 100, color: "bg-emerald-500" },
    failed:      { label: "failed", pct: 100,  color: "bg-red-500" },
  };
  const { label, pct, color } = map[status] || map.pending;
  const isRunning = status === "reading" || status === "computing" || status === "explaining";

  return (
    <div className="flex items-center gap-2">
      {/* 进度条固定宽度，不随语言文本长度变化 */}
      <div className="w-24 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color} ${isRunning ? "animate-pulse" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">
        {t(label)}
      </span>
    </div>
  );
}

// ── OverviewCard ─────────────────────────────────────────────────────
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

// ── ScoreBar ──────────────────────────────────────────────────────────
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

// ── LiteracyScores ──────────────────────────────────────────────────
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

// ── ExplanationCards ───────────────────────────────────────────────
function ExplanationCards({ analysis }: { analysis: any }) {
  const { lang, t } = useLang();
  const explanations = analysis?.explanations?.[lang] || analysis?.explanations;
  if (!explanations) return null;

  const cards = [
    { key: "beginner", label: t("beginnerMode"), hint: t("beginnerHint") },
    { key: "student",  label: t("studentMode"),  hint: t("studentHint") },
    { key: "research", label: t("researchMode"), hint: t("researchHint") },
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
          <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">{analysis.confidence?.reason || ""}</div>
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

// ── GuestExplanations ──────────────────────────────────────────────
// 三档分层解释（Beginner / Advanced / Research）。
// 注意：这里刻意不渲染「置信度 / 局限性 / 免责声明」区块——用户明确要求过移除。
function GuestExplanations({ analysis }: { analysis: any }) {
  const { lang, t } = useLang();
  const explanations = analysis?.explanations?.[lang] || analysis?.explanations?.en || analysis?.explanations;
  if (!explanations || typeof explanations !== "object") return null;

  const cards = [
    { key: "beginner", label: t("beginnerMode"), hint: t("beginnerHint") },
    { key: "student",  label: t("studentMode"),  hint: t("studentHint") },
    { key: "research", label: t("researchMode"), hint: t("researchHint") },
  ].filter((c) => explanations[c.key]);

  if (!cards.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {cards.map((c) => (
        <div key={c.key} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{c.hint}</div>
          <h4 className="text-sm font-bold text-[var(--color-text)]">{c.label}</h4>
          <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--color-text-secondary)]">
            {explanations[c.key]}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── GuestResultView ────────────────────────────────────────────────
// 游客分析结束后就地展示完整结果（复用报告页同款组件），
// 并提示「创建账户即可保存」——而不是在体验之前要求登录。
function GuestResultView({ analysis }: { analysis: any }) {
  const { t, lang } = useLang();
  const gt = GUEST_TXT[(lang as GL)] || GUEST_TXT.en;
  if (!analysis) return null;

  const bands = [
    { key: "delta", label: t("bandDelta"), cls: "text-red-600 dark:text-red-400" },
    { key: "theta", label: t("bandTheta"), cls: "text-yellow-600 dark:text-yellow-400" },
    { key: "alpha", label: t("bandAlpha"), cls: "text-blue-600 dark:text-blue-400" },
    { key: "beta",  label: t("bandBeta"),  cls: "text-green-600 dark:text-green-400" },
    { key: "gamma", label: t("bandGamma"), cls: "text-purple-600 dark:text-purple-400" },
  ];
  const bp = analysis.bandpower_percent || analysis.frequency_analysis?.bandpower_percent || {};
  const quality = analysis.signal_quality_score;
  const literacy = analysis.literacy_scores || analysis.eeg_literacy_scores;

  return (
    <div className="space-y-4" id="guest-result">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-sm font-bold text-[var(--color-text)] sm:text-base">{gt.resultTitle}</h2>
      </div>

      <OverviewCard analysis={analysis} />

      {/* 波形（服务器无记录时组件会自动回退用本地 waveform_preview 渲染）*/}
      <ReportEEGChart
        reportFileName={analysis.file_name || "sample"}
        analysis={analysis}
        id={`guest-${analysis.analysis_id || ""}`}
      />

      {/* 频段相对功率 + 信号质量 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 lg:col-span-2">
          <div className="mb-3 text-sm font-bold text-[var(--color-text)]">{gt.bandPowerTitle}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {bands.map((b) => (
              <div key={b.key} className="rounded-xl border border-[var(--color-border)] p-3 text-center">
                <div className={`text-base font-bold ${b.cls}`}>{bp[b.key] ?? "0%"}</div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">{b.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="text-sm font-bold text-[var(--color-text)]">{gt.qualityTitle}</div>
          <div className="mt-2 text-3xl font-bold text-[var(--color-text)]">
            {quality != null ? Number(quality).toFixed(0) : "-"}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">/ 100</div>
        </div>
      </div>

      {literacy && <LiteracyScores scores={literacy} />}

      <GuestExplanations analysis={analysis} />
    </div>
  );
}

// ── FileCard ────────────────────────────────────────────────────────
function FileCard({
  item, expanded, onToggle, onRemove, running, paused, onRetry, hideReportLink,
}: {
  item: any;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  running: boolean;
  paused: boolean;
  onRetry?: (id: string) => void;
  hideReportLink?: boolean;
}) {
  const { t } = useLang();

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 flex-1">
          <FileText className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 text-[var(--color-text-secondary)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs sm:text-sm font-medium text-[var(--color-text)]">{item.name}</div>
            <div className="text-[10px] sm:text-xs text-[var(--color-text-secondary)]">
              {(item.size / 1024 / 1024).toFixed(2)} {t("mb")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <ProgressBar status={item.status} />
          {item.status === "failed" && onRetry && (
            <button onClick={() => onRetry(item.id)} className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-amber-950/30 hover:text-amber-400" title={t("retry")}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {(!running || paused) && item.status !== "reading" && item.status !== "computing" && item.status !== "explaining" && (
            <button onClick={onRemove} className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-red-950/30 hover:text-red-400">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 分析进行中：显示真实分步进度（上传字节进度 + 后端上报的真实阶段）*/}
      {(item.status === "reading" || item.status === "computing" ||
        item.status === "analysisReady" || item.status === "explaining") && (
        <div className="border-t border-[var(--color-border)] px-3 sm:px-5 py-3">
          <AnalysisSteps status={item.status} stage={item.stage} uploadPct={item.uploadPct} />
        </div>
      )}

      {item.error && (
        <div className="mx-5 mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-2.5 text-xs text-red-700 dark:text-red-400">
          {item.error}
        </div>
      )}

      {expanded && (item.status === "completed") && !item.error && !hideReportLink && (
        <div className="border-t border-[var(--color-border)] px-5 py-4">
          <div className="text-center">
            <Link
              href="/reports"
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
            >
              {t("viewInReports") || "View report →"}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat badge ──────────────────────────────────────────────────────
function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${color}`}>
      {label}: {value}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD INNER (consumes context from root layout AnalysisProvider)
// ═══════════════════════════════════════════════════════════════

function DashboardInner() {
  const { t, lang } = useLang();
  const { user, loading } = useAuth();
  const downloadHidden = useDownloadBtnHidden();
  const {
    files, running, paused, expandId, setExpandId,
    handleFileSelect, removeFile, clearAll, startAnalysis, pauseAnalysis, resumeAnalysis, retryFile,
    analyzeSample,
  } = useAnalysis();

  // ── 游客体验状态 ────────────────────────────────────────────────
  const isGuest = !user;
  const guestTxt = GUEST_TXT[(lang as GL)] || GUEST_TXT.en;

  // 游客已完成的分析（就地展示，不写数据库）
  // 2026-10-18：**改成取「所有已完成的文件」**。原来只用 find() 取最近一个
  //   ⇒ 游客同时分析两个文件时，第二个把第一个顶掉，只看到一份报告
  //   （用户报「同时分析两个文件为什么只能产出一份报告」）。
  // 仍要求 status === "completed"：六步全走完（含 AI 分级解读）才展示，避免第 6 步未完成就出报告。
  const guestFiles = isGuest
    ? files.filter((f: any) => f.result && f.status === "completed")
    : [];

  // ── 游客分析配额标注（2026-10-18）────────────────────────────
  // 用户要求「游客模式下要标注」：把上限常驻显示出来，不能等第 4 次才蹦错误。
  // 数据来自 GET /api/guest-quota；每次多出一份完成结果时刷新（分析成功后已计入）。
  const [guestQuota, setGuestQuota] = useState<{ limit: number; used: number; remaining: number } | null>(null);
  useEffect(() => {
    if (!isGuest) { setGuestQuota(null); return; }
    let cancelled = false;
    fetch("/api/guest-quota")
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.success && j.guest) setGuestQuota({ limit: j.limit, used: j.used, remaining: j.remaining }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isGuest, guestFiles.length]);

  // 2026-10-15：原先这里有个 handleTrySample（游客落地区的「试试示例 EEG」按钮用），
  // 落地区整页删除后它已无人调用，连同 busySample 状态一起移除。
  // 游客现在直接上传自己的 .edf 使用工作台。

  // ── 自动展开最近的活动文件（页面切换回来时显示当前进度）─────────
  useEffect(() => {
    // 优先展开正在分析的文件
    const active = files.find(f =>
      f.status === "reading" || f.status === "computing" || f.status === "explaining"
    );
    if (active) {
      setExpandId(active.id);
      return;
    }
    // 其次展开最近完成的文件
    const completed = [...files].reverse().find(f => f.status === "completed" || f.status === "analysisReady");
    if (completed) {
      setExpandId(completed.id);
      return;
    }
    // 都不存在则折叠
    setExpandId(null);
  }, [files, setExpandId]);
  const [aiStatus, setAiStatus] = useState<{ online: boolean; model: string; mode: string } | null>(null);
  const aiFailCountRef = useRef(0);
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        if (data.openrouter === true) {
          aiFailCountRef.current = 0;
          setAiStatus({
            online: true,
            model: "deepseek-v4-flash",
            mode: t("apiMode"),
          });
        } else {
          aiFailCountRef.current++;
          if (aiFailCountRef.current >= 2) {
            setAiStatus({ online: false, model: "-", mode: t("cpuMode") });
          }
        }
      } catch {
        aiFailCountRef.current++;
        if (aiFailCountRef.current >= 2) {
          setAiStatus({ online: false, model: "-", mode: t("cpuMode") });
        }
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [t]);

  const stats = {
    total:      files.length,
    completed:  files.filter((f: any) => f.status === "completed").length,
    failed:     files.filter((f: any) => f.status === "failed").length,
    processing:  files.filter((f: any) => f.status === "reading" || f.status === "computing" || f.status === "explaining").length,
  };
  // 分析进行中 = 正在运行且未暂停（暂停后可以继续上传文件）
  const hasActiveAnalysis = running && !paused;

  // 2026-10-15：游客落地区（GuestLanding）已按用户要求**整页彻底删除**。
  // 游客与登录用户一样，直接看到分析工作台。
  // 因此这里不再有 loading 早返回分支：SSR 阶段 user 尚为 undefined，会直接落到
  // 下面的主 return 渲染工作台，客户端水合后也不跳变。

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 0.8, 0.22, 1] }}
      className="mx-auto max-w-5xl space-y-4 sm:space-y-6 px-3 sm:px-6 py-4 sm:py-8 pb-[env(safe-area-inset-bottom,16px)]"
    >
      {/* 2026-10-16：游客落地区删除后，首页**一个 h1 都没有了** —— 对 SEO 与读屏
          都是缺陷。这里补一个**视觉隐藏**的 h1：语义上有标题，外观完全不变。 */}
      <h1 className="sr-only">{t("uploadEEG")}</h1>

      {/* 网站介绍 —— 2026-10-18：**游客也显示**。
          原来的条件是 `!isGuest`，理由是「游客已有 Hero，不重复」；
          但游客落地区（含 Hero）整页删除后，游客首页就只剩一个上传框、一句说明都没有。
          现在两条路径都展示这段定位说明，游客第一次进来也能知道这是干什么的。 */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-50/80 to-cyan-50/80 dark:from-blue-950/30 dark:to-cyan-950/30 border border-blue-200/50 dark:border-blue-800/30 p-5 text-sm leading-relaxed text-[var(--color-text)]">
        {t("siteIntro")}
        <span className="mt-2 block font-semibold text-blue-600 dark:text-blue-400 text-sm">{t("freePlatform")}</span>
      </div>

      {/* 游客配额标注（2026-10-18 用户要求）—— 常驻显示上限与剩余次数 */}
      {isGuest && guestQuota && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs leading-5 ${
            guestQuota.remaining > 0
              ? "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-secondary)]"
              : "border-amber-300/60 bg-amber-50/70 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300"
          }`}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            {guestQuota.remaining > 0
              ? (lang === "zh"
                  ? `游客模式：最多可分析 ${guestQuota.limit} 个文件，还剩 ${guestQuota.remaining} 次。注册后不限次数。`
                  : `Guest mode: up to ${guestQuota.limit} files, ${guestQuota.remaining} left. Register for unlimited analyses.`)
              : (lang === "zh"
                  ? `游客模式：${guestQuota.limit} 次已用完。注册后可继续分析。`
                  : `Guest mode: all ${guestQuota.limit} analyses used. Register to continue.`)}
            {guestQuota.remaining <= 0 && (
              <Link
                href="/register"
                className="ml-1.5 font-semibold text-[var(--color-primary)] hover:underline"
              >
                {lang === "zh" ? "去注册 →" : "Sign up →"}
              </Link>
            )}
          </span>
        </div>
      )}

      {/* EEG Analysis Panel */}
      <div className="space-y-6" id="upload">
        {/* Upload area */}
        {!hasActiveAnalysis ? (
          (isGuest && guestQuota && guestQuota.remaining <= 0) ? (
            /* 游客额度用完 ⇒ 上传区直接不可用（2026-10-18 用户要求「不能继续分析」） */
            <div className="rounded-3xl border-2 border-dashed border-amber-300/70 bg-amber-50/60 p-6 sm:p-10 text-center dark:border-amber-700/40 dark:bg-amber-950/20">
              <Info className="mx-auto mb-3 h-8 w-8 text-amber-500" />
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {lang === "zh"
                  ? `游客模式已用完 ${guestQuota.limit} 次分析额度`
                  : `Guest limit reached (${guestQuota.limit} analyses)`}
              </p>
              <p className="mt-1.5 text-xs leading-6 text-[var(--color-text-secondary)]">
                {lang === "zh"
                  ? "注册后不限次数，还能把报告保存到账号里。"
                  : "Register for unlimited analyses and to save your reports."}
              </p>
              <Link
                href="/register"
                className="mt-3 inline-flex rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90"
              >
                {lang === "zh" ? "免费注册 →" : "Sign up free →"}
              </Link>
            </div>
          ) : (
          <label
            className="rounded-3xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-10 text-center shadow-sm transition-colors hover:border-[var(--color-text-secondary)] active:border-[var(--color-primary)] cursor-pointer min-h-[160px] flex flex-col items-center justify-center w-full"
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
          >
            <UploadCloud className="mx-auto mb-2 sm:mb-4 h-6 w-6 sm:h-10 sm:w-10 text-[var(--color-text-secondary)]" />
            <span className="block text-xs sm:text-base font-medium text-[var(--color-text)]">{t("dragOrClick")}</span>
            <span className="mt-1 block text-[11px] sm:text-sm text-[var(--color-text-secondary)]">{t("supportedFormats")}</span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => { handleFileSelect(e.target.files); if (e.target) e.target.value = ""; }}
            />
          </label>
          )
        ) : (
          <div
            className="rounded-3xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/50 p-10 text-center opacity-60"
          >
            <Activity className="mx-auto mb-4 h-10 w-10 text-amber-500 animate-pulse" />
            <p className="text-sm font-medium text-[var(--color-text)]">{t("uploadDisabledDuringAnalysis")}</p>
          </div>
        )}

        {/* 下载测试文件按钮（弹窗选择学习包；可隐藏移入设置）。
            2026-10-18：按用户要求恢复右下角悬浮形态（原位置）。 */}
        {!hasActiveAnalysis && !downloadHidden && (
          <DownloadDataButton fixed />
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <StatBadge label={t("totalFiles")}  value={stats.total}     color="bg-[var(--color-border)] text-[var(--color-text-secondary)]" />
                <StatBadge label={t("completed")}   value={stats.completed} color="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" />
                <StatBadge label={t("failed")}      value={stats.failed}    color="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400" />
                <StatBadge label={t("processing")}  value={stats.processing} color="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" />
              </div>
              <div className="flex gap-2">
                {/* Primary button: Start / Processing (disabled) / Resume */}
                <button
                  onClick={() => {
                    if (paused) {
                      resumeAnalysis();
                    } else {
                      startAnalysis();
                    }
                  }}
                  disabled={files.length === 0 || (running && !paused)}
                  className="rounded-2xl bg-[var(--color-primary)] dark:bg-[var(--color-primary)] dark:text-[var(--color-bg)] px-6 py-2.5 text-sm font-semibold text-[var(--color-bg)] transition-colors hover:opacity-90 disabled:opacity-40"
                >
                  {paused ? (t("resumeAnalysis") || "Resume") : (
                    running ? t("processing") : (t("startAnalysis") || "Start Analysis")
                  )}
                </button>

                {/* Secondary button: Pause (when running, not paused) / Clear (when paused or idle) */}
                {running && !paused ? (
                  <button
                    onClick={pauseAnalysis}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)]"
                  >
                    <Pause className="inline h-4 w-4" /> {t("pauseAnalysis") || "Pause"}
                  </button>
                ) : (
                  <button
                    onClick={clearAll}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)]"
                  >
                    <Trash2 className="inline h-4 w-4" /> {t("clearAll")}
                  </button>
                )}
              </div>
            </div>
            {files.map((item: any) => (
                <FileCard
                  key={item.id}
                  item={item}
                  expanded={expandId === item.id}
                  onToggle={() => setExpandId(expandId === item.id ? null : item.id)}
                  onRemove={() => removeFile(item.id)}
                  running={running}
                  paused={paused}
                  onRetry={retryFile}
                  hideReportLink={isGuest}
                />
            ))}
            {paused && files.length > 1 && (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center text-sm text-[var(--color-text-secondary)]">
                {t("batchSummary")}：{stats.completed} / {stats.total} {t("completed").toLowerCase()}，{stats.failed} {t("failed").toLowerCase()}
              </div>
            )}
          </div>
        )}

        {/* ── 游客结果：每个已完成的文件各出一份 + 末尾一次注册提示 ────────── */}
        {isGuest && guestFiles.length > 0 && (
          <>
            {guestFiles.map((f: any) => (
              <GuestResultView key={f.id} analysis={f.result} />
            ))}
            <div className="rounded-2xl border border-blue-200/60 bg-blue-50/70 p-4 dark:border-blue-800/40 dark:bg-blue-950/30">
              <div className="text-sm font-bold text-[var(--color-text)]">{guestTxt.saveTitle}</div>
              <p className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">{guestTxt.saveBody}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/register"
                  className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90"
                >
                  {guestTxt.saveCta}
                </Link>
                <Link
                  href="/login"
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-text-secondary)]"
                >
                  {guestTxt.signIn}
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {/* AI Status Bar — 永远绿色，不管AI是否在线（分析用模板兜底，不影响功能） */}
      {aiStatus && aiStatus.online && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-xs border-t border-[var(--color-border)] mt-4">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 dark:text-green-400" />
          <span className="font-medium text-green-700 dark:text-green-400">{t("aiModelLabel")}</span>
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD CLIENT（原 src/app/page.tsx；现由服务端 page.tsx 渲染）
// ═══════════════════════════════════════════════════════════════

export default function DashboardClient() {
  return <DashboardInner />;
}
