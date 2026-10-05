"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/language-context";
import type { Status } from "@/lib/analysis-context";
import { CheckCircle2, Loader2, Circle } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
 * 分析分步进度（自包含七语言，避免污染共享的 translations.ts）
 *
 * 为什么要有这个组件：/api/analyze 是「一次请求跑完整个分析」，用户在整个
 * 请求期间只能看到一根与真实进展无关的进度条。这里把后端上报的真实阶段
 * 拆成 6 步展示，让「现在在做什么」可见：
 *   · 第 1 步（上传文件）的百分比来自 XHR upload.onprogress —— 真实字节数；
 *   · 第 2–5 步来自后端 analyze_edf 内部的真实阶段边界（metadata / signal /
 *     waveform / bands / features / assembling / report）；
 *   · 第 6 步（AI 解读）由后端启动后台 AI 线程时上报。
 * 不做按时间伪造的假进度。
 *
 * 2026-10-04 改版（用户：「分析过程还是不够直观」）—— 在原来「图标 + 名称」
 * 的基础上补四件让进程可读的东西，全部来自真实状态，没有一处凭时间瞎猜：
 *   ① 六段式进度条：已完成段实心、当前段脉冲、未开始段留空 —— 一眼看出还剩几步；
 *   ② 「第 N / 6 步」与真实已用秒数（本地计时，只读时钟，不参与进度推算）；
 *   ③ 每一步下面补一行大白话说明，讲清这一步到底在算什么（教育平台，顺便当讲解）；
 *   ④ 上传步的百分比直接填进第 1 段的宽度里，不再只是右侧一个小数字。
 * ──────────────────────────────────────────────────────────────────────────── */

type STEPS_L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

type StepCopy = { name: string; desc: string };

