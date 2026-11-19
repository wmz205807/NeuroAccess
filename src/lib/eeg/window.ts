/**
 * EEG 窗口数据客户端
 * 2026-11-18：从 /api/eeg/window 取 float32 二进制（真实采样值），
 * 元信息在 X-EEG-Meta（base64 JSON）。不做任何插值/平滑。
 */

export interface EegWindowMeta {
  channels: string[];
  allChannels: string[];
  ch0: number;
  fs: number;
  start: number;
  dur: number;
  npts: number;
  totalSeconds: number;
  source: "edf" | "preview" | string;
  nativeFs: number;
  unit: string;
}

export interface EegWindowData {
  meta: EegWindowMeta;
  /** [nch][npts] 摊平，按 ch * npts + i 取 */
  data: Float32Array;
}

function b64ToJson(b64: string): any {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

export interface EegInfo {
  channels: string[];
  fs: number;
  totalSeconds: number;
  source: string;
}

/** 轻量元信息：通道清单 / 采样率 / 总时长（不含采样点） */
export async function fetchEegInfo(opts: { rid?: string; caseId?: string }): Promise<EegInfo> {
  const token = typeof window !== "undefined" ? localStorage.getItem("neuroaccess-token") || "" : "";
  const qs = new URLSearchParams();
  if (opts.caseId) qs.set("case_id", opts.caseId);
  else if (opts.rid) qs.set("rid", opts.rid);
  const resp = await fetch(`/api/eeg/info?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  const j = await resp.json();
  if (!resp.ok || j.success === false) throw new Error(j.error || `HTTP ${resp.status}`);
  return { channels: j.channels, fs: j.fs, totalSeconds: j.totalSeconds, source: j.source };
}

export async function fetchEegWindow(opts: {
  rid?: string;
  caseId?: string;
  start: number;
  dur: number;
  ch0?: number;
  nch?: number;
  chs?: string;
  signal?: AbortSignal;
}): Promise<EegWindowData> {
  const token = typeof window !== "undefined" ? localStorage.getItem("neuroaccess-token") || "" : "";
  const qs = new URLSearchParams();
  if (opts.caseId) qs.set("case_id", opts.caseId);
  else if (opts.rid) qs.set("rid", opts.rid);
  qs.set("start", String(Math.max(0, opts.start)));
  qs.set("dur", String(opts.dur));
  if (opts.chs) qs.set("chs", opts.chs);
  if (opts.ch0 !== undefined) qs.set("ch0", String(opts.ch0));
  if (opts.nch !== undefined) qs.set("nch", String(opts.nch));

  const resp = await fetch(`/api/eeg/window?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  const ctype = resp.headers.get("content-type") || "";
  if (!resp.ok || ctype.includes("application/json")) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      msg = j.error || j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  const hdr = resp.headers.get("X-EEG-Meta");
  if (!hdr) throw new Error("缺少 X-EEG-Meta");
  const meta: EegWindowMeta = b64ToJson(hdr);
  const buf = await resp.arrayBuffer();
  const data = new Float32Array(buf);
  if (data.length < meta.npts * meta.channels.length) {
    throw new Error("数据长度与元信息不一致");
  }
  return { meta, data };
}
