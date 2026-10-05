"use client";

import { useState } from "react";
import { useLang } from "@/lib/language-context";
import { ChevronDown } from "lucide-react";

type L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

// 自包含文案字典（7 语言齐全）——不向 translations.ts 添加 key
const S: Record<L, Record<string, string>> = {
  zh: {
    tapHint: "点击任一频段，查看该频段的功率与含义",
    absolutePower: "绝对功率",
    relativePower: "相对功率",
    range: "频段范围",
    close: "收起",
    notAvailable: "未提供",
    waveform: "该频段波形（报告原始数据）",
    desc_delta: "Delta 波（0.5–4 Hz）：最慢的脑电波，多见于深度睡眠与婴幼儿；清醒时过多可能提示困倦或伪影。",
    desc_theta: "Theta 波（4–8 Hz）：见于浅睡、冥想与放松，也参与记忆与创意加工。",
    desc_alpha: "Alpha 波（8–13 Hz）：闭眼放松时枕区最明显，是安静清醒状态的标志。",
    desc_beta: "Beta 波（13–30 Hz）：清醒、专注、思考与主动运动时活跃，反映大脑的警觉与认知加工。",
    desc_gamma: "Gamma 波（30–45 Hz 及以上）：与注意力、知觉整合和高阶认知相关，但极易受肌电等伪影影响。",
  },
  en: {
    tapHint: "Tap a band to see its power and meaning",
    absolutePower: "Absolute power",
    relativePower: "Relative power",
    range: "Frequency range",
    close: "Collapse",
    notAvailable: "Not provided",
    waveform: "Band waveform (from report data)",
    desc_delta: "Delta (0.5–4 Hz): the slowest wave, prominent in deep sleep and infants; excess while awake may indicate drowsiness or artifact.",
    desc_theta: "Theta (4–8 Hz): seen in light sleep, meditation and relaxation; also involved in memory and creative processing.",
    desc_alpha: "Alpha (8–13 Hz): strongest over the occipital area with eyes closed, a hallmark of relaxed wakefulness.",
    desc_beta: "Beta (13–30 Hz): active during alertness, focus, thinking and voluntary movement.",
    desc_gamma: "Gamma (30–45+ Hz): linked to attention and higher cognition, but easily contaminated by muscle (EMG) artifact.",
  },
  es: {
    tapHint: "Toca una banda para ver su potencia y significado",
    absolutePower: "Potencia absoluta",
    relativePower: "Potencia relativa",
    range: "Rango de frecuencia",
    close: "Contraer",
    notAvailable: "No disponible",
    waveform: "Onda de la banda (datos del informe)",
    desc_delta: "Delta (0.5–4 Hz): la onda más lenta, presente en el sueño profundo y en bebés; un exceso en vigilia puede indicar somnolencia o artefacto.",
    desc_theta: "Theta (4–8 Hz): aparece en el sueño ligero, la meditación y la relajación; también participa en la memoria y la creatividad.",
    desc_alpha: "Alfa (8–13 Hz): más intensa en la región occipital con los ojos cerrados, marca de vigilia relajada.",
    desc_beta: "Beta (13–30 Hz): activa en alerta, concentración, pensamiento y movimiento voluntario.",
    desc_gamma: "Gamma (30–45+ Hz): ligada a la atención y la cognición superior, pero se contamina fácilmente con artefactos musculares (EMG).",
  },
  fr: {
    tapHint: "Touchez une bande pour voir sa puissance et sa signification",
    absolutePower: "Puissance absolue",
    relativePower: "Puissance relative",
    range: "Plage de fréquences",
    close: "Réduire",
    notAvailable: "Non fourni",
    waveform: "Onde de la bande (données du rapport)",
    desc_delta: "Delta (0,5–4 Hz) : l'onde la plus lente, marquée dans le sommeil profond et chez le nourrisson ; un excès à l'éveil peut indiquer somnolence ou artefact.",
    desc_theta: "Thêta (4–8 Hz) : observée en sommeil léger, méditation et relaxation ; impliquée aussi dans la mémoire et la créativité.",
    desc_alpha: "Alpha (8–13 Hz) : maximale à l'arrière du crâne, yeux fermés, signe d'un éveil calme.",
    desc_beta: "Bêta (13–30 Hz) : active lors de l'éveil, de la concentration, de la réflexion et du mouvement volontaire.",
    desc_gamma: "Gamma (30–45+ Hz) : liée à l'attention et aux fonctions cognitives élevées, mais facilement contaminée par l'artefact musculaire (EMG).",
  },
  de: {
    tapHint: "Tippen Sie auf ein Band, um Leistung und Bedeutung zu sehen",
    absolutePower: "Absolute Leistung",
    relativePower: "Relative Leistung",
    range: "Frequenzbereich",
    close: "Einklappen",
    notAvailable: "Nicht verfügbar",
    waveform: "Bandwelle (aus den Reportdaten)",
    desc_delta: "Delta (0,5–4 Hz): die langsamste Welle, typisch für Tiefschlaf und Säuglinge; ein Überschuss im Wachzustand kann auf Schläfrigkeit oder Artefakte hindeuten.",
    desc_theta: "Theta (4–8 Hz): tritt im leichten Schlaf, bei Meditation und Entspannung auf; auch an Gedächtnis und Kreativität beteiligt.",
    desc_alpha: "Alpha (8–13 Hz): am stärksten okzipital bei geschlossenen Augen – Zeichen entspannter Wachheit.",
    desc_beta: "Beta (13–30 Hz): aktiv bei Wachheit, Fokus, Denken und willkürlicher Bewegung.",
    desc_gamma: "Gamma (30–45+ Hz): mit Aufmerksamkeit und höherer Kognition verknüpft, aber leicht durch Muskelartefakte (EMG) verfälscht.",
  },
  ja: {
    tapHint: "各帯域をタップすると、パワーと意味を表示します",
    absolutePower: "絶対パワー",
    relativePower: "相対パワー",
    range: "周波数帯域",
    close: "閉じる",
    notAvailable: "データなし",
    waveform: "帯域波形（レポートの元データ）",
    desc_delta: "デルタ波（0.5–4 Hz）：最も遅い脳波で、深い睡眠や乳児に顕著。覚醒時に過多だと眠気やアーティファクトの可能性。",
    desc_theta: "シータ波（4–8 Hz）：浅い睡眠、瞑想、リラックス時に見られ、記憶や創造的処理にも関与。",
    desc_alpha: "アルファ波（8–13 Hz）：閉眼・安静時に後頭部で最も強く、リラックスした覚醒状態の指標。",
    desc_beta: "ベータ波（13–30 Hz）：覚醒、集中、思考、随意運動時に活発。",
    desc_gamma: "ガンマ波（30–45+ Hz）：注意や高次認知に関連するが、筋電（EMG）などのアーティファクトの影響を受けやすい。",
  },
  ko: {
    tapHint: "밴드를 탭하면 해당 대역의 파워와 의미를 볼 수 있습니다",
    absolutePower: "절대 파워",
    relativePower: "상대 파워",
    range: "주파수 대역",
    close: "접기",
    notAvailable: "제공되지 않음",
    waveform: "대역 파형 (보고서 원본 데이터)",
    desc_delta: "델타(0.5–4 Hz): 가장 느린 뇌파로 깊은 수면과 영아에서 두드러집니다. 각성 시 과다하면 졸림이나 아티팩트일 수 있습니다.",
    desc_theta: "세타(4–8 Hz): 얕은 수면, 명상, 이완에서 나타나며 기억과 창의적 처리에도 관여합니다.",
    desc_alpha: "알파(8–13 Hz): 눈을 감고 이완할 때 후두부에서 가장 강해, 편안한 각성의 지표입니다.",
    desc_beta: "베타(13–30 Hz): 각성, 집중, 사고, 수의적 움직임 시 활발합니다.",
    desc_gamma: "감마(30–45+ Hz): 주의와 고차 인지에 관련되지만 근전도(EMG) 아티팩트의 영향을 쉽게 받습니다.",
  },
};

