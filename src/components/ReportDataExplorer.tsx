"use client";

import { useLang } from "@/lib/language-context";
import { formatDuration, durationSeconds } from "@/lib/duration";
import { localizeArtifact } from "@/lib/report-i18n";
import { Microscope } from "lucide-react";

type L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

// 自包含文案字典（7 语言齐全）
const S: Record<L, Record<string, string>> = {
  zh: {
    title: "研究级原始数据",
    subtitle: "以下为分析流水线产出的原始数值与参数（研究参考）",
    yes: "是",
    no: "否",
    paramSampling: "采样率",
    paramChannels: "通道数",
    paramDuration: "记录时长",
    paramDominantBand: "主导频段",
    paramDominantFreq: "主频率",
    paramClipping: "削波检测",
    paramHighFreqNoise: "高频噪声",
    paramNoisyChannels: "噪声通道",
    paramArtifacts: "可能伪影",
    paramQualityScore: "信号质量评分",
    paramAnalysisId: "分析 ID",
    bandTableTitle: "各频段功率",
    colBand: "频段",
    colPower: "绝对功率",
    colPercent: "相对功率",
    noData: "无数据",
  },
  en: {
    title: "Research-grade raw data",
    subtitle: "Raw values and parameters produced by the analysis pipeline (for research reference)",
    yes: "Yes",
    no: "No",
    paramSampling: "Sampling rate",
    paramChannels: "Channels",
    paramDuration: "Recording duration",
    paramDominantBand: "Dominant band",
    paramDominantFreq: "Dominant frequency",
    paramClipping: "Clipping detected",
    paramHighFreqNoise: "High-frequency noise",
    paramNoisyChannels: "Noisy channels",
    paramArtifacts: "Possible artifacts",
    paramQualityScore: "Signal quality score",
    paramAnalysisId: "Analysis ID",
    bandTableTitle: "Band power",
    colBand: "Band",
    colPower: "Absolute power",
    colPercent: "Relative power",
    noData: "No data",
  },
  es: {
    title: "Datos brutos de nivel investigación",
    subtitle: "Valores y parámetros brutos del proceso de análisis (referencia para investigación)",
    yes: "Sí",
    no: "No",
    paramSampling: "Frecuencia de muestreo",
    paramChannels: "Canales",
    paramDuration: "Duración de la grabación",
    paramDominantBand: "Banda dominante",
    paramDominantFreq: "Frecuencia dominante",
    paramClipping: "Recorte detectado",
    paramHighFreqNoise: "Ruido de alta frecuencia",
    paramNoisyChannels: "Canales con ruido",
    paramArtifacts: "Posibles artefactos",
    paramQualityScore: "Puntuación de calidad",
    paramAnalysisId: "ID de análisis",
    bandTableTitle: "Potencia por banda",
    colBand: "Banda",
    colPower: "Potencia absoluta",
    colPercent: "Potencia relativa",
    noData: "Sin datos",
  },
  fr: {
    title: "Données brutes de niveau recherche",
    subtitle: "Valeurs et paramètres bruts issus du pipeline d'analyse (référence pour la recherche)",
    yes: "Oui",
    no: "Non",
    paramSampling: "Fréquence d'échantillonnage",
    paramChannels: "Canaux",
    paramDuration: "Durée d'enregistrement",
    paramDominantBand: "Bande dominante",
    paramDominantFreq: "Fréquence dominante",
    paramClipping: "Écrêtage détecté",
    paramHighFreqNoise: "Bruit haute fréquence",
    paramNoisyChannels: "Canaux bruités",
    paramArtifacts: "Artefacts possibles",
    paramQualityScore: "Score de qualité",
    paramAnalysisId: "ID d'analyse",
    bandTableTitle: "Puissance par bande",
    colBand: "Bande",
    colPower: "Puissance absolue",
    colPercent: "Puissance relative",
    noData: "Aucune donnée",
  },
  de: {
    title: "Rohdaten auf Forschungsniveau",
    subtitle: "Rohwerte und Parameter aus der Analyse-Pipeline (zur Forschungsreferenz)",
    yes: "Ja",
    no: "Nein",
    paramSampling: "Abtastrate",
    paramChannels: "Kanäle",
    paramDuration: "Aufnahmedauer",
    paramDominantBand: "Dominantes Band",
    paramDominantFreq: "Dominante Frequenz",
    paramClipping: "Clipping erkannt",
    paramHighFreqNoise: "Hochfrequenzrauschen",
    paramNoisyChannels: "Verrauschte Kanäle",
    paramArtifacts: "Mögliche Artefakte",
    paramQualityScore: "Signalqualitätswert",
    paramAnalysisId: "Analyse-ID",
    bandTableTitle: "Bandleistung",
    colBand: "Band",
    colPower: "Absolute Leistung",
    colPercent: "Relative Leistung",
    noData: "Keine Daten",
  },
  ja: {
    title: "研究レベルの生データ",
    subtitle: "解析パイプラインが生成した生の数値とパラメータ（研究参考用）",
    yes: "はい",
    no: "いいえ",
    paramSampling: "サンプリング周波数",
    paramChannels: "チャンネル数",
    paramDuration: "記録時間",
    paramDominantBand: "主要帯域",
    paramDominantFreq: "主要周波数",
    paramClipping: "クリッピング検出",
    paramHighFreqNoise: "高周波ノイズ",
    paramNoisyChannels: "ノイズチャンネル",
    paramArtifacts: "想定されるアーティファクト",
    paramQualityScore: "信号品質スコア",
    paramAnalysisId: "解析 ID",
    bandTableTitle: "帯域パワー",
    colBand: "帯域",
    colPower: "絶対パワー",
    colPercent: "相対パワー",
    noData: "データなし",
  },
  ko: {
    title: "연구 수준 원시 데이터",
    subtitle: "분석 파이프라인이 생성한 원시 값과 매개변수 (연구 참고용)",
    yes: "예",
    no: "아니오",
    paramSampling: "샘플링 레이트",
    paramChannels: "채널 수",
    paramDuration: "기록 시간",
    paramDominantBand: "주요 대역",
    paramDominantFreq: "주요 주파수",
    paramClipping: "클리핑 감지",
    paramHighFreqNoise: "고주파 노이즈",
    paramNoisyChannels: "노이즈 채널",
    paramArtifacts: "가능한 아티팩트",
    paramQualityScore: "신호 품질 점수",
    paramAnalysisId: "분석 ID",
    bandTableTitle: "대역 파워",
    colBand: "대역",
    colPower: "절대 파워",
    colPercent: "상대 파워",
    noData: "데이터 없음",
  },
};

