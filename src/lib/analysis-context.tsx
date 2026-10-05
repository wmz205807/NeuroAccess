"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useLang } from "@/lib/language-context";
import { addReport, syncReportToServer, type StoredReport } from "@/lib/reports-storage";
import { addNotification } from "@/components/NotificationToast";

// ── Types ───────────────────────────────────────────────────────────
export type Status = "pending" | "reading" | "computing" | "analysisReady" | "explaining" | "completed" | "failed";

export interface FileJob {
  id: string;
  file: File;
  name: string;
  size: number;
  status: Status;
  result?: any;
  eegData?: any;
  error?: string;
  /** 后端上报的真实分析阶段（receiving/metadata/signal/waveform/bands/features/report/ai） */
  stage?: string;
  /** 上传字节进度 0–100（仅上传阶段真实可得，由 XHR upload.onprogress 提供） */
  uploadPct?: number;
}

// ── safeJsonFetch ───────────────────────────────────────────────────
const API_BASE = "";
const ANALYZE_TIMEOUT = 300_000;   // 300s for /analyze (匹配 Nginx 超时，大文件如3MB+ 19ch需要)
const EXPLAIN_TIMEOUT = 180_000;  // 180s for /explain (AI may be slow)

// Lazy cache key to avoid SSR access to sessionStorage
let _filesCacheKey: string | null = null;
function getFilesCacheKey(): string {
  if (!_filesCacheKey && typeof window !== "undefined") {
    const sid = sessionStorage.getItem("neuroaccess-session-id")
      || (sessionStorage.setItem("neuroaccess-session-id", Math.random().toString(36).slice(2)),
          sessionStorage.getItem("neuroaccess-session-id"));
    _filesCacheKey = `neuroaccess-files-${sid}`;
  }
  return _filesCacheKey || "";
}
const SESSION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function safeJsonFetch(url: string, timeoutMs: number, options: RequestInit = {}, t?: (key: string) => string): Promise<any> {
  const tx = t || ((key: string) => key);
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("neuroaccess-token");
    if (token) {
      options.headers = {
        ...(options.headers as Record<string, string> || {}),
        "Authorization": `Bearer ${token}`,
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    if (!text.trim()) throw new Error(tx("emptyResponseFromBackend"));
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${tx("invalidJSON")}: ${text.slice(0, 300)}`);
    }
    if (!res.ok || data?.success === false) {
      const msg = data?.error || data?.detail || `HTTP ${res.status}`;
      // 凭证过期 (HTTP 401) → 自动跳转登录页
      if (res.status === 401) {
        try {
          localStorage.removeItem("neuroaccess-token");
          sessionStorage.removeItem(getFilesCacheKey());
          window.dispatchEvent(new CustomEvent("neuroaccess-token-expired"));
        } catch {}
        if (typeof window !== "undefined") window.location.href = "/login";
      }
      throw new Error(String(msg));
    }
    return data;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(tx("requestTimedOut"));
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── xhrAnalyze ──────────────────────────────────────────────────────
// 用 XMLHttpRequest 发送 /api/analyze。
// 为什么不继续用 fetch：fetch 拿不到「上传字节进度」，而上传几十 MB 的 EDF
// 本身就是用户要等待的重要一段；XHR 的 upload.onprogress 能给出真实字节百分比。
function xhrAnalyze(
  url: string,
  formData: FormData,
  timeoutMs: number,
  onUpload: (pct: number) => void,
  t?: (key: string) => string,
): Promise<any> {
  const tx = t || ((key: string) => key);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("neuroaccess-token") : null;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    } catch {}
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onUpload(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    // 字节发完 → 服务器开始处理，UI 可从「上传」切到「分析」
    xhr.upload.onload = () => onUpload(100);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        reject(new Error(`${tx("invalidJSON")}: ${(xhr.responseText || "").slice(0, 300)}`));
        return;
      }
      if (xhr.status === 401) {
        try {
          localStorage.removeItem("neuroaccess-token");
          sessionStorage.removeItem(getFilesCacheKey());
          window.dispatchEvent(new CustomEvent("neuroaccess-token-expired"));
        } catch {}
        if (typeof window !== "undefined") window.location.href = "/login";
      }
      if (xhr.status < 200 || xhr.status >= 300 || data?.success === false) {
        reject(new Error(String(data?.error || data?.detail || `HTTP ${xhr.status}`)));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error(tx("requestTimedOut")));
    xhr.send(formData);
  });
}

// ── Context ──────────────────────────────────────────────────────────
interface AnalysisContextValue {
  files: FileJob[];
  running: boolean;
  paused: boolean;
  expandId: string | null;
  setExpandId: (id: string | null) => void;
  handleFileSelect: (selected: FileList | null) => void;
  removeFile: (id: string) => void;
  retryFile: (id: string) => void;
  clearAll: () => void;
  startAnalysis: () => void;
  pauseAnalysis: () => void;
  resumeAnalysis: () => void;
  /** 游客体验：分析内置示例 EEG（无需登录，结果不落库） */
  analyzeSample: (sampleId: string, displayName: string) => Promise<void>;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}

// ── sessionStorage persist (layout persists, but dashboard remounts) ──
// 每次全页加载生成唯一会话ID，跨页面加载的旧数据永不恢复
// 注意：sessionStorage 跨页面加载保持，所以必须每次都生成新 ID，不能复用旧值
const SESSION_ID = typeof window !== "undefined"
  ? Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  : "ssr";

function serializeFiles(files: FileJob[]): string {
  const meta = {
    savedAt: Date.now(),
    items: files.map(f => ({
      id: f.id, name: f.name, size: f.size, status: f.status,
      result: f.result || null, eegData: f.eegData || null,
      error: f.error || null,
      stage: f.stage || null, uploadPct: typeof f.uploadPct === "number" ? f.uploadPct : null,
    })),
  };
  try { return JSON.stringify(meta); } catch { return '{"savedAt":0,"items":[]}'; }
}

function deserializeFiles(json: string): FileJob[] {
  try {
    const meta = JSON.parse(json);
    if (!meta?.items || !Array.isArray(meta.items)) return [];
    // Only restore if saved within last 30 min (prevent stale data)
    if (Date.now() - (meta.savedAt || 0) > 30 * 60 * 1000) return [];
    // 过滤掉因凭证过期导致的失败文件（登录页后会残留）
    const filtered = meta.items.filter((m: any) =>
      m.status !== "failed" || !(m.error && /Invalid credentials|401|unauthorized|not.logged.in/i.test(m.error))
    );
    return filtered.map((m: any) => ({
      id: m.id, name: m.name, size: m.size || 0, status: m.status || "pending",
      file: new File([], m.name || "unknown.edf"),
      result: m.result || null, eegData: m.eegData || null,
      error: m.error || null,
      stage: m.stage || undefined,
      uploadPct: typeof m.uploadPct === "number" ? m.uploadPct : undefined,
    }));
  } catch { return []; }
}

// ── Provider ────────────────────────────────────────────────────────
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { lang, t } = useLang();
  const [files, setFiles] = useState<FileJob[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [expandId, setExpandId] = useState<string | null>(null);
  const runningRef = useRef(false);
  const shouldPauseRef = useRef(false);
  const startAnalysisRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);

  // Persist files to sessionStorage whenever they change
  useEffect(() => {
    try { sessionStorage.setItem(getFilesCacheKey(), serializeFiles(files)); } catch {}
  }, [files]);

  // Restore files from sessionStorage for this session (SPA navigation preservation)
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(getFilesCacheKey());
      if (cached) {
        const restored = deserializeFiles(cached);
        if (restored.length > 0) {
          setFiles(restored);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    setFiles((prev) =>
      prev.map((item) => {
        if (item.status === "reading" || item.status === "computing" || item.status === "explaining" || item.status === "pending") return item;
        if (item.result) {
          return { ...item, result: { ...item.result, explanations: undefined } };
        }
        return item;
      }),
    );
    setExpandId(null);
  }, [lang]);

  // ── 文件选择 ─────────────────────────────────────────────────
  // 注意：不再在客户端按扩展名静默过滤文件。任何被选文件都先进入列表，
  // 格式是否合法交由后端分析时判定并回报错误。静默过滤会导致“选完文件完全没反应”
  // （例如文件实际为双扩展名或系统隐藏了真实后缀时），故此处接受全部文件。
  const handleFileSelect = useCallback((selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const filesArr = Array.from(selected);
    if (filesArr.length === 0) return;
    // 客户端先拦截超大文件（nginx client_max_body_size 50M），避免上传中途被断连、
    // 卡在"处理中"很久才报错
    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    setFiles((prev) => [
      ...prev,
      ...filesArr.map((file) => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        status: (file.size > MAX_FILE_BYTES ? "failed" : "pending") as Status,
        result: undefined,
        error: file.size > MAX_FILE_BYTES
          ? (t("fileTooLarge") || "文件超过 50MB 上限，无法上传")
          : undefined,
      })),
    ]);
  }, [t]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setExpandId(null);
    setRunning(false);
    setPaused(false);
    runningRef.current = false;
    shouldPauseRef.current = false;
    runIdRef.current = 0;
    try { sessionStorage.removeItem(getFilesCacheKey()); } catch {}
  }, []);

  const pauseAnalysis = useCallback(() => {
    shouldPauseRef.current = true;
    setPaused(true);
    runIdRef.current++;
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "reading" || f.status === "computing" || f.status === "explaining"
          ? { ...f, status: "pending" }
          : f
      )
    );
  }, []);

  const resumeAnalysis = useCallback(() => {
    shouldPauseRef.current = false;
    setPaused(false);
    runIdRef.current++;
    runningRef.current = false;
    if (startAnalysisRef.current) startAnalysisRef.current();
  }, []);

  // ── 重试单个失败文件 ────────────────────────────────────────
  const retryFile = useCallback((id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "pending" as Status, error: undefined } : f))
    );
    // Reset running state so startAnalysis can pick it up
    runIdRef.current++;
    runningRef.current = false;
    if (startAnalysisRef.current) startAnalysisRef.current();
  }, []);

  // ── 开始分析（v2.0 两阶段流程）─────────────────────────────
  const startAnalysis = useCallback(() => {
    if (files.length === 0 || runningRef.current) return;
    const myRunId = ++runIdRef.current;
    runningRef.current = true;
    setRunning(true);
    setPaused(false);
    shouldPauseRef.current = false;

    (async () => {
      try {
        for (const item of files) {
          if (shouldPauseRef.current) {
            if (runIdRef.current === myRunId) {
              setRunning(false);
              runningRef.current = false;
            }
            return;
          }
          if (runIdRef.current !== myRunId) return;
          if (item.status === "completed" || item.status === "failed") continue;

          // ── 阶段1：标记为 "reading" ─────────────────────────
          setFiles((prev) => {
            if (runIdRef.current !== myRunId) return prev;
            return prev.map((f) =>
              f.id === item.id ? { ...f, status: "reading", error: undefined } : f
            );
          });

          // ── 真实阶段轮询（每 600ms 读一次后端上报的阶段）──────
          // 后端在 /api/analyze 的各真实阶段边界写入进度表；这里并发读取，
          // 让 UI 显示「现在在做什么」，而不是一根与真实进展无关的进度条。
          let stageTimer: ReturnType<typeof setInterval> | null = null;

          try {
            // ── 阶段2：调用 /analyze（快速基础分析）─────────────
            setFiles((prev) => {
              if (runIdRef.current !== myRunId) return prev;
              return prev.map((f) =>
                f.id === item.id
                  ? { ...f, status: "computing", error: undefined, stage: undefined, uploadPct: 0 }
                  : f
              );
            });

            const pollStage = async () => {
              try {
                const r = await fetch(
                  `${API_BASE}/api/analysis/progress/${encodeURIComponent(item.id)}`,
                );
                const d = await r.json();
                if (d?.success && d.stage && runIdRef.current === myRunId) {
                  setFiles((prev) =>
                    prev.map((f) => (f.id === item.id ? { ...f, stage: d.stage } : f)),
                  );
                }
              } catch {
                /* 轮询失败不影响分析本身 */
              }
            };
            stageTimer = setInterval(pollStage, 600);
            pollStage();

            const formData = new FormData();
            formData.append("file", item.file);
            formData.append("language", lang);
            formData.append("report_id", item.id);
            // 复用同一个 id 作为进度键：后端据此写入真实阶段
            formData.append("progress_id", item.id);

            const data = await xhrAnalyze(
              `${API_BASE}/api/analyze`,
              formData,
              ANALYZE_TIMEOUT,
              (pct) => {
                if (runIdRef.current !== myRunId) return;
                setFiles((prev) =>
                  prev.map((f) => (f.id === item.id ? { ...f, uploadPct: pct } : f)),
                );
              },
              t,
            );

            if (!data.success) throw new Error(data.error || t("analysisFailed"));

            if (runIdRef.current !== myRunId) return;
            if (shouldPauseRef.current) {
              setFiles((prev) => {
                if (runIdRef.current !== myRunId) return prev;
                return prev.map((f) => f.id === item.id ? { ...f, status: "pending" } : f);
              });
              if (runIdRef.current === myRunId) {
                setRunning(false);
                runningRef.current = false;
              }
              return;
            }

            // ── 基础分析完成，立即显示结果（status = "analysisReady"）────
            let eegData: any = null;
            const waveformPreview = (data.analysis as any)?.waveform_preview;
            if (waveformPreview && waveformPreview.times && waveformPreview.channels) {
              const chNames = Object.keys(waveformPreview.channels || {});
              eegData = {
                success: true,
                file_name: item.name,
                channel_names: chNames,
                sampling_rate: waveformPreview.sampling_rate,
                duration_seconds: waveformPreview.duration_seconds,
                times: waveformPreview.times,
                channels: waveformPreview.channels,
                total_channels: chNames.length,
                total_samples: waveformPreview.times?.length || 0,
              };
            }

            if (runIdRef.current !== myRunId) return;

            // 先以 "analysisReady" 状态保存（基础分析完成，AI 解释还在生成）
            setFiles((prev) => {
              if (runIdRef.current !== myRunId) return prev;
              return prev.map((f) =>
                f.id === item.id ? { ...f, status: "analysisReady", result: data.analysis, eegData } : f
              );
            });

            // 报告暂不写入 localStorage / 服务器：等 AI 解释生成完成后才落库，
            // 保证报告列表不会出现"解释还在生成"的半成品报告。
            // 若 AI 解释最终拿不到，则用模板解释兜底保存，确保分析结果不丢失。
            const persistAnalysis = (analysis: any, explanations: any) => {
              const finalAnalysis = { ...analysis, explanations };
              let safeEegData: any = null;
              if (eegData) {
                safeEegData = { ...eegData };
                if (safeEegData.times && safeEegData.channels) {
                  const maxPts = Math.min(safeEegData.times.length, 500);
                  const step = Math.max(1, Math.floor(safeEegData.times.length / maxPts));
                  safeEegData.times = safeEegData.times.filter((_: any, i: number) => i % step === 0);
                  const chNames = Object.keys(safeEegData.channels);
                  for (const ch of chNames) {
                    safeEegData.channels[ch] = safeEegData.channels[ch].filter((_: any, i: number) => i % step === 0);
                  }
                  safeEegData.total_samples = safeEegData.times.length;
                }
              }
              const report: StoredReport = {
                id: item.id,
                fileName: item.name,
                date: new Date().toLocaleString(lang, { hour12: false }),
                mode: "Beginner",
                quality: (finalAnalysis as any)?.signal_quality_score ?? 0,
                language: lang,
                analysis: finalAnalysis,
                eegData: safeEegData,
              };
              try {
                addReport(report);
                syncReportToServer(report); // 跨设备同步
              } catch (e) {
                console.warn("[AnalysisProvider] addReport failed:", e);
              }
            };
            let analysisSaved = false;

            // ── 阶段3：调用 /explain（后台生成 AI 解释）────────
            setFiles((prev) => {
              if (runIdRef.current !== myRunId) return prev;
              return prev.map((f) =>
                f.id === item.id ? { ...f, status: "explaining" } : f
              );
            });

            const analysisForExplain = data.analysis;
            const analysisId = analysisForExplain?.analysis_id;

            // 先尝试 polling（后端后台线程已在 /analyze 中启动）
            if (analysisId) {
              let aiReady = false;
              for (let attempt = 0; attempt < 60; attempt++) {
                if (runIdRef.current !== myRunId) return;
                await new Promise((r) => setTimeout(r, 3000));
                if (runIdRef.current !== myRunId) return;
                try {
                  const token = localStorage.getItem("neuroaccess-token") || "";
                  const pollResp = await fetch(`/api/analysis/explanations/${analysisId}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                  });
                  const pollData = await pollResp.json();
                  if (pollData.success && pollData.explanations) {
                    // AI 解释就绪 → 此刻才把报告写入列表/服务器
                    persistAnalysis(data.analysis, pollData.explanations);
                    analysisSaved = true;
                    setFiles((prev) => {
                      if (runIdRef.current !== myRunId) return prev;
                      return prev.map((f) =>
                        f.id === item.id && f.result
                          ? { ...f, status: "completed", result: { ...f.result, explanations: pollData.explanations } }
                          : f
                      );
                    });
                    aiReady = true;
                    break;
                  }
                  if (!pollData.success) break; // unknown id
                } catch {
                  // network error, keep trying
                }
              }

              // Polling 超时或失败 → 尝试直接调用 /explain
              if (!aiReady && runIdRef.current === myRunId) {
                try {
                  const explainResp = await safeJsonFetch(`${API_BASE}/api/explain`, EXPLAIN_TIMEOUT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ analysis: analysisForExplain, language: lang }),
                  }, t);
                  if (explainResp.success && explainResp.explanations && runIdRef.current === myRunId) {
                    persistAnalysis(data.analysis, explainResp.explanations);
                    analysisSaved = true;
                    setFiles((prev) => {
                      if (runIdRef.current !== myRunId) return prev;
                      return prev.map((f) =>
                        f.id === item.id && f.result
                          ? { ...f, status: "completed", result: { ...f.result, explanations: explainResp.explanations } }
                          : f
                      );
                    });
                  }
                } catch (explainErr: any) {
                  console.warn(`[Explain] AI explanation call failed for ${item.name}:`, explainErr?.message);
                  // 基础分析仍然可用，标记为 completed（模板解释已在 result 中）
                }
              }
            }

            // ── 最终标记为 completed ───────────────────────────
            if (runIdRef.current === myRunId) {
              // AI 解释没拿到（轮询+explain 都失败）→ 用模板解释兜底保存，保证报告不丢
              if (!analysisSaved) {
                persistAnalysis(data.analysis, (data.analysis as any)?.explanations);
              }
              setFiles((prev) => {
                if (runIdRef.current !== myRunId) return prev;
                return prev.map((f) =>
                  f.id === item.id && (f.status === "analysisReady" || f.status === "explaining")
                    ? { ...f, status: "completed" }
                    : f
                );
              });
              addNotification(`${t("analysisCompleted")}: ${item.name}`, "success");
            }

          } catch (err: any) {
            if (runIdRef.current !== myRunId) return;
            console.error("Analyze failed:", item.name, err);
            setFiles((prev) => {
              if (runIdRef.current !== myRunId) return prev;
              return prev.map((f) =>
                f.id === item.id
                  ? { ...f, status: "failed", error: err?.message || String(err) }
                  : f
              );
            });
            addNotification(`${t("analysisFailed")}: ${item.name}`, "error");
          } finally {
            // 请求结束（成功或失败）都要停掉阶段轮询，避免空转
            if (stageTimer) clearInterval(stageTimer);
          }
        }
      } catch (unexpectedErr) {
        console.error("Unexpected error in analyzeAll:", unexpectedErr);
      } finally {
        if (runIdRef.current === myRunId) {
          runningRef.current = false;
          setRunning(false);
        }
      }
    })();
  }, [files, lang]);

  useEffect(() => {
    startAnalysisRef.current = startAnalysis;
  }, [startAnalysis]);

  // ── 游客体验：分析内置示例 EEG ──────────────────────────────────
  // 走 /api/try-sample：后端读取固定示例文件，返回与 /api/analyze 同构的结果，
  // 但不写数据库（游客报告只存在于本次会话）。AI 解释仍由后端后台线程生成，
  // 前端轮询 /api/analysis/explanations/{id} 补齐。
  const analyzeSample = useCallback(async (sampleId: string, displayName: string) => {
    const jobId = `sample-${sampleId}`;
    const job: FileJob = {
      id: jobId,
      file: new File([], displayName || sampleId),
      name: displayName || sampleId,
      size: 0,
      status: "computing",
    };
    // 同一样例重复点击时替换旧条目，避免堆叠
    setFiles((prev) => [...prev.filter((f) => f.id !== jobId), job]);
    setExpandId(jobId);
    setRunning(true);

    // 轮询后端真实阶段（示例文件在服务器本地，没有上传阶段，从 receiving 开始）
    let stageTimer: ReturnType<typeof setInterval> | null = null;
    try {
      const token = (typeof window !== "undefined" && localStorage.getItem("neuroaccess-token")) || "";

      const pollStage = async () => {
        try {
          const r = await fetch(
            `${API_BASE}/api/analysis/progress/${encodeURIComponent(jobId)}`,
          );
          const d = await r.json();
          if (d?.success && d.stage) {
            setFiles((prev) => prev.map((f) => (f.id === jobId ? { ...f, stage: d.stage } : f)));
          }
        } catch {
          /* 轮询失败不影响分析本身 */
        }
      };
      stageTimer = setInterval(pollStage, 600);
      pollStage();

      const res = await fetch(`${API_BASE}/api/try-sample`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sample: sampleId, language: lang, progress_id: jobId }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || "sample analysis failed");

      const analysis = data.analysis || {};
      const wp = analysis.waveform_preview || {};
      const eegData = {
        success: true,
        file_name: data.file_name,
        channel_names: analysis.channel_names || [],
        sampling_rate: analysis.sampling_rate,
        duration_seconds: analysis.recording_duration_seconds ?? analysis.duration_seconds,
        times: wp.times || [],
        channels: wp.channels || {},
        total_channels: (analysis.channel_names || []).length,
        total_samples: (wp.times || []).length,
      };

      setFiles((prev) => prev.map((f) =>
        f.id === jobId ? { ...f, status: "analysisReady", result: analysis, eegData } : f
      ));

      // 轮询 AI 解释（最多 ~3 分钟），就绪后标记 completed
      const aid = analysis.analysis_id;
      if (aid) {
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const pr = await fetch(`${API_BASE}/api/analysis/explanations/${aid}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const pd = await pr.json();
            if (pd?.success && pd.explanations) {
              setFiles((prev) => prev.map((f) =>
                f.id === jobId && f.result
                  ? { ...f, status: "completed", result: { ...f.result, explanations: pd.explanations } }
                  : f
              ));
              break;
            }
            if (pd && pd.success === false) break;
          } catch { /* 网络抖动继续重试 */ }
        }
      }
      // 模板解释已随首次响应返回，即使 AI 未就绪也视为可用
      setFiles((prev) => prev.map((f) =>
        f.id === jobId && f.status === "analysisReady" ? { ...f, status: "completed" } : f
      ));
    } catch (e: any) {
      setFiles((prev) => prev.map((f) =>
        f.id === jobId ? { ...f, status: "failed", error: e?.message || String(e) } : f
      ));
    } finally {
      if (stageTimer) clearInterval(stageTimer);
      setRunning(false);
    }
  }, [lang, setExpandId]);

  // Listen for token-expired event (dispatched by safeJsonFetch on 401)
  useEffect(() => {
    const handler = () => {
      setFiles([]);
      setRunning(false);
      setPaused(false);
      runningRef.current = false;
      shouldPauseRef.current = false;
      runIdRef.current = 0;
      try { sessionStorage.removeItem(getFilesCacheKey()); } catch {}
    };
    if (typeof window !== "undefined") {
      window.addEventListener("neuroaccess-token-expired", handler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("neuroaccess-token-expired", handler);
      }
    };
  }, []);

  return (
    <AnalysisContext.Provider
      value={{ files, running, paused, expandId, setExpandId, handleFileSelect, removeFile, clearAll, startAnalysis, pauseAnalysis, resumeAnalysis, retryFile, analyzeSample }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}