const BAND_RANGE: Record<string, string> = {
  delta: "0.5–4 Hz",
  theta: "4–8 Hz",
  alpha: "8–13 Hz",
  beta: "13–30 Hz",
  gamma: "30–45 Hz",
};

const BANDS: { key: string; bandKey: string; color: string }[] = [
  { key: "alpha", bandKey: "bandAlpha", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
  { key: "beta", bandKey: "bandBeta", color: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  { key: "delta", bandKey: "bandDelta", color: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
  { key: "theta", bandKey: "bandTheta", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400" },
  { key: "gamma", bandKey: "bandGamma", color: "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" },
];

function fmtPower(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e5) return Number(n.toPrecision(4)).toString();
  return n.toExponential(3);
}

// 复用的"真实频段波形"迷你折线图（仅在报告含 band_waveforms 时渲染）
function BandWave({ times, values }: { times: number[]; values: number[] }) {
  const n = Math.min(times.length, values.length);
  if (n < 2) return null;
  const COLS = Math.min(260, n);
  const step = n / COLS;
  const pts: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < COLS; j++) {
    const s = Math.floor(j * step);
    const v = values[s] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
    pts.push(v);
  }
  const rng = max - min || 1;
  const W = 320;
  const H = 64;
  const poly = pts
    .map((v, j) => `${((j / (COLS - 1)) * W).toFixed(1)},${(H - ((v - min) / rng) * (H - 10) - 5).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-16 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={poly}
        fill="none"
        className="stroke-indigo-500 dark:stroke-indigo-400"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * 频段交互面板：点击 Delta/Theta/Alpha/Beta/Gamma 展开该频段的
 * 绝对功率、相对功率、频段范围与通俗解释；报告若含 band_waveforms 则复用绘制该频段波形。
 * 全部数据来自报告已有字段，缺失的相对功率显示"未提供"，不伪造。
 */
export default function ReportBandPanel({ analysis }: { analysis: any }) {
  const { lang, t } = useLang();
  const s = S[lang] ?? S.en;
  const [active, setActive] = useState<string | null>(null);

  const freq = analysis?.frequency_analysis || {};
  const bp = analysis?.bandpower || freq.bandpower || null; // 绝对功率（4 频段，旧/新报告兼容）
  const absPower = freq.average_bandpower || bp || {};
  const pct = analysis?.bandpower_percent || freq.bandpower_percent || {};
  const bw = analysis?.band_waveforms;

  const hasAny = BANDS.some(({ key }) => pct[key] != null || absPower[key] != null || (bw && bw[key]));
  if (!hasAny) return null;

  const activeMeta = BANDS.find((b) => b.key === active);
  const activeAbs = active ? absPower[active] : undefined;
  const activePct = active ? pct[active] : undefined;
  const activeWave =
    active && bw && Array.isArray(bw.times) && Array.isArray(bw[active]) && bw[active].length > 1
      ? { times: bw.times as number[], values: bw[active] as number[] }
      : null;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {BANDS.map(({ key, bandKey, color }) => {
          const isActive = active === key;
          const pctVal = pct[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive((a) => (a === key ? null : key))}
              aria-pressed={isActive}
              className={`relative rounded-xl px-4 py-3 text-center transition-all ${color} ${
                isActive ? "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-surface)]" : "hover:opacity-90"
              }`}
            >
              <div className="text-lg font-bold">{pctVal != null ? String(pctVal) : "—"}</div>
              <div className="text-[10px] font-medium uppercase tracking-wider">{t(bandKey)}</div>
              <ChevronDown
                className={`absolute right-1.5 top-1.5 h-3 w-3 opacity-60 transition-transform ${isActive ? "rotate-180" : ""}`}
              />
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{s.tapHint}</p>

      {active && activeMeta && (
        <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[var(--color-text)]">{t(activeMeta.bandKey)}</h4>
            <button
              type="button"
              onClick={() => setActive(null)}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            >
              {s.close}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">{s.absolutePower}</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-[var(--color-text)]">
                {activeAbs != null ? fmtPower(activeAbs) : s.notAvailable}
                {activeAbs != null ? <span className="ml-1 text-xs font-normal text-[var(--color-text-secondary)]">µV²</span> : null}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">{s.relativePower}</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-[var(--color-text)]">
                {activePct != null ? String(activePct) : s.notAvailable}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">{s.range}</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-[var(--color-text)]">{BAND_RANGE[active]}</div>
            </div>
          </div>

          {activeWave && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)]">{s.waveform}</div>
              <BandWave times={activeWave.times} values={activeWave.values} />
            </div>
          )}

          <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {s[`desc_${active}`] || ""}
          </p>
        </div>
      )}
    </div>
  );
}