export const STEP_TXT: Record<STEPS_L, {
  title: string;
  /** 「第 {n} / 6 步」 */
  ofTpl: string;
  /** 「已用 {s} 秒」 */
  elapsedTpl: string;
  /** 恰好 6 步，顺序与 stepIndex 的 0–5 一一对应 */
  steps: StepCopy[];
}> = {
  zh: {
    title: "分析进度",
    ofTpl: "第 {n} / 6 步",
    elapsedTpl: "已用 {s} 秒",
    steps: [
      { name: "上传文件", desc: "把 .edf 文件传到分析服务器" },
      { name: "读取 EEG 信号", desc: "解析导联、采样率与时长" },
      { name: "信号处理与质量分析", desc: "带通滤波、去伪迹，逐通道质量评分" },
      { name: "频域与波形分析", desc: "计算 δ/θ/α/β 频段功率并生成波形" },
      { name: "生成分析报告", desc: "汇总指标并撰写模板解读" },
      { name: "AI 生成分级解读", desc: "生成初学者 / 学生 / 研究者三层解读" },
    ],
  },
  en: {
    title: "Analysis progress",
    ofTpl: "Step {n} of 6",
    elapsedTpl: "{s}s elapsed",
    steps: [
      { name: "Uploading file", desc: "Sending the .edf file to the analysis server" },
      { name: "Reading EEG signal", desc: "Parsing channels, sample rate and duration" },
      { name: "Signal processing & quality", desc: "Band-pass filtering, artifact removal, per-channel quality scoring" },
      { name: "Frequency & waveform analysis", desc: "Computing δ/θ/α/β band power and drawing the waveform" },
      { name: "Building report", desc: "Collecting metrics and writing template explanations" },
      { name: "AI generating explanations", desc: "Producing beginner / student / researcher levels" },
    ],
  },
  es: {
    title: "Progreso del análisis",
    ofTpl: "Paso {n} de 6",
    elapsedTpl: "{s}s transcurridos",
    steps: [
      { name: "Subiendo archivo", desc: "Enviando el archivo .edf al servidor de análisis" },
      { name: "Leyendo señal EEG", desc: "Analizando canales, frecuencia de muestreo y duración" },
      { name: "Procesado y calidad de señal", desc: "Filtrado paso banda, eliminación de artefactos, calidad por canal" },
      { name: "Análisis de frecuencia y forma de onda", desc: "Calculando la potencia de las bandas δ/θ/α/β y trazando la forma de onda" },
      { name: "Generando informe", desc: "Reuniendo métricas y redactando explicaciones" },
      { name: "IA generando explicaciones", desc: "Generando niveles principiante / estudiante / investigador" },
    ],
  },
  fr: {
    title: "Progression de l'analyse",
    ofTpl: "Étape {n} sur 6",
    elapsedTpl: "{s}s écoulées",
    steps: [
      { name: "Envoi du fichier", desc: "Envoi du fichier .edf au serveur d'analyse" },
      { name: "Lecture du signal EEG", desc: "Analyse des canaux, de la fréquence d'échantillonnage et de la durée" },
      { name: "Traitement et qualité du signal", desc: "Filtrage passe-bande, suppression des artefacts, qualité par canal" },
      { name: "Analyse fréquentielle et de la forme d'onde", desc: "Calcul de la puissance des bandes δ/θ/α/β et tracé de la forme d'onde" },
      { name: "Génération du rapport", desc: "Regroupement des mesures et rédaction des explications" },
      { name: "IA : génération des explications", desc: "Production des niveaux débutant / étudiant / chercheur" },
    ],
  },
  de: {
    title: "Analysefortschritt",
    ofTpl: "Schritt {n} von 6",
    elapsedTpl: "{s}s vergangen",
    steps: [
      { name: "Datei wird hochgeladen", desc: "Die .edf-Datei wird an den Analyseserver gesendet" },
      { name: "EEG-Signal wird gelesen", desc: "Kanäle, Abtastrate und Dauer werden ausgelesen" },
      { name: "Signalverarbeitung & Qualität", desc: "Bandpassfilterung, Artefaktentfernung, Qualitätsbewertung je Kanal" },
      { name: "Frequenz- und Wellenformanalyse", desc: "Berechnung der δ/θ/α/β-Bandleistung und Zeichnen der Wellenform" },
      { name: "Bericht wird erstellt", desc: "Kennzahlen werden gesammelt und Erläuterungen verfasst" },
      { name: "KI erstellt Erläuterungen", desc: "Erzeugung der Stufen Anfänger / Student / Forscher" },
    ],
  },
  ja: {
    title: "分析の進行状況",
    ofTpl: "ステップ {n} / 6",
    elapsedTpl: "経過 {s} 秒",
    steps: [
      { name: "ファイルをアップロード", desc: ".edf ファイルを解析サーバーへ送信" },
      { name: "EEG 信号を読み込み", desc: "チャンネル・サンプリング周波数・記録時間を解析" },
      { name: "信号処理と品質評価", desc: "帯域通過フィルタ、アーチファクト除去、チャンネルごとの品質評価" },
      { name: "周波数・波形分析", desc: "δ/θ/α/β 帯域パワーを算出し波形を描画" },
      { name: "レポートを作成", desc: "指標を集計し解説文を作成" },
      { name: "AI が解説を生成", desc: "初学者・学生・研究者の3段階の解説を生成" },
    ],
  },
  ko: {
    title: "분석 진행 상황",
    ofTpl: "{n} / 6 단계",
    elapsedTpl: "{s}초 경과",
    steps: [
      { name: "파일 업로드", desc: ".edf 파일을 분석 서버로 전송" },
      { name: "EEG 신호 읽기", desc: "채널·샘플링 레이트·기록 시간 분석" },
      { name: "신호 처리 및 품질 분석", desc: "대역 통과 필터, 아티팩트 제거, 채널별 품질 평가" },
      { name: "주파수·파형 분석", desc: "δ/θ/α/β 대역 파워를 계산하고 파형 생성" },
      { name: "보고서 생성", desc: "지표를 모아 해설문 작성" },
      { name: "AI 해설 생성", desc: "초급·학생·연구자 3단계 해설 생성" },
    ],
  },
};

