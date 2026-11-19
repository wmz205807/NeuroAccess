"use client";

/**
 * EegCanvasViewer —— 基于 Canvas 2D 的临床风格 EEG 阅图组件（2026-11-18）
 *
 * 设计原则（参考 EDFbrowser 公开的实现原理，代码完全独立编写）：
 *  1. 每个像素列取该列覆盖采样的 **min/max 包络**（放大到点距 > 1px 时改为逐点折线），
 *     既保证缩小看全貌时不丢失尖峰，也**不做任何滤波/插值/平滑**。
 *  2. 时间轴与电压轴都是线性映射，可独立缩放（时间窗/灵敏度）。
 *  3. 支持原始导联、双极纵联、双极横联、平均参考；极性可反转。
 *  4. 多通道共用同一时间轴，通道分页显示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, AlertTriangle, Move } from "lucide-react";
import { useLang } from "@/lib/language-context";
import { addNotification } from "@/components/NotificationToast";
import { fetchEegWindow, fetchEegInfo, type EegWindowData } from "@/lib/eeg/window";
import { planLanes, materialize, type LanePlan, type MontageKind, type MontageLane } from "@/lib/eeg/montage";

const LANES_PER_PAGE = 999;   // 全部通道同屏（靠画布加高保证不拥挤）

type Dict = Record<string, string>;
const T: Record<"zh" | "en" | "de" | "ja", Dict> = {
  zh: {
    exported: "已导出 PNG",
    pan: "平移", panOff: "锁定", timePage: "时间", chPage: "通道", showSettings: "显示设置", hideSettings: "收起设置",
    dupChannels: "通道高度相似（相关系数中位 > 0.97），疑似重复或合成数据；已保持原始导联，切换双极只会显示噪声。", advanced: "高级", autoSens: "自动", timeWindow: "时间窗", sensitivity: "灵敏度", montage: "导联", polarity: "极性",
    normal: "正向", inverted: "反转", zoomIn: "放大", zoomOut: "缩小", reset: "重置",
    downloadPng: "下载 PNG", prevPage: "上一组通道", nextPage: "下一组通道",
    asRecorded: "原始导联", longitudinal: "双极纵联", transverse: "双极横联", average: "平均参考",
    loading: "加载波形…", error: "波形加载失败", retry: "重试",
    previewNote: "此报告保存的是降采样副本（原始 EDF 已按隐私策略删除），波形形状真实，细节密度低于原始采样。",
    edfNote: "数据来源：原始 EDF 文件，原生采样率",
    channel: "通道", total: "共", sec: "秒", uvDiv: "µV/格", lanes: "条",
  },
  en: {
    exported: "PNG exported",
    pan: "Pan", panOff: "Locked", timePage: "Time", chPage: "Ch", showSettings: "Display settings", hideSettings: "Hide settings",
    dupChannels: "Channels are nearly identical (median |r| > 0.97) — likely duplicated or synthetic data. Original montage kept; bipolar would only show noise.", advanced: "Advanced", autoSens: "Auto", timeWindow: "Window", sensitivity: "Sensitivity", montage: "Montage", polarity: "Polarity",
    normal: "Normal", inverted: "Inverted", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset",
    downloadPng: "Download PNG", prevPage: "Previous channels", nextPage: "Next channels",
    asRecorded: "As recorded", longitudinal: "Longitudinal bipolar", transverse: "Transverse bipolar", average: "Average reference",
    loading: "Loading waveform…", error: "Failed to load waveform", retry: "Retry",
    previewNote: "This report keeps a downsampled copy (the original EDF is deleted per privacy policy). Shape is real; detail density is below native sampling.",
    edfNote: "Source: original EDF file at native sampling rate",
    channel: "Channels", total: "of", sec: "s", uvDiv: "µV/div", lanes: "lanes",
  },
  de: {
    exported: "PNG exportiert",
    pan: "Verschieben", panOff: "Gesperrt", timePage: "Zeit", chPage: "Kanäle", showSettings: "Anzeige", hideSettings: "Ausblenden",
    dupChannels: "Kanäle sind nahezu identisch (Median |r| > 0,97) — wahrscheinlich dupliziert oder synthetisch. Rohmontage beibehalten.", advanced: "Erweitert", autoSens: "Auto", timeWindow: "Zeitfenster", sensitivity: "Empfindlichkeit", montage: "Montage", polarity: "Polarität",
    normal: "Normal", inverted: "Invertiert", zoomIn: "Vergrößern", zoomOut: "Verkleinern", reset: "Zurücksetzen",
    downloadPng: "PNG laden", prevPage: "Vorherige Kanäle", nextPage: "Nächste Kanäle",
    asRecorded: "Wie aufgezeichnet", longitudinal: "Longitudinal bipolar", transverse: "Transversal bipolar", average: "Durchschnittsreferenz",
    loading: "Welle wird geladen…", error: "Welle konnte nicht geladen werden", retry: "Erneut",
    previewNote: "Dieser Bericht enthält eine heruntergerechnete Kopie (Original-EDF wird aus Datenschutzgründen gelöscht).",
    edfNote: "Quelle: Original-EDF, native Abtastrate",
    channel: "Kanäle", total: "von", sec: "s", uvDiv: "µV/Div", lanes: "Spuren",
  },
  ja: {
    exported: "PNG を書き出しました",
    pan: "移動", panOff: "固定", timePage: "時間", chPage: "チャンネル", showSettings: "表示設定", hideSettings: "設定を閉じる",
    dupChannels: "チャンネルがほぼ同一（中央値 |r| > 0.97）。重複または合成データの可能性。原導联のまま表示します。", advanced: "詳細設定", autoSens: "自動", timeWindow: "時間窓", sensitivity: "感度", montage: "導联", polarity: "極性",
    normal: "通常", inverted: "反転", zoomIn: "拡大", zoomOut: "縮小", reset: "リセット",
    downloadPng: "PNG を保存", prevPage: "前のチャンネル", nextPage: "次のチャンネル",
    asRecorded: "記録どおり", longitudinal: "縦双極", transverse: "横双極", average: "平均参考",
    loading: "波形を読み込み中…", error: "波形の読み込みに失敗", retry: "再試行",
    previewNote: "このレポートは間引きコピーを保存しています（元の EDF はプライバシー方針により削除）。",
    edfNote: "元の EDF ファイル（ネイティブサンプリング）",
    channel: "チャンネル", total: "/", sec: "秒", uvDiv: "µV/div", lanes: "本",
  },
};


/** 估计通道间「中位绝对相关系数」：用于判断是否为高度重复/合成数据。抽样 12 通道 × 250 点。 */
function medianAbsCorr(data: Float32Array, nch: number, npts: number): number {
  const step = Math.max(1, Math.floor(npts / 250));
  const pick = Math.min(nch, 12);
  const cols: number[][] = [];
  for (let c = 0; c < pick; c++) {
    const arr: number[] = [];
    for (let i = 0; i < npts; i += step) arr.push(data[c * npts + i]);
    cols.push(arr);
  }
  const corr = (a: number[], b: number[]) => {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sa += da * da; sb += db * db; sab += da * db;
    }
    return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : 0;
  };
  const vals: number[] = [];
  for (let i = 0; i < pick; i++) for (let j = i + 1; j < pick; j++) vals.push(Math.abs(corr(cols[i], cols[j])));
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

