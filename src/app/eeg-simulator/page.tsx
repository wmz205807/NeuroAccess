"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from "react";
import nextDynamic from "next/dynamic";
import { useLang } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import { Info, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { EEGGenerationManager as gen } from "@/lib/eeg-generation-manager";


const WaveformChart = nextDynamic(() => import("./WaveformChart"), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-[var(--color-bg)] rounded-xl h-64" />,
});
const PSDChart = nextDynamic(() => import("./PSDChart"), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-[var(--color-bg)] rounded-xl h-64" />,
});
const BandPowerChart = nextDynamic(() => import("./BandPowerChart"), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-[var(--color-bg)] rounded-xl h-48" />,
});

const PARAM_HELP_KEYS: Record<string, string> = {
  alpha_power: "alphaPowerHelp", beta_power: "betaPowerHelp",
  theta_power: "thetaPowerHelp", delta_power: "deltaPowerHelp", gamma_power: "gammaPowerHelp",
  alpha_freq: "alphaFreqHelp", beta_freq: "betaFreqHelp",
  theta_freq: "thetaFreqHelp", delta_freq: "deltaFreqHelp", gamma_freq: "gammaFreqHelp",
  noise_level: "noiseHelp",
  artifact_blink: "artifactBlinkHelp", artifact_muscle: "artifactMuscleHelp",
  artifact_powerline: "artifactPowerlineHelp",
};

const DEFAULT_PARAMS = {
  duration_sec: 10, sampling_rate: 250, n_channels: 8,
  alpha_power: 1.0, beta_power: 0.5, theta_power: 0.3, delta_power: 0.8, gamma_power: 0.3,
  alpha_freq: 10.0, beta_freq: 20.0, theta_freq: 6.0, delta_freq: 3.0, gamma_freq: 50.0,
  noise_level: 0.1,
  artifact_blink: false, artifact_muscle: false, artifact_powerline: false,
};

// ── 状态预设：一键把参数调到对应脑电状态的典型组合 ──────────────────────
const STATE_PRESETS: Record<string, { key: string; params: Partial<typeof DEFAULT_PARAMS> }> = {
  eyes_closed: {
    key: "stateEyesClosed",
    params: { alpha_power: 1.8, beta_power: 0.3, theta_power: 0.3, delta_power: 0.3, gamma_power: 0.1, alpha_freq: 10.0, noise_level: 0.05 },
  },
  eyes_open: {
    key: "stateEyesOpen",
    params: { alpha_power: 0.3, beta_power: 1.4, theta_power: 0.4, delta_power: 0.3, gamma_power: 0.5, noise_level: 0.12 },
  },
  drowsy: {
    key: "stateDrowsy",
    params: { alpha_power: 0.8, beta_power: 0.3, theta_power: 1.6, delta_power: 0.8, gamma_power: 0.1, noise_level: 0.08 },
  },
  deep_sleep: {
    key: "stateDeepSleep",
    params: { alpha_power: 0.1, beta_power: 0.1, theta_power: 0.5, delta_power: 1.9, gamma_power: 0.05, noise_level: 0.05 },
  },
  seizure: {
    key: "stateSeizure",
    params: { alpha_power: 1.2, beta_power: 1.0, theta_power: 1.6, delta_power: 0.9, gamma_power: 0.4, noise_level: 0.03 },
  },
  custom: {
    key: "stateCustom",
    params: {}, // 自定义预设：使用当前参数（含保存的自定义参数），点击展开高级参数
  },
};

// ── 通俗解读：把当前主导频段翻译成普通人能看懂的话（多语言，文本来自 translations）─
const BAND_RANGE: Record<string, string> = {
  delta: "0.5-4 Hz",
  theta: "4-8 Hz",
  alpha: "8-13 Hz",
  beta: "13-30 Hz",
  gamma: "", // gamma 用翻译 key simBandGammaRange（"30 Hz 以上" / "30+ Hz"）
};

function renderInterpretSentence(t: (k: string) => string, bandKey: string) {
  const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  const bandName = t(`simBand${cap(bandKey)}Name`);
  const bandLooks = t(`simBand${cap(bandKey)}Looks`);
  const bandMeaning = t(`simBand${cap(bandKey)}Meaning`);
  const bandRange = bandKey === "gamma" ? t("simBandGammaRange") : BAND_RANGE[bandKey] || "";
  const tpl = t("simInterpretSentence");
  const beforeBand = tpl.split("{band}")[0] || "";
  const afterBand = tpl.split("{band}")[1] || "";
  const mid = afterBand
    .replace(/\{range\}/g, bandRange)
    .replace(/\{looks\}/g, bandLooks)
    .split("{meaning}");
  return {
    beforeBand,
    bandName,
    mid: mid[0] || "",
    bandMeaning,
    afterMeaning: mid[1] || "",
  };
}