const BAND_ORDER = ["delta", "theta", "alpha", "beta", "gamma"];
const BAND_LABEL_KEY: Record<string, string> = {
  delta: "bandDelta",
  theta: "bandTheta",
  alpha: "bandAlpha",
  beta: "bandBeta",
  gamma: "bandGamma",
};

function fmtPower(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e5) return Number(n.toPrecision(4)).toString();
  return n.toExponential(3);
}

function boolText(v: any, yes: string, no: string): string | null {
  if (typeof v !== "boolean") return null;
  return v ? yes : no;
}

/**
 * Research 级数据增强（D，仅展示层）：
 * 把报告中已有但此前未渲染的原始数值/元数据如实渲染出来。
 * 缺失字段一律不显示、不编造；不触碰后端与 AI prompt。
 */
export default function ReportDataExplorer({ analysis }: { analysis: any }) {
  const { lang, t } = useLang();
  const s = S[lang] ?? S.en;

  const freq = analysis?.frequency_analysis || {};
  const overview = analysis?.overview || {};
  const sqObj = analysis?.signal_quality || {};

  const absPower = freq.average_bandpower || analysis?.bandpower || freq.bandpower || {};
  const pct = analysis?.bandpower_percent || freq.bandpower_percent || {};

  const sampling = overview.sampling_rate || analysis?.sampling_rate;
  const chCount = overview.channel_count || analysis?.channel_count;
  const hasDuration = durationSeconds(analysis) != null;
  const dominantBand = freq.dominant_band;
  const dominantFreq = freq.dominant_frequency;
  const clipping = analysis?.clipping_detected ?? sqObj.clipping_detected;
  const hfNoise = analysis?.high_frequency_noise ?? sqObj.high_frequency_noise;
  const noisy: string[] = analysis?.noisy_channels || sqObj.noisy_channels || [];
  const artifacts: string[] = analysis?.possible_artifacts || sqObj.possible_artifacts || [];
  const qualityScore = sqObj.signal_quality_score ?? analysis?.signal_quality_score;
  const analysisId = analysis?.analysis_id;

  const params: { label: string; value: string }[] = [];
  if (sampling) params.push({ label: s.paramSampling, value: `${sampling} Hz` });
  if (chCount) params.push({ label: s.paramChannels, value: String(chCount) });
  if (hasDuration) params.push({ label: s.paramDuration, value: formatDuration(analysis, t) });
  if (dominantBand) params.push({ label: s.paramDominantBand, value: String(dominantBand) });
  if (dominantFreq != null) params.push({ label: s.paramDominantFreq, value: `${Number(dominantFreq).toFixed(2)} Hz` });
  if (qualityScore != null && Number.isFinite(Number(qualityScore))) {
    params.push({ label: s.paramQualityScore, value: Number(qualityScore).toFixed(1) });
  }
  const clipText = boolText(clipping, s.yes, s.no);
  if (clipText) params.push({ label: s.paramClipping, value: clipText });
  const hfText = boolText(hfNoise, s.yes, s.no);
  if (hfText) params.push({ label: s.paramHighFreqNoise, value: hfText });
  if (analysisId) params.push({ label: s.paramAnalysisId, value: String(analysisId) });

  const bandRows = BAND_ORDER.filter((b) => absPower[b] != null || pct[b] != null);

  if (params.length === 0 && bandRows.length === 0 && noisy.length === 0 && artifacts.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-purple-200 bg-[var(--color-surface)] p-5 dark:border-purple-900/50">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/30">
          <Microscope className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">{s.title}</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">{s.subtitle}</p>
        </div>
      </div>

      {params.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {params.map((p) => (
            <div
              key={p.label}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
            >
              <dt className="text-xs text-[var(--color-text-secondary)]">{p.label}</dt>
              <dd className="truncate font-mono text-xs font-semibold text-[var(--color-text)]">{p.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(noisy.length > 0 || artifacts.length > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {noisy.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
              <div className="text-xs font-semibold text-[var(--color-text)]">{s.paramNoisyChannels}</div>
              <div className="mt-1 font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">{noisy.join(", ")}</div>
            </div>
          )}
          {artifacts.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
              <div className="text-xs font-semibold text-[var(--color-text)]">{s.paramArtifacts}</div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {artifacts.map((a) => localizeArtifact(lang as any, a)).join(", ")}
              </div>
            </div>
          )}
        </div>
      )}

      {bandRows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-[var(--color-text)]">{s.bandTableTitle}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[var(--color-text-secondary)]">
                  <th className="border-b border-[var(--color-border)] px-2 py-1.5 font-medium">{s.colBand}</th>
                  <th className="border-b border-[var(--color-border)] px-2 py-1.5 font-medium">{s.colPower}</th>
                  <th className="border-b border-[var(--color-border)] px-2 py-1.5 font-medium">{s.colPercent}</th>
                </tr>
              </thead>
              <tbody>
                {bandRows.map((b) => (
                  <tr key={b} className="text-[var(--color-text)]">
                    <td className="border-b border-[var(--color-border)] px-2 py-1.5 font-medium">{t(BAND_LABEL_KEY[b])}</td>
                    <td className="border-b border-[var(--color-border)] px-2 py-1.5 font-mono">
                      {absPower[b] != null ? fmtPower(absPower[b]) : "—"}
                    </td>
                    <td className="border-b border-[var(--color-border)] px-2 py-1.5 font-mono">
                      {pct[b] != null ? String(pct[b]) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
