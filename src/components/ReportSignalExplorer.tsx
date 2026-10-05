"use client";

import { useMemo, useState } from "react";
import { useLang } from "@/lib/language-context";
import { Waves } from "lucide-react";
import { buildWaveformSvg, svgToDataUrl } from "@/lib/waveform-svg";

type L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

// 自包含文案字典（7 语言齐全）
const S: Record<L, Record<string, string>> = {
  zh: {
    title: "通道与时间浏览",
    subtitle: "选择一个通道或时间段，查看对应的 EEG 波形",
    allChannels: "全部通道",
    selectChannel: "选择通道",
    timeRange: "时间范围",
    full: "全段",
    first: "前 1/3",
    mid: "中段",
    last: "后 1/3",
    noWaveform: "无波形数据",
  },
  en: {
    title: "Channel & time explorer",
    subtitle: "Select a channel or time range to view the EEG waveform",
    allChannels: "All channels",
    selectChannel: "Select channel",
    timeRange: "Time range",
    full: "Full",
    first: "First 1/3",
    mid: "Middle",
    last: "Last 1/3",
    noWaveform: "No waveform data",
  },
  es: {
    title: "Explorador de canal y tiempo",
    subtitle: "Selecciona un canal o rango de tiempo para ver la onda EEG",
    allChannels: "Todos los canales",
    selectChannel: "Seleccionar canal",
    timeRange: "Rango de tiempo",
    full: "Completo",
    first: "Primer 1/3",
    mid: "Mitad",
    last: "Último 1/3",
    noWaveform: "Sin datos de onda",
  },
  fr: {
    title: "Explorateur canal & temps",
    subtitle: "Choisissez un canal ou une plage de temps pour voir l'onde EEG",
    allChannels: "Tous les canaux",
    selectChannel: "Choisir un canal",
    timeRange: "Plage temporelle",
    full: "Complet",
    first: "Premier 1/3",
    mid: "Milieu",
    last: "Dernier 1/3",
    noWaveform: "Aucune donnée d'onde",
  },
  de: {
    title: "Kanal- & Zeit-Explorer",
    subtitle: "Wählen Sie einen Kanal oder Zeitbereich, um die EEG-Welle zu sehen",
    allChannels: "Alle Kanäle",
    selectChannel: "Kanal wählen",
    timeRange: "Zeitbereich",
    full: "Gesamt",
    first: "Erstes 1/3",
    mid: "Mitte",
    last: "Letztes 1/3",
    noWaveform: "Keine Wellendaten",
  },
  ja: {
    title: "チャンネルと時間のブラウザ",
    subtitle: "チャンネルまたは時間範囲を選んで EEG 波形を表示",
    allChannels: "すべてのチャンネル",
    selectChannel: "チャンネル選択",
    timeRange: "時間範囲",
    full: "全体",
    first: "前 1/3",
    mid: "中央",
    last: "後 1/3",
    noWaveform: "波形データなし",
  },
  ko: {
    title: "채널 및 시간 탐색기",
    subtitle: "채널 또는 시간 범위를 선택해 EEG 파형을 확인하세요",
    allChannels: "모든 채널",
    selectChannel: "채널 선택",
    timeRange: "시간 범위",
    full: "전체",
    first: "앞 1/3",
    mid: "중간",
    last: "뒤 1/3",
    noWaveform: "파형 데이터 없음",
  },
};

type RangeKey = "full" | "first" | "mid" | "last";
const RANGE_FRAC: Record<RangeKey, [number, number]> = {
  full: [0, 1],
  first: [0, 1 / 3],
  mid: [1 / 3, 2 / 3],
  last: [2 / 3, 1],
};

/**
 * 通道与时间浏览（B/C）：
 * 复用报告已有的真实 waveform_preview.channels 数据与 buildWaveformSvg 渲染逻辑。
 * - 通道选择：全部通道 或 单个通道隔离显示。
 * - 时间区间：全段 / 前 1/3 / 中段 / 后 1/3（按采样点数等比切片，等价于时间切片）。
 * 无 waveform_preview.channels 时返回 null（不改变现有页面）。
 */
export default function ReportSignalExplorer({ analysis }: { analysis: any }) {
  const { lang } = useLang();
  const s = S[lang] ?? S.en;
  const wp = analysis?.waveform_preview;
  const channels: Record<string, number[]> = (wp && wp.channels) || {};
  const names = Object.keys(channels);
  const [selected, setSelected] = useState<string>("__all__");
  const [range, setRange] = useState<RangeKey>("full");

  const url = useMemo(() => {
    if (names.length === 0) return "";
    const n = Math.min(...names.map((k) => channels[k]?.length || 0));
    if (n < 2) return "";
    const fs = parseFloat(wp?.sampling_rate || 0) || 128;
    const totalDur = parseFloat(wp?.duration_seconds || 0) || n / fs;
    const [f0, f1] = RANGE_FRAC[range];
    const iStart = Math.max(0, Math.floor(f0 * n));
    const iEnd = Math.min(n, Math.ceil(f1 * n));
    const useNames = selected === "__all__" ? names : names.filter((x) => x === selected);
    const sliced: Record<string, number[]> = {};
    for (const nm of useNames) {
      const arr = channels[nm] || [];
      sliced[nm] = arr.slice(iStart, Math.max(iStart + 1, iEnd));
    }
    // 切片后重算 duration，并丢弃 times（本地存储已省去 times），交给 buildWaveformSvg 统一渲染
    const clone = {
      ...analysis,
      waveform_preview: {
        ...wp,
        channels: sliced,
        times: undefined,
        duration_seconds: totalDur * (f1 - f0),
        sampling_rate: fs,
      },
    };
    const svg = buildWaveformSvg(clone, 0);
    return svg ? svgToDataUrl(svg) : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, selected, range]);

  if (names.length === 0) return null;

  const rangeBtns: { key: RangeKey; label: string }[] = [
    { key: "full", label: s.full },
    { key: "first", label: s.first },
    { key: "mid", label: s.mid },
    { key: "last", label: s.last },
  ];

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/30">
          <Waves className="h-5 w-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[var(--color-text)]">{s.title}</h2>
          <p className="text-xs text-[var(--color-text-secondary)]">{s.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="font-medium">{s.selectChannel}</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value="__all__">{s.allChannels}</option>
            {names.map((nm) => (
              <option key={nm} value={nm}>
                {nm}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">{s.timeRange}</span>
          {rangeBtns.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              aria-pressed={range === key}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                range === key
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-bg)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {url ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <img
            src={url}
            alt="EEG waveform"
            draggable={false}
            className="block h-auto select-none"
            style={{ width: "auto", maxWidth: "100%" }}
          />
        </div>
      ) : (
        <div className="mt-4 flex h-32 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-sm text-[var(--color-text-secondary)]">
          <Waves className="mr-2 h-6 w-6 opacity-50" />
          {s.noWaveform}
        </div>
      )}
    </section>
  );
}