function dominantBandKey(params: any): string {
  const map: [string, string][] = [
    ["delta", "delta_power"], ["theta", "theta_power"], ["alpha", "alpha_power"],
    ["beta", "beta_power"], ["gamma", "gamma_power"],
  ];
  let best = "alpha", bestV = -1;
  for (const [k, key] of map) {
    if (Number(params[key]) > bestV) { bestV = Number(params[key]); best = k; }
  }
  return best;
}

// ── sessionStorage: 滑块参数持久化 ───────────────────────────────────
const SS_PARAMS_KEY = "neuroaccess-sim-params";
function loadParams(): any {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_PARAMS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveParams(p: any) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SS_PARAMS_KEY, JSON.stringify(p)); } catch {}
}

// ── 命名自定义预设：保存到账号（服务器同步）+ 本地缓存 ──────────────
const PRESETS_KEY = "neuroaccess-sim-presets";
interface SavedPreset { name: string; params: any; }
/** 模拟器时长上限 10 秒：加载任何来源的参数都钳制 */
function clampDuration(p: any): any {
  if (!p || typeof p !== "object") return p;
  const d = Number(p.duration_sec);
  return { ...p, duration_sec: Number.isFinite(d) ? Math.min(10, Math.max(1, d)) : 10 };
}
function loadPresetsLocal(): SavedPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(p => p && typeof p.name === "string" && p.params) : [];
  } catch { return []; }
}
/** 拉取预设：服务器优先（跨设备同步），本地有而服务器没有的自动迁移合并 */
async function fetchPresets(): Promise<SavedPreset[]> {
  const local = loadPresetsLocal();
  try {
    const token = typeof window !== "undefined" ? (localStorage.getItem("neuroaccess-token") || "") : "";
    if (!token) return local;
    const resp = await fetch("/api/sim-presets", { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (data.success && Array.isArray(data.presets)) {
      const server = data.presets.filter((p: any) => p && typeof p.name === "string" && p.params);
      // 合并：服务器空但本地有旧预设 → 迁移到服务器（避免旧本地数据被覆盖丢失）
      const merged = [...server];
      for (const l of local) {
        if (!merged.some(s => s.name === l.name)) merged.push(l);
      }
      if (merged.length !== server.length || server.length === 0) {
        await persistPresets(merged); // 同步合并结果回服务器
      }
      if (typeof window !== "undefined") {
        try { localStorage.setItem(PRESETS_KEY, JSON.stringify(merged)); } catch {}
      }
      return merged;
    }
  } catch {}
  return local;
}
/** 保存预设：写入服务器账号 + 本地缓存 */
async function persistPresets(list: SavedPreset[]) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch {}
  }
  try {
    const token = typeof window !== "undefined" ? (localStorage.getItem("neuroaccess-token") || "") : "";
    if (!token) return;
    await fetch("/api/sim-presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ presets: list }),
    });
  } catch {}
}

