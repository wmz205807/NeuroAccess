/**
 * EEG 导联（montage）定义与推导
 * 2026-11-18：参考临床 EEG 阅图习惯实现，**只做通道间的代数组合**（相减/去均值），
 * 不对采样点做任何滤波、插值或平滑 —— 保证波形形态与原始采样一致。
 *
 * 2026-11-19：拆成两步 —— planLanes() 只算「需要哪些原始通道」，materialize() 再算波形。
 * 这样前端只需拉取当前页用到的通道，避免 63 通道整包传输。
 */

export type MontageKind = "as-recorded" | "longitudinal" | "transverse" | "average";

export interface LanePlan {
  label: string;
  /** 该导联依赖的原始通道名（diff 时为 [a, b]，表示 a−b） */
  from: string[];
  op: "direct" | "diff" | "avg-ref";
}

export interface MontageLane {
  label: string;
  /** 计算后的采样值（µV），长度与窗口 npts 一致 */
  data: Float32Array;
  /** 该导联由哪些原始通道推导而来（用于提示） */
  from: string[];
}

/** 归一化通道名：去掉 MNE 的尾点、转大写，便于匹配 10-20 名称 */
export function normChannel(name: string): string {
  return name.trim().replace(/\.+$/, "").toUpperCase();
}

const LONGITUDINAL: [string, string][] = [
  ["FP1", "F3"], ["F3", "C3"], ["C3", "P3"], ["P3", "O1"],
  ["FP2", "F4"], ["F4", "C4"], ["C4", "P4"], ["P4", "O2"],
  ["FP1", "F7"], ["F7", "T3"], ["T3", "T5"], ["T5", "O1"],
  ["FP2", "F8"], ["F8", "T4"], ["T4", "T6"], ["T6", "O2"],
  ["FZ", "CZ"], ["CZ", "PZ"],
];

const TRANSVERSE: [string, string][] = [
  ["F7", "F3"], ["F3", "FZ"], ["FZ", "F4"], ["F4", "F8"],
  ["T3", "C3"], ["C3", "CZ"], ["CZ", "C4"], ["C4", "T4"],
  ["T5", "P3"], ["P3", "PZ"], ["PZ", "P4"], ["P4", "T6"],
];

/** 10-20 旧名 ↔ 新名别名（T3=T7, T5=P7, T4=T8, T6=P8） */
const ALIAS: Record<string, string[]> = {
  T3: ["T3", "T7"], T7: ["T7", "T3"],
  T4: ["T4", "T8"], T8: ["T8", "T4"],
  T5: ["T5", "P7"], P7: ["P7", "T5"],
  T6: ["T6", "P8"], P8: ["P8", "T6"],
};

/** 展示用名称：去掉 MNE 的尾点 */
const showName = (n: string) => n.replace(/\.+$/, "");

/** 通道名是否已经是双极导联（形如 FP1-F7） */
export function looksBipolar(names: string[]): boolean {
  const hit = names.filter((n) => /^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(n.trim()));
  return hit.length >= Math.max(3, Math.floor(names.length * 0.6));
}

/** 规划导联：只依赖通道名，不依赖采样数据 */
export function planLanes(
  names: string[],
  kind: MontageKind,
): { plan: LanePlan[]; note?: string; effective: MontageKind } {
  const bipolarInput = looksBipolar(names);

  if (kind === "as-recorded" || bipolarInput) {
    return {
      plan: names.map((n) => ({ label: showName(n), from: [n], op: "direct" as const })),
      effective: "as-recorded",
      note: bipolarInput && kind !== "as-recorded" ? "该记录本身已是双极导联，已按原始导联显示" : undefined,
    };
  }

  if (kind === "average") {
    return {
      plan: names.map((n) => ({ label: `${showName(n)}−AVG`, from: [n], op: "avg-ref" as const })),
      effective: "average",
    };
  }

  const pairs = kind === "longitudinal" ? LONGITUDINAL : TRANSVERSE;
  const index = new Map<string, string>();
  names.forEach((n) => index.set(normChannel(n), n));
  const pick = (key: string): string | undefined => {
    const direct = index.get(key);
    if (direct) return direct;
    for (const alt of ALIAS[key] || []) {
      const hit = index.get(alt);
      if (hit) return hit;
    }
    return undefined;
  };

  const plan: LanePlan[] = [];
  const missing: string[] = [];
  for (const [a, b] of pairs) {
    const na = pick(a);
    const nb = pick(b);
    if (!na || !nb) {
      missing.push(`${a}-${b}`);
      continue;
    }
    plan.push({ label: `${showName(na)}−${showName(nb)}`, from: [na, nb], op: "diff" });
  }

  if (!plan.length) {
    return {
      plan: names.map((n) => ({ label: showName(n), from: [n], op: "direct" as const })),
      effective: "as-recorded",
      note: "没有匹配到标准 10-20 名称，已回退为原始导联",
    };
  }

  return {
    plan,
    effective: kind,
    note: missing.length ? `缺少 ${missing.length} 对标准导联，仅显示可组成的 ${plan.length} 条` : undefined,
  };
}

/** 用实际采样数据把导联算出来 */
export function materialize(
  plan: LanePlan[],
  get: (name: string) => Float32Array | undefined,
  npts: number,
  kind: MontageKind,
): MontageLane[] {
  const out: MontageLane[] = [];

  if (kind === "average") {
    const all = plan.map((p) => get(p.from[0])).filter(Boolean) as Float32Array[];
    if (!all.length) return out;
    const mean = new Float32Array(npts);
    for (const arr of all) for (let i = 0; i < npts; i++) mean[i] += arr[i];
    for (let i = 0; i < npts; i++) mean[i] /= all.length;
    for (const p of plan) {
      const a = get(p.from[0]);
      if (!a) continue;
      const d = new Float32Array(npts);
      for (let i = 0; i < npts; i++) d[i] = a[i] - mean[i];
      out.push({ label: p.label, data: d, from: p.from });
    }
    return out;
  }

  for (const p of plan) {
    if (p.op === "diff") {
      const a = get(p.from[0]);
      const b = get(p.from[1]);
      if (!a || !b) continue;
      const d = new Float32Array(npts);
      for (let i = 0; i < npts; i++) d[i] = a[i] - b[i];
      out.push({ label: p.label, data: d, from: p.from });
    } else {
      const a = get(p.from[0]);
      if (!a) continue;
      out.push({ label: p.label, data: a, from: p.from });
    }
  }
  return out;
}