/** 把后端上报的真实阶段折算成 0–5 的步骤序号；6 = 全部完成，-1 = 未开始/失败 */
export function stepIndex(status: Status, stage?: string, uploadPct?: number): number {
  if (status === "pending" || status === "failed") return -1;
  if (status === "completed") return 6;
  if (status === "reading") return 0;
  if (status === "analysisReady" || status === "explaining") return 5;
  if (typeof uploadPct === "number" && uploadPct < 100) return 0;
  switch (stage) {
    case "receiving":
    case "metadata":   return 1;
    case "signal":     return 2;
    case "waveform":
    case "bands":
    case "features":
    case "assembling": return 3;
    case "report":     return 4;
    case "ai":         return 5;
    default:           return 1;
  }
}

/**
 * 分析进行中的分步进度。只在 status 处于处理中时渲染有意义的内容。
 * `variant="card"` 用于案例页的独立卡片，默认用于文件卡片内嵌。
 */
export default function AnalysisSteps({
  status, stage, uploadPct, variant = "inline",
}: {
  status: Status;
  stage?: string;
  uploadPct?: number;
  variant?: "inline" | "card";
}) {
  const { lang } = useLang();
  const st = STEP_TXT[(lang as STEPS_L)] || STEP_TXT.en;
  const cur = stepIndex(status, stage, uploadPct);
  const running = cur >= 0 && cur <= 5;

  // 真实已用时间：只读时钟，不做任何"按时间推进进度"的推断。
  // 计时起点用 ref 记忆，running 翻成 false 时清空，下一轮分析重新计时。
  const startRef = useRef<number | null>(null);
  const [, force] = useState(0);
  // mounted 门闩：SSR 阶段不可能处于 running（要等用户点上传），
  // 但为彻底杜绝水合不一致，时间与百分比一律挂载后再显示。
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!running) { startRef.current = null; return; }
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;

  const elapsed = startRef.current !== null ? Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)) : 0;
  const uploadRunning = cur === 0 && typeof uploadPct === "number" && uploadPct > 0 && uploadPct < 100;
  const gap = variant === "card" ? "space-y-2.5" : "space-y-2";

  return (
    <div>
      {/* 标题行：左侧标题，右侧「第 N / 6 步」 */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          {st.title}
        </span>
        <span className="shrink-0 font-mono text-[10px] font-semibold text-[var(--color-text)]">
          {st.ofTpl.replace("{n}", String(cur + 1))}
        </span>
      </div>

      {/* 六段式进度条：一眼看出还剩几步 */}
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={cur + 1}>
        {st.steps.map((_, i) => {
          const done = i < cur;
          const active = i === cur;
          return (
            <div
              key={i}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]"
            >
              {done && <div className="h-full w-full rounded-full bg-emerald-500" />}
              {active && !uploadRunning && (
                <div className="h-full w-full animate-pulse rounded-full bg-blue-500" />
              )}
              {active && uploadRunning && (
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${uploadPct}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 真实已用秒数 + 当前步的实时百分比（仅上传步有真实百分比） */}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
        <span className="font-mono">{mounted ? st.elapsedTpl.replace("{s}", String(elapsed)) : ""}</span>
        {uploadRunning && (
          <span className="ml-auto shrink-0 font-mono font-semibold text-blue-600 dark:text-blue-400">
            {uploadPct}%
          </span>
        )}
      </div>

      {/* 步骤清单：每步一行名称 + 一行"这一步在算什么"的说明 */}
      <ol className={`mt-3 ${gap}`}>
        {st.steps.map((r, i) => {
          const isDone = i < cur;
          const isActive = i === cur;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-[1px] shrink-0">
                {isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[var(--color-border)]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    isActive
                      ? "font-medium text-[var(--color-text)]"
                      : "text-[var(--color-text-secondary)]"
                  }
                >
                  {r.name}
                </span>
                <span
                  className={
                    "mt-0.5 block text-[10px] leading-4 " +
                    (isActive
                      ? "text-blue-600 dark:text-blue-400"
                      : isDone
                        ? "text-[var(--color-text-secondary)] opacity-80"
                        : "text-[var(--color-text-secondary)] opacity-55")
                  }
                >
                  {r.desc}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