export default function EegSimulatorPage() {
  const { t } = useLang();
  // 游客（未登录）也可使用模拟器：不要求注册即可生成 / 观察 EEG 信号。
  // 仅「保存预设到账户」需要登录，相关调用本身已具备 token 判空保护。
  const { loading } = useAuth();

  // ── 生成状态（从 EEGGenerationManager 订阅，独立于组件生命周期）────
  const genState = useSyncExternalStore(
    useCallback((cb: () => void) => gen.subscribe(cb), []),
    () => gen.getState(),
    () => gen.getState(),
  );

  const genResult = useSyncExternalStore(
    useCallback((cb: () => void) => gen.subscribe(cb), []),
    () => gen.getResult(),
    () => gen.getResult(),
  );

  // 本地派生状态
  const isRunning = genState.status === "running";
  const isFailed = genState.status === "failed";
  const hasResult = !!genResult;
  const resultData = genResult?.data || null;

  // ── 滑块参数 ───────────────────────────────────────────────────────
  // 初始参数：默认闭眼放松预设（不自动加载自定义参数；自定义由用户点「保存当前参数」手动固化）
  const [params, setParams] = useState<any>(() => ({
    ...DEFAULT_PARAMS,
    ...(STATE_PRESETS.eyes_closed.params || {}),
  }));
  // 当前激活的预设：默认"闭眼放松"
  const [activePreset, setActivePreset] = useState<string>("stateEyesClosed");
  // 命名自定义预设列表（保存到账号，跨设备同步）
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [namingOpen, setNamingOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // 挂载时从服务器拉取账号预设
  useEffect(() => {
    let cancelled = false;
    fetchPresets().then((list) => { if (!cancelled) setSavedPresets(list); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const saved = loadParams();
    if (saved) setParams(clampDuration({ ...DEFAULT_PARAMS, ...saved }));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveParams(params);
  }, [params, hydrated]);

  // 参数统一更新入口：手动调整参数即视为自定义模式
  const updateParams = (next: any) => {
    setParams(next);
    setActivePreset("stateCustom");
  };

  // 保存当前参数为命名预设（名称限 10 字，写入账号）
  const confirmSavePreset = async () => {
    const name = presetName.trim().slice(0, 10);
    if (!name) return;
    const list = [...loadPresetsLocal(), { name, params: { ...params } }];
    await persistPresets(list);
    setSavedPresets(list);
    setNamingOpen(false);
    setPresetName("");
  };
  // 加载命名预设
  const applyPreset = (p: SavedPreset) => {
    setParams(clampDuration({ ...DEFAULT_PARAMS, ...p.params }));
    setActivePreset("stateCustom");
    setShowAdvanced(true);
    setConfirmDelete(null);
  };
  // 删除命名预设（二次确认防误触）
  const removePreset = async (name: string) => {
    const list = loadPresetsLocal().filter(p => p.name !== name);
    await persistPresets(list);
    setSavedPresets(list);
    setConfirmDelete(null);
  };

  // init manager (client-side only)
  useEffect(() => { gen.init(); }, []);

  // 注意：不自动生成。用户点击"生成 EEG"后才调用后端生成，
  // 刷新/重新进入页面时 gen.init() 会清空上次结果，页面保持空白待生成状态。

  const [helpOpen, setHelpOpen] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const toggleHelp = (key: string) => setHelpOpen(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // ── 动作 ───────────────────────────────────────────────────────────
  const startGenerate = () => gen.start(params);
  const cancelGenerate = () => gen.cancel();
  const clearResult = () => gen.clearResult();


  // ── 图表数据 ───────────────────────────────────────────────────────

  const psdData = useMemo(() => {
    if (!resultData?.psd?.frequencies || !resultData?.psd?.powers) return [];
    const freqs: number[] = resultData.psd.frequencies;
    const powers: number[][] = resultData.psd.powers;
    const avgPowers = freqs.map((_, i) => {
      const sum = powers.reduce((acc, ch) => acc + (ch[i] || 0), 0);
      return sum / powers.length;
    });
    const targetPoints = 100;
    const step = Math.max(1, Math.floor(freqs.length / targetPoints));
    const data: any[] = [];
    for (let i = 0; i < freqs.length; i += step) {
      data.push({
        freq: parseFloat(freqs[i].toFixed(2)),
        power: parseFloat(avgPowers[i].toExponential(2)),
      });
    }
    return data;
  }, [resultData]);

  const bandData = useMemo(() => [
    { name: `α ${t("bandAlpha")}`, value: params.alpha_power, range: "8-13 Hz", fill: "#3b82f6" },
    { name: `β ${t("bandBeta")}`, value: params.beta_power, range: "13-30 Hz", fill: "#22c55e" },
    { name: `δ ${t("bandDelta")}`, value: params.delta_power, range: "0.5-4 Hz", fill: "#ef4444" },
    { name: `θ ${t("bandTheta")}`, value: params.theta_power, range: "4-8 Hz", fill: "#facc15" },
    { name: `γ ${t("bandGamma")}`, value: params.gamma_power, range: "30-100 Hz", fill: "#a855f7" },
  ], [params, t]);

  // 实测频段功率：从生成结果的 PSD 按频段积分（各通道平均），归一化到 0-10 与输入滑杆同尺度对比
  const measuredBandData = useMemo(() => {
    const freqs: number[] = resultData?.psd?.frequencies;
    const powers: number[][] = resultData?.psd?.powers;
    if (!Array.isArray(freqs) || !freqs.length || !Array.isArray(powers) || !powers.length) return null;
    const avg = freqs.map((_, i) => powers.reduce((s, ch) => s + (ch[i] || 0), 0) / powers.length);
    const defs = [
      { key: "delta", name: `δ ${t("bandDelta")}`, lo: 0.5, hi: 4, fill: "#ef4444" },
      { key: "theta", name: `θ ${t("bandTheta")}`, lo: 4, hi: 8, fill: "#facc15" },
      { key: "alpha", name: `α ${t("bandAlpha")}`, lo: 8, hi: 13, fill: "#3b82f6" },
      { key: "beta", name: `β ${t("bandBeta")}`, lo: 13, hi: 30, fill: "#22c55e" },
      { key: "gamma", name: `γ ${t("bandGamma")}`, lo: 30, hi: 100, fill: "#a855f7" },
    ];
    const out = defs.map((b) => {
      let sum = 0;
      for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= b.lo && freqs[i] <= b.hi) sum += avg[i] || 0;
      }
      return { name: b.name, value: sum, range: `${b.lo}-${b.hi} Hz`, fill: b.fill };
    });
    const max = Math.max(...out.map((o) => o.value), 1e-12);
    out.forEach((o) => { o.value = parseFloat((o.value / max * 10).toFixed(2)); });
    return out;
  }, [resultData, t]);

  // ── 渲染辅助 ───────────────────────────────────────────────────────
  const renderSlider = (label: string, key: string, min: number, max: number, step: number) => {
    const helpKey = PARAM_HELP_KEYS[key];
    const helpText = helpKey ? t(helpKey) : "";
    const isOpen = helpOpen.has(key);
    return (
      <div key={key} className="mb-4">
        <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)] mb-1">
          <span>{label}: <span className="text-[var(--color-primary)] font-bold">{params[key]}</span></span>
          {helpText && helpText !== helpKey && (
            <button type="button" onClick={() => toggleHelp(key)}
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors ${isOpen ? "bg-[var(--color-primary)] text-[var(--color-bg)]" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"}`}>
              <Info className="w-3 h-3" />
            </button>
          )}
        </label>
        {isOpen && helpText && helpText !== helpKey && (
          <div className="mb-2 p-3 text-xs leading-relaxed text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-sm">{helpText}</div>
        )}
        <input type="range" min={min} max={max} step={step} value={params[key]}
          onChange={(e) => updateParams({ ...params, [key]: parseFloat(e.target.value) })}
          className="w-full accent-[var(--color-primary)]" disabled={isRunning} />
      </div>
    );
  };

  const renderCheckbox = (label: string, key: string) => {
    const helpKey = PARAM_HELP_KEYS[key];
    const helpText = helpKey ? t(helpKey) : "";
    const isOpen = helpOpen.has(key);
    return (
      <div key={key} className="mt-3">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer flex-1">
            <input type="checkbox" checked={params[key]} disabled={isRunning}
              onChange={(e) => updateParams({ ...params, [key]: e.target.checked })}
              className="rounded accent-[var(--color-primary)]" />
            <span className="text-sm text-[var(--color-text)]">{label}</span>
          </label>
          {helpText && helpText !== helpKey && (
            <button type="button" onClick={() => toggleHelp(key)}
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors shrink-0 ${isOpen ? "bg-[var(--color-primary)] text-[var(--color-bg)]" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"}`}>
              <Info className="w-3 h-3" />
            </button>
          )}
        </div>
        {isOpen && helpText && helpText !== helpKey && (
          <div className="mt-2 p-3 text-xs leading-relaxed text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-sm">{helpText}</div>
        )}
      </div>
    );
  };

  // ── 会话校验中：转圈（游客与登录用户都会短暂经过此状态）──────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <motion.div className="min-h-screen bg-[var(--color-bg)]"
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.05 }}>
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* ── 状态条 ────────────────────────────────────────────────── */}
        {isRunning && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">{t("generatingEEG")}</span>
                <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">({genState.progress}%)</span>
              </div>
            </div>
            <button onClick={cancelGenerate}
              className="text-xs px-3 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 hover:bg-blue-200 transition-colors">
              {t("cancel")}
            </button>
          </div>
        )}

        {isFailed && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">{t("generationFailed")}</span>
              {genState.error && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{genState.error}</p>}
            </div>
            <button onClick={() => gen.reset()}
              className="text-xs px-3 py-1 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-200 transition-colors">
              {t("dismiss")}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── 左侧控制面板 ─────────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] p-6">
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">{t("signalParameters")}</h2>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                {t("simIntro") || "这是一个脑电图（EEG）模拟器：选一个生活状态（比如「闭眼放松」），就能看到对应的大致脑电波形，以及它意味着什么。"}
              </p>

              {/* ── 状态预设 ─────────────────────────────────────────── */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t("statePresets") || "状态预设"}</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.values(STATE_PRESETS).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        if (preset.key === "stateCustom") {
                          // 自定义：保留当前参数，展开高级参数供自由调整
                          setActivePreset("stateCustom");
                          setShowAdvanced(true);
                        } else {
                          setActivePreset(preset.key);
                          setParams({ ...DEFAULT_PARAMS, ...preset.params });
                        }
                      }}
                      disabled={isRunning}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                        activePreset === preset.key
                          ? "border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10"
                          : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                      }`}
                    >
                      {t(preset.key)}
                    </button>
                  ))}
                </div>
                {activePreset === "stateCustom" && (
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    {t("customParamsHint") || "调整参数后点「保存当前参数」，输入名称即可保存为预设。"}
                  </p>
                )}

                {/* ── 我的命名预设 ─────────────────────────────────── */}
                {savedPresets.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">{t("myPresets") || "我的预设"}</h4>
                    <div className="flex flex-wrap gap-2">
                      {savedPresets.map((p) => (
                        <span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 pr-1 py-1 text-xs">
                          <button type="button" onClick={() => applyPreset(p)} disabled={isRunning}
                            className="text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40">
                            {p.name}
                          </button>
                          {confirmDelete === p.name ? (
                            <button type="button"
                              onClick={() => removePreset(p.name)}
                              className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                              {t("confirmDeletePreset") || "确认删除？"}
                            </button>
                          ) : (
                            <button type="button"
                              onClick={() => setConfirmDelete(p.name)}
                              title={t("deletePreset") || "删除预设"}
                              className="w-5 h-5 flex items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-red-500 hover:bg-red-500/10 transition-colors">
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 高级参数（默认折叠，普通人不需要动）────────────── */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                >
                  <span>{t("advancedParams") || "高级参数（通道/采样率/频段/噪声）"}</span>
                  <span>{showAdvanced ? "▲" : "▼"}</span>
                </button>
                {showAdvanced && (
                  <div className="mt-4 space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t("recordingParams") || "采集参数"}</h3>
                      {renderSlider(t("channelCount"), "n_channels", 1, 16, 1)}
                      {renderSlider(`${t("samplingRate")} (Hz)`, "sampling_rate", 100, 1000, 50)}
                      {renderSlider(`${t("duration")} (s)`, "duration_sec", 1, 10, 1)}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t("bandPower")}</h3>
                      {renderSlider(`α ${t("bandAlpha")} (8-13 Hz)`, "alpha_power", 0, 2, 0.1)}
                      {renderSlider(`β ${t("bandBeta")} (13-30 Hz)`, "beta_power", 0, 2, 0.1)}
                      {renderSlider(`δ ${t("bandDelta")} (0.5-4 Hz)`, "delta_power", 0, 2, 0.1)}
                      {renderSlider(`θ ${t("bandTheta")} (4-8 Hz)`, "theta_power", 0, 2, 0.1)}
                      {renderSlider(`γ ${t("bandGamma")} (30-100 Hz)`, "gamma_power", 0, 2, 0.1)}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t("bandFrequency")}</h3>
                      {renderSlider(`α ${t("bandAlpha")} Freq (Hz)`, "alpha_freq", 8, 13, 0.5)}
                      {renderSlider(`β ${t("bandBeta")} Freq (Hz)`, "beta_freq", 13, 30, 1)}
                      {renderSlider(`δ ${t("bandDelta")} Freq (Hz)`, "delta_freq", 0.5, 4, 0.5)}
                      {renderSlider(`θ ${t("bandTheta")} Freq (Hz)`, "theta_freq", 4, 8, 0.5)}
                      {renderSlider(`γ ${t("bandGamma")} Freq (Hz)`, "gamma_freq", 30, 100, 1)}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">{t("noiseAndArtifacts")}</h3>
                      {renderSlider(t("noiseLevel"), "noise_level", 0, 1, 0.05)}
                      {renderCheckbox(t("artifactBlink"), "artifact_blink")}
                      {renderCheckbox(t("artifactMuscle"), "artifact_muscle")}
                      {renderCheckbox(t("artifactPowerline"), "artifact_powerline")}
                    </div>

                    {/* ── 保存为命名预设 ─────────────────────────────── */}
                    <div className="space-y-2">
                      {namingOpen ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder={t("presetNamePlaceholder") || "预设名称"}
                            maxLength={10}
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={confirmSavePreset}
                            disabled={!presetName.trim() || isRunning}
                            className="px-3 py-2 rounded-xl text-sm font-medium bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                          >
                            {t("confirmSave") || "确认"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setNamingOpen(false); setPresetName(""); }}
                            className="px-2 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNamingOpen(true)}
                          disabled={isRunning}
                          className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                          {t("saveCustomParams") || "保存当前参数"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Generate / Cancel */}
              {!isRunning ? (
                <button onClick={startGenerate} disabled={isRunning}
                  className="w-full px-6 py-3 bg-[var(--color-primary)] text-[var(--color-bg)] rounded-xl hover:opacity-90 transition-opacity font-medium disabled:opacity-50">
                  {hasResult ? t("generateEEG") + " (New)" : t("generateEEG")}
                </button>
              ) : (
                <button onClick={cancelGenerate}
                  className="w-full px-6 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors font-medium">
                  {t("cancelGeneration")} ({genState.progress}%)
                </button>
              )}
            </div>
          </div>

          {/* ── 右侧可视化 ───────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[var(--color-surface)] rounded-2xl shadow-sm border border-[var(--color-border)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{t("visualization")}</h2>
                {hasResult && !isRunning && (
                  <button onClick={clearResult}
                    className="text-xs px-2 py-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors">
                    {t("clearBtn")}
                  </button>
                )}
              </div>

              {/* Empty state */}
              {!resultData && !isRunning && (
                <div className="text-center py-20 text-[var(--color-text-secondary)]">
                  <svg className="mx-auto h-16 w-16 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <p>{t("clickToGenerate")}</p>
                </div>
              )}

              {/* Running state */}
              {isRunning && !resultData && (
                <div className="text-center py-20">
                  <Loader2 className="mx-auto h-12 w-12 text-[var(--color-primary)] animate-spin mb-4" />
                  <p className="text-[var(--color-text)] font-medium">{t("generatingEEG")}...</p>
                  <div className="mt-4 w-64 mx-auto bg-[var(--color-bg)] rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-500"
                      style={{ width: `${genState.progress}%` }} />
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-2">{genState.progress}%</p>
                </div>
              )}

              {/* Results */}
              {resultData && (
                <div>
                  {/* ── 通俗解读：普通人能看懂这段波形意味着什么 ─────── */}
                  {(() => {
                    const seg = renderInterpretSentence(t, dominantBandKey(params));
                    return (
                      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4 text-sm leading-relaxed text-[var(--color-text)]">
                        <h3 className="mb-1 font-semibold text-blue-700 dark:text-blue-400">
                          {t("simHowToRead") || "这段波形怎么看"}
                        </h3>
                        <p>
                          {seg.beforeBand}<b>{seg.bandName}</b>{seg.mid}<b>{seg.bandMeaning}</b>{seg.afterMeaning}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {t("simInterpretHint") || "提示：真实脑电图的解读需要由专业医生结合完整临床背景进行，这里仅供科普学习。"}
                        </p>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-text-secondary)]">{t("channelCount")}</p>
                      <p className="text-lg font-bold text-[var(--color-text)]">{resultData.channel_names?.length || 0}</p>
                    </div>
                    <div className="bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-text-secondary)]">{t("samplingRate")}</p>
                      <p className="text-lg font-bold text-[var(--color-text)]">{resultData.sampling_rate} Hz</p>
                    </div>
                    <div className="bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-text-secondary)]">{t("duration")}</p>
                      <p className="text-lg font-bold text-[var(--color-text)]">{resultData.duration_seconds} s</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">{t("timeDomainWaveform")}</h3>
                    <div className="bg-[var(--color-bg)] rounded-xl p-4 border border-[var(--color-border)]">
                      <WaveformChart resultData={resultData} />
                    </div>
                  </div>

                  {resultData.psd && (
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">{t("psdSpectrum")}</h3>
                      <p className="text-xs text-[var(--color-text-secondary)] mb-2">{t("psdDescription")}</p>
                      <div className="bg-[var(--color-bg)] rounded-xl p-4 border border-[var(--color-border)]">
                        <PSDChart data={psdData} />
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">{t("bandPower")}</h3>
                    <div className="bg-[var(--color-bg)] rounded-xl p-4 border border-[var(--color-border)]">
                      <BandPowerChart data={measuredBandData || bandData} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