const TIME_WINDOWS = [1, 2, 5, 10, 20, 30];
const SENS_STEPS = [10, 20, 25, 50, 100, 200, 500];

export default function EegCanvasViewer({
  rid,
  caseId,
  fileName,
  height = 460,
}: {
  rid?: string;
  caseId?: string;
  fileName?: string;
  height?: number;
}) {
  const { lang } = useLang();
  const d = T[(lang as keyof typeof T)] || T.en;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [start, setStart] = useState(0);
  const [dur, setDur] = useState(5);
  const [sensIdx, setSensIdx] = useState<number>(-1); // -1 = 自动（按数据自适应）
  // 自动灵敏度的锁定值：首次算好后固定，缩放/平移不再重算（否则幅度会随窗口跳变）
  const [autoUvDiv, setAutoUvDiv] = useState<number | null>(null)
  const [invert, setInvert] = useState(false);
  const [montage, setMontage] = useState<MontageKind>("as-recorded");
  const [isPanMode, setIsPanMode] = useState(false); // 默认不开启平移（用户要求）
  // 用户手动改过导联后，不再自动切换默认导联
  const montageTouched = useRef(false);
  const [lanePage, setLanePage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingHint, setLoadingHint] = useState("");
  const [error, setError] = useState("");
  const [win, setWin] = useState<EegWindowData | null>(null);
  // 通道清单（仅名字/采样率/时长），用于按需取通道
  const [info, setInfo] = useState<{ channels: string[]; fs: number; totalSeconds: number; source: string } | null>(null);
  const neededRef = useRef<string[]>([]);
  const infoRef = useRef<{ channels: string[] } | null>(null);
  const chsRef = useRef<string>("");
  infoRef.current = info;
  const [note, setNote] = useState("");
  const [dataNote, setDataNote] = useState("");
  const [size, setSize] = useState({ w: 900, h: height });

  const cacheRef = useRef<{ start: number; dur: number; data: EegWindowData } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ── 数据加载（带余量缓存，拖动时不每次都打接口） ── */
  const load = useCallback(async (s: number, dd: number) => {
    const need = neededRef.current;
    const chsParam = need.length ? need.map((n) => infoRef.current?.channels.indexOf(n) ?? -1).filter((i) => i >= 0).join(",") : "";
    chsRef.current = chsParam;
    const c = cacheRef.current as any;
    if (c && c.key === chsParam && s >= c.start - 1e-6 && s + dd <= c.start + c.dur + 1e-6) {
      const meta = c.data.meta;
      const i0 = Math.max(0, Math.round((s - c.start) * meta.fs));
      const n = Math.max(2, Math.round(dd * meta.fs));
      const i1 = Math.min(meta.npts, i0 + n);
      const chs = meta.channels.length;
      const out = new Float32Array(chs * (i1 - i0));
      for (let ch = 0; ch < chs; ch++) {
        out.set(c.data.data.subarray(ch * meta.npts + i0, ch * meta.npts + i1), ch * (i1 - i0));
      }
      setWin({
        meta: { ...meta, start: c.start + i0 / meta.fs, dur: (i1 - i0) / meta.fs, npts: i1 - i0 },
        data: out,
      });
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      // 预取策略：通道少时预取 1.5 倍（拖动命中缓存）；通道多时不预取，避免首屏传几百 KB
      const estCh = cacheRef.current?.data.meta.channels.length || 0;
      const heavy = estCh > 32;
      const pad = heavy ? 0 : dd * 0.2;
      const s2 = Math.max(0, s - pad);
      const d2 = heavy ? dd : dd * 1.4;
      const timeoutId = setTimeout(() => ac.abort(), 20000);
      let res: EegWindowData;
      try {
        res = await fetchEegWindow({ rid, caseId, start: s2, dur: d2, chs: chsParam, signal: ac.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      cacheRef.current = { key: chsParam, start: res.meta.start, dur: res.meta.dur, data: res } as any;
      const i0 = Math.max(0, Math.round((s - res.meta.start) * res.meta.fs));
      const n = Math.max(2, Math.min(res.meta.npts - i0, Math.round(dd * res.meta.fs)));
      const chs = res.meta.channels.length;
      const out = new Float32Array(chs * n);
      for (let ch = 0; ch < chs; ch++) {
        out.set(res.data.subarray(ch * res.meta.npts + i0, ch * res.meta.npts + i0 + n), ch * n);
      }
      setWin({
        meta: { ...res.meta, start: res.meta.start + i0 / res.meta.fs, dur: n / res.meta.fs, npts: n },
        data: out,
      });
      // 兜底：/api/eeg/info 失败或还没回来时，用本次返回的通道名补上清单，
      // 保证「取不到清单」不会导致整页空白。
      if (!infoRef.current?.channels?.length) {
        setInfo({
          channels: res.meta.channels,
          fs: res.meta.fs,
          totalSeconds: res.meta.totalSeconds || (res.meta.npts / res.meta.fs),
          source: res.meta.source,
        });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // 被新请求打断属正常；超时（自己 abort）才提示
        if (!ac.signal.aborted || abortRef.current === ac) setError("timeout");
      } else {
        setError(e?.message || "error");
      }
    } finally {
      setLoading(false);
    }
  }, [rid, caseId]);

  // 自动增益只在「换记录」时重新自适应；缩放平移保持同一标尺
  useEffect(() => {
    setAutoUvDiv(null);
    cacheRef.current = null;
    setWin(null);
    setInfo(null);
    let cancelled = false;
    fetchEegInfo({ rid, caseId })
      .then((r) => { if (!cancelled) setInfo({ channels: r.channels, fs: r.fs, totalSeconds: r.totalSeconds, source: r.source }); })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [rid, caseId]);

  useEffect(() => {
    if (info) {
      load(start, dur);
      return;
    }
    // 降级：2.5s 内拿不到通道清单，就直接整包加载（避免永远转圈）
    const t = setTimeout(() => load(start, dur), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, caseId, start, dur, info, montage, lanePage]);

  /* ── 主题联动：深/浅色切换时立即重绘（否则要等下一次操作才变色） ── */
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setThemeTick((v) => v + 1));
    obs.observe(root, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onScheme = () => setThemeTick((v) => v + 1);
    mq?.addEventListener?.("change", onScheme);
    return () => { obs.disconnect(); mq?.removeEventListener?.("change", onScheme); };
  }, []);

  /* ── 尺寸自适应 ── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 900;
      setSize({ w, h: height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth || 900, h: height });
    return () => ro.disconnect();
  }, [height]);

  /* ── 导联规划（只依赖通道名，不需要采样数据）── */
  const planRes = useMemo(() => {
    if (!info) return { plan: [] as LanePlan[], effective: "as-recorded" as MontageKind, note: "" as string };
    return planLanes(info.channels, montage);
  }, [info, montage]);

  const totalLanes = planRes.plan.length;
  const totalLanePages = Math.max(1, Math.ceil(totalLanes / LANES_PER_PAGE));
  const pageClamped = Math.min(lanePage, totalLanePages - 1);
  const pagePlan = useMemo(
    () => planRes.plan.slice(pageClamped * LANES_PER_PAGE, pageClamped * LANES_PER_PAGE + LANES_PER_PAGE),
    [planRes, pageClamped],
  );

  // 当前页需要哪些原始通道（平均参考需要全部）
  const needed = useMemo(() => {
    if (!info) return [] as string[];
    if (planRes.effective === "average") return info.channels;
    const set = new Set<string>();
    for (const p of pagePlan) for (const n of p.from) set.add(n);
    return Array.from(set);
  }, [info, planRes.effective, pagePlan]);
  neededRef.current = needed;

  // 时间分页：整段录音按当前窗口长度切页（与旧版一致，10s/页）
  const totalSec = win?.meta.totalSeconds || 0;
  const timePageCount = Math.max(1, Math.ceil((totalSec - 1e-6) / Math.max(dur, 0.1)));
  const timePage = Math.min(timePageCount, Math.floor((start + 1e-6) / Math.max(dur, 0.1)) + 1);
  const gotoTimePage = (page: number) => {
    const p = Math.min(Math.max(1, page), timePageCount);
    setStart((p - 1) * dur);
  };

  // 用「当前页计划 + 已取到的通道」计算波形
  const dataMap = useMemo(() => {
    const m = new Map<string, Float32Array>();
    if (win) win.meta.channels.forEach((n, i) => m.set(n, win.data.subarray(i * win.meta.npts, (i + 1) * win.meta.npts)));
    return m;
  }, [win]);

  // 单极记录默认双极纵联（用户手动改过则尊重用户）
  useEffect(() => {
    if (!info || montageTouched.current) return;
    const bipolarNames = info.channels.filter((n) => /^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(n.trim())).length;
    const isBip = bipolarNames >= Math.max(3, Math.floor(info.channels.length * 0.6));
    if (!isBip && montage === "as-recorded") setMontage("longitudinal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const lanes = useMemo(() => {
    if (!win) return [] as MontageLane[];
    const built = materialize(pagePlan, (n) => dataMap.get(n), win.meta.npts, planRes.effective);
    if (built.length) return built;
    // 兜底：清单/导联对不上时，至少把已取到的通道按原始导联画出来
    return win.meta.channels.map((n, i) => ({
      label: n,
      data: win.data.subarray(i * win.meta.npts, (i + 1) * win.meta.npts),
      from: [n],
    }));
  }, [win, pagePlan, dataMap, planRes.effective]);
  const shown = lanes;
  const montageResult = { note: planRes.note || "" };

  /* ── 绘制 ── */
  /** 纯绘制：在给定 ctx 上按逻辑尺寸 W×H 画（调用方负责 dpr 缩放） */
  type PaintView = { lanes: MontageLane[]; t0: number; dur: number; npts: number };
  const paint = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number, view?: PaintView) => {
    if (!win) return;
    const vLanes = view ? view.lanes : shown;
    const vT0 = view ? view.t0 : win.meta.start;
    const vDur = view ? view.dur : win.meta.dur;
    const vNpts = view ? view.npts : win.meta.npts;

    const cs = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.classList.contains("dark");
    const bg = isDark ? "#0B111C" : "#FFFFFF";
    const grid = isDark ? "rgba(77,141,255,0.13)" : "rgba(37,99,235,0.12)";
    const gridStrong = isDark ? "rgba(77,141,255,0.28)" : "rgba(37,99,235,0.25)";
    const fg = isDark ? "#E8EEF9" : "#0A1322";
    const muted = isDark ? "#8C9AB3" : "#4B5563";
    const trace = isDark ? "#4DD2FF" : "#1D4ED8";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const GUT = 74;   // 左侧通道名
    const TOP = 22;   // 顶部时间标尺
    const plotW = Math.max(60, W - GUT - 10);
    const plotH = Math.max(60, H - TOP - 8);
    const n = Math.max(1, vLanes.length);
    const laneH = plotH / n;

    // 时间网格：按窗口自动选刻度（1s / 0.5s / 0.2s / 5s）
    const t0 = vT0;
    const t1 = t0 + vDur;
    const step = (() => {
      const target = vDur / 10;
      const cands = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30];
      return cands.find((c) => c >= target) || 30;
    })();
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
      const x = GUT + ((t - t0) / (t1 - t0)) * plotW;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, TOP);
      ctx.lineTo(Math.round(x) + 0.5, TOP + plotH);
      ctx.stroke();
      ctx.fillStyle = muted;
      const label = t.toFixed(step < 1 ? 1 : 0) + "s";
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(Math.round(x) + 2, GUT + plotW - lw - 2), 5);
    }

    // 每条通道
    const divs = 4;
    // 自动灵敏度：整份数据只定一次（锁在 autoUvDiv），缩放/平移不重算，
    // 保证同一记录在不同时间窗下幅度标尺一致（临床阅图习惯）。
    let uvPerDiv = sensIdx >= 0 ? SENS_STEPS[sensIdx] : (autoUvDiv ?? 50);
    if (sensIdx < 0 && autoUvDiv === null && shown.length) {
      const vals: number[] = [];
      for (const lane of vLanes) {
        const step = Math.max(1, Math.floor(lane.data.length / 600));
        for (let i = 0; i < lane.data.length; i += step) vals.push(Math.abs(lane.data[i]));
      }
      vals.sort((a, b) => a - b);
      const p95 = vals[Math.floor(vals.length * 0.95)] || 50;
      const want = Math.max(1, p95 / 1.4);
      const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
      uvPerDiv = nice.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), nice[0]);
      setAutoUvDiv(uvPerDiv);
    }
    const gain = laneH / (uvPerDiv * divs); // px per µV
    const npts = vNpts;

    vLanes.forEach((lane, li) => {
      const yMid = TOP + li * laneH + laneH / 2;
      // 通道格线
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(GUT, Math.round(yMid) + 0.5);
      ctx.lineTo(GUT + plotW, Math.round(yMid) + 0.5);
      ctx.stroke();
      // 通道名
      ctx.fillStyle = muted;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(lane.label.slice(0, 12), 4, yMid - 6);

      // 波形：按像素列 min/max 包络；点距 > 1px 时逐点连线
      const yOf = (v: number) => yMid - (invert ? -v : v) * gain;
      ctx.strokeStyle = trace;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const spp = npts / plotW;
      if (spp > 1) {
        for (let px = 0; px < plotW; px++) {
          const i0 = Math.floor(px * spp);
          const i1 = Math.min(npts, Math.ceil((px + 1) * spp));
          let mn = Infinity, mx = -Infinity;
          for (let i = i0; i < i1; i++) {
            const v = lane.data[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          if (!isFinite(mn)) continue;
          const x = GUT + px + 0.5;
          const yA = yOf(mx), yB = yOf(mn);
          const yTop = Math.min(yA, yB);
          const yBot = Math.max(yA, yB);
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBot - yTop < 1 ? yTop + 1 : yBot);
        }
      } else {
        for (let i = 0; i < npts; i++) {
          const x = GUT + (i / (npts - 1)) * plotW;
          const y = yOf(lane.data[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // 通道内电压刻度（4 格）
      ctx.strokeStyle = gridStrong;
      ctx.lineWidth = 1;
      for (let k = -divs / 2; k <= divs / 2; k++) {
        if (k === 0) continue;
        const y = yMid - k * (uvPerDiv * gain);
        ctx.beginPath();
        ctx.moveTo(GUT, Math.round(y) + 0.5);
        ctx.lineTo(GUT + 6, Math.round(y) + 0.5);
        ctx.stroke();
      }
    });

    // 电压标尺：画在左侧通道名列的顶部（该区域为空，不与通道名/时间刻度冲突）
    ctx.fillStyle = muted;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${uvPerDiv} ${d.uvDiv}`, 4, 5);
  }, [win, shown, sensIdx, invert, autoUvDiv, d.uvDiv]);  // vLanes 默认取 shown

  // 画布高度：至少为传入高度，通道多时按 34px/条自动加高（避免挤在一起）
  const viewHeight = useCallback((laneCount: number) => {
    const need = 22 + Math.max(1, laneCount) * 28 + 8;
    return Math.max(220, size.h, need);
  }, [size.h]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !win) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(320, size.w);
    const H = viewHeight(shown.length);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, W, H);
  }, [paint, win, size.w, viewHeight, themeTick]);

  useEffect(() => { draw(); }, [draw]);

  /* ── 交互：滚轮缩放时间（以光标为锚点）、拖拽平移 ── */
  const dragRef = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  // 滚轮缩放：绑定在节点的 ref 回调上（只绑一次），状态通过 ref 读取最新值，
  // 避免 effect 重跑/节点重建导致监听丢失或闭包过期。
  const stateRef = useRef({ start, dur, win });
  stateRef.current = { start, dur, win };
  const detachRef = useRef<(() => void) | null>(null);

  const canvasCb = useCallback((node: HTMLCanvasElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    canvasRef.current = node;
    if (!node) return;
    const onWheelNative = (e: WheelEvent) => {
      const { start: st, dur: du, win: w } = stateRef.current;
      if (!w) return;
      // 2026-11-18：普通上下滚动不再缩放（否则滑页面就会把波形拉长压短）。
      // 仅 Ctrl/⌘ + 滚轮缩放（与 EDFbrowser、地图类应用一致）。
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const GUT = 74;
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - GUT) / Math.max(1, rect.width - GUT - 10)));
      const anchorT = st + frac * du;
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const total = w.meta.totalSeconds || st + du;
      const nd = Math.min(Math.max(0.5, du * factor), Math.max(1, total));
      const ns = Math.min(Math.max(0, anchorT - frac * nd), Math.max(0, total - nd));
      setDur(nd);
      setStart(ns);
    };
    node.addEventListener("wheel", onWheelNative, { passive: false });
    node.dataset.wheelAttached = "1";
    detachRef.current = () => {
      node.removeEventListener("wheel", onWheelNative);
      delete node.dataset.wheelAttached;
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isPanMode) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, start, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st || !win) return;
    // 2026-11-18 修复：只在「按住左键」时平移。松开（buttons === 0）立刻结束拖拽，
    // 否则在画布外松手后，鼠标单纯移动也会拖动波形。
    if (e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const rect = canvasRef.current!.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - 84);
    const dt = ((e.clientX - st.x) / plotW) * dur;
    if (Math.abs(e.clientX - st.x) > 2) st.moved = true;
    const total = win.meta.totalSeconds || 0;
    const ns = Math.min(Math.max(0, st.start - dt), Math.max(0, total - dur));
    setStart(ns);
  };
  const onPointerUp = () => { dragRef.current = null; };

  useEffect(() => {
    const clear = () => { dragRef.current = null; };
    window.addEventListener("pointerup", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const reset = () => { setStart(0); setDur(5); setSensIdx(-1); setAutoUvDiv(null); setInvert(false); setLanePage(0); };

  // 导出：**版面与屏幕完全一致**（同样的逻辑尺寸与长宽比），
  // 只是把宽度固定放大到 2760px 以保证清晰度（高度按屏幕比例换算）。
  const EXPORT_TARGET_W = 2760;

  const downloadPng = async () => {
    if (!win) return;
    const W = Math.max(320, size.w);
    const H = viewHeight(shown.length);
    const scale = Math.min(EXPORT_TARGET_W / W, 4200 / H);

    // 导出固定使用「默认 10 秒窗口」（对齐当前时间页），不跟随当前缩放
    const EXPORT_DUR = 5;
    const total = win.meta.totalSeconds || 0;
    const exportStart = Math.min(
      Math.max(0, Math.floor((start + 1e-6) / EXPORT_DUR) * EXPORT_DUR),
      Math.max(0, total - EXPORT_DUR),
    );

    let view: { lanes: MontageLane[]; t0: number; dur: number; npts: number } | undefined;
    const needFetch = Math.abs(dur - EXPORT_DUR) > 1e-6 || Math.abs(start - exportStart) > 1e-6 || Math.abs(win.meta.dur - EXPORT_DUR) > 1;
    if (needFetch) {
      try {
        setLoading(true);
        const res = await fetchEegWindow({ rid, caseId, start: exportStart, dur: EXPORT_DUR, chs: chsRef.current });
        const map = new Map<string, Float32Array>();
        res.meta.channels.forEach((n, i) => map.set(n, res.data.subarray(i * res.meta.npts, (i + 1) * res.meta.npts)));
        const lanesForExport = materialize(pagePlan, (n) => map.get(n), res.meta.npts, planRes.effective);
        if (lanesForExport.length) {
          view = { lanes: lanesForExport, t0: res.meta.start, dur: res.meta.dur, npts: res.meta.npts };
        }
      } catch {
        // 取数失败就退回「按当前视图导出」
      } finally {
        setLoading(false);
      }
    }

    const cv = document.createElement("canvas");
    cv.width = Math.round(W * scale);
    cv.height = Math.round(H * scale);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // 与屏幕同一套逻辑坐标（W×H），按 scale 放大绘制 ⇒ 比例一致、细节更清晰
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paint(ctx, W, H, view);
    const name = `${(fileName || rid || caseId || "eeg").replace(/\.[^.]+$/, "")}_eeg.png`;

    const trigger = (href: string, revoke?: () => void) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); revoke?.(); }, 1500);
      addNotification(`${d.exported} ${cv.width}×${cv.height}`, "success");
    };

    if (cv.toBlob) {
      cv.toBlob((blob) => {
        if (!blob) { trigger(cv.toDataURL("image/png")); return; }
        const url = URL.createObjectURL(blob);
        trigger(url, () => URL.revokeObjectURL(url));
      }, "image/png");
    } else {
      trigger(cv.toDataURL("image/png"));
    }
  };

  const btn = "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)]/40 disabled:opacity-40 disabled:hover:bg-[var(--color-surface)]";
  const sel = "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]";

  return (
    <div className="space-y-3 select-none" data-viewer-version="eeg-v23">
      {/* 工具条：统一为「图标 + 文字」的五项，右侧对齐 */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] tabular-nums text-[var(--color-text-secondary)]/60" title="渲染器版本">
          v26
        </span>
        <button
          className={`${btn} ${isPanMode ? "border-[var(--color-primary)] text-[var(--color-primary)]" : ""}`}
          onClick={() => setIsPanMode((v) => !v)}
          title={d.pan}
          aria-pressed={isPanMode}
        >
          <Move className="h-3.5 w-3.5" /> {d.pan}
        </button>
        <button className={btn} onClick={() => setDur((v) => Math.min(60, v * 1.5))} title={d.zoomOut}>
          <ZoomOut className="h-3.5 w-3.5" /> {d.zoomOut}
        </button>
        <button className={btn} onClick={() => setDur((v) => Math.max(0.5, v / 1.5))} title={d.zoomIn}>
          <ZoomIn className="h-3.5 w-3.5" /> {d.zoomIn}
        </button>
        <button className={btn} onClick={reset} title={d.reset}>
          <RotateCcw className="h-3.5 w-3.5" /> {d.reset}
        </button>
        <button className={btn} onClick={downloadPng}>
          <Download className="h-3.5 w-3.5" /> {d.downloadPng}
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        {/* 时间分页 */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-[var(--color-text-secondary)]">{d.timePage}</span>
          <button className={btn} disabled={timePage <= 1} onClick={() => gotoTimePage(timePage - 1)} title={d.prevPage}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[50px] text-center text-xs tabular-nums text-[var(--color-text-secondary)]">
            {timePage}/{timePageCount}
          </span>
          <button className={btn} disabled={timePage >= timePageCount} onClick={() => gotoTimePage(timePage + 1)} title={d.nextPage}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 通道分页（通道多于 12 条时才出现） */}
        {totalLanePages > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-[var(--color-text-secondary)]">{d.chPage}</span>
              <button className={btn} disabled={pageClamped <= 0} onClick={() => setLanePage((p) => Math.max(0, p - 1))} title={d.prevPage}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[38px] text-center text-xs tabular-nums text-[var(--color-text-secondary)]">
                {pageClamped + 1}/{totalLanePages}
              </span>
              <button className={btn} disabled={pageClamped >= totalLanePages - 1} onClick={() => setLanePage((p) => Math.min(totalLanePages - 1, p + 1))} title={d.nextPage}>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* 画布 */}
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <canvas
          ref={canvasCb}
          data-lanes={shown.map((l) => l.label).join("|")}
          data-total-lanes={lanes.length}
          data-range={win ? `${win.meta.start.toFixed(2)}-${(win.meta.start + win.meta.dur).toFixed(2)}` : ""}
          data-source={win?.meta.source || ""}
          data-fs={win ? String(win.meta.fs) : ""}
          data-uvdiv={String(sensIdx >= 0 ? SENS_STEPS[sensIdx] : (autoUvDiv ?? ""))}
          data-dur={String(dur)}
          data-win={win ? `${win.meta.start.toFixed(2)}-${(win.meta.start + win.meta.dur).toFixed(2)}` : ""}
          className="block w-full cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}
        />
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--color-bg)]/45">
            <span className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> {d.loading} {loadingHint}{win ? "" : ""}
            </span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" /> {d.error}: {error}</span>
            <button className={btn} onClick={() => { cacheRef.current = null; load(start, dur); }}>{d.retry}</button>
          </div>
        )}
      </div>

    </div>
  );
}
