"use client";

/**
 * GuestLanding —— 游客（未登录）首页落地区
 *
 * 设计目标（用户需求）：
 *  - 第一次访问即可理解 NeuroAccess 是什么，并能「现在就试」
 *  - 主 CTA：Try Sample EEG（真实分析，无需注册）
 *  - 次 CTA：Analyze My EEG（游客同样可直接上传，只是不保存历史）
 *  - 如实描述处理位置与隐私：Privacy is part of the architecture（不承诺假的"全程本地处理"）
 *  - 示例 EEG 带真实元数据（名称/用途/来源/许可/录制信息/适合观察什么）
 *  - 不虚构医学标签；不承诺虚假隐私
 *
 * 本组件自带七语言字典（不污染 translations.ts，避免多人协作冲突）。
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  UploadCloud, Activity, BookOpen, Stethoscope, ArrowRight,
  ShieldCheck, Cpu, Sparkles, FileText, Layers, Loader2,
} from "lucide-react";
import { useLang } from "@/lib/language-context";

type L = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

type SampleId = "clean" | "noisy" | "frequency";

type SampleMeta = {
  id: SampleId;
  channels?: number;
  sampling_rate?: number;
  duration_sec?: number;
  kind?: string;
  source?: string;
  license?: string;
  recording?: string;
  available?: boolean;
};

const S: Record<L, Record<string, any>> = {
  zh: {
    heroTitle: "让 EEG 不再难懂",
    heroSub: "一个免费、开源、隐私优先的脑电 literacy 平台，帮助你探索和理解脑电数据。",
    ctaPrimary: "试试示例 EEG",
    ctaSecondary: "分析我的 EEG",
    privacyLead: "你的 EEG 保持私密。",
    privacyBody: "你的文件仅在运行本次分析时上传。信号处理在 NeuroAccess 服务器上完成，原始 .edf 在分析结束的瞬间即被删除 —— 不会长期保存，不会共享。AI 层只会收到结构化结果，永远收不到原始记录。",
    tagline: "分析信号，而不是评判人。",
    flowSteps: ["EEG 文件", "信号处理", "特征提取", "结构化摘要", "AI 解释", "可读报告"],
    flowTitle: "NeuroAccess 如何工作",
    flowMore: "查看完整技术流程",
    samplesTitle: "示例 EEG",
    samplesSub: "选一个示例，几十秒内就能看到一份完整的 EEG 分析结果 —— 无需注册。",
    tryThis: "分析这个示例",
    analyzing: "分析中…",
    exploreTitle: "探索 EEG",
    exploreKnowledge: "EEG 知识",
    exploreKnowledgeDesc: "脑电基础、波形类型与频段含义",
    exploreSimulator: "EEG 模拟器",
    exploreSimulatorDesc: "调参数、造波形，理解各频段的作用",
    exploreCases: "病例库",
    exploreCasesDesc: "不同 EEG 模式的真实案例",
    sponsorTitle: "基础设施支持",
    sponsorBody: "本平台由河南博创信远科技有限公司赞助支持。",
    purpose: "用途",
    source: "数据来源",
    license: "许可",
    recording: "录制信息",
    lookFor: "适合观察",
    channelsUnit: "通道",
    freeBadge: "免费 · 开源 · 隐私优先",
    p1: [
      { name: "干净 EEG", purpose: "展示基本 EEG 数据结构、波形与频率信息", lookFor: "稳定的 α 节律、低噪声、高信号质量评分" },
      { name: "含噪 EEG", purpose: "展示噪声、伪迹与信号质量评估", lookFor: "眨眼/肌电/工频伪迹如何拉低质量评分" },
      { name: "频率示例", purpose: "展示各 EEG 频段的分析方式", lookFor: "δ/θ/α/β/γ 相对功率分布与真实 64 通道数据" },
    ],
  },
  en: {
    heroTitle: "Understand EEG without the complexity.",
    heroSub: "A free, open-source EEG literacy platform for exploring and understanding brainwave data.",
    ctaPrimary: "Try Sample EEG",
    ctaSecondary: "Analyze My EEG",
    privacyLead: "Your EEG stays private.",
    privacyBody: "Your file is uploaded only to run this analysis. Signal processing happens on the NeuroAccess server, and the original .edf is deleted the moment the analysis finishes — never stored long-term, never shared. The AI layer receives only the structured results, never the raw recording.",
    tagline: "Analyze signals, not people.",
    flowSteps: ["EEG File", "Signal Processing", "Feature Extraction", "Structured Summary", "AI Explanation", "Readable Report"],
    flowTitle: "How NeuroAccess Works",
    flowMore: "See the full pipeline",
    samplesTitle: "Sample EEG",
    samplesSub: "Pick a sample and see a complete EEG analysis in seconds — no account required.",
    tryThis: "Analyze this sample",
    analyzing: "Analyzing…",
    exploreTitle: "Explore EEG",
    exploreKnowledge: "EEG Knowledge",
    exploreKnowledgeDesc: "Fundamentals, waveform types, and what each band means",
    exploreSimulator: "EEG Simulator",
    exploreSimulatorDesc: "Tune parameters and generate signals to understand each band",
    exploreCases: "Case Studies",
    exploreCasesDesc: "Real examples of different EEG patterns",
    sponsorTitle: "Infrastructure support",
    sponsorBody: "This platform is sponsored by Henan Bochuang Xinyuan Technology Co., Ltd.",
    purpose: "Purpose",
    source: "Source",
    license: "License",
    recording: "Recording",
    lookFor: "What to look for",
    channelsUnit: "ch",
    freeBadge: "Free · Open source · Privacy first",
    p1: [
      { name: "Clean EEG", purpose: "Show basic EEG structure, waveform, and frequency information", lookFor: "A steady alpha rhythm, low noise, high signal-quality score" },
      { name: "Noisy EEG", purpose: "Show noise, artifacts, and signal-quality assessment", lookFor: "How eye-blink / muscle / power-line artifacts lower the quality score" },
      { name: "Frequency example", purpose: "Show how each EEG frequency band is analyzed", lookFor: "δ/θ/α/β/γ relative power on a real 64-channel recording" },
    ],
  },
  ja: {
    heroTitle: "EEG をもっとわかりやすく。",
    heroSub: "脳波データを探索・理解するための、無料・オープンソース・プライバシー優先の EEG リテラシープラットフォーム。",
    ctaPrimary: "サンプル EEG を試す",
    ctaSecondary: "自分の EEG を分析",
    privacyLead: "あなたの EEG は非公開のまま。",
    privacyBody: "ファイルはこの解析を実行するときのみアップロードされます。信号処理は NeuroAccess サーバー上で行われ、元の .edf は解析終了と同時に削除されます — 長期保存も共有も行いません。AI層が受け取るのは構造化された結果のみで、生の記録が渡されることはありません。",
    tagline: "分析するのは信号であり、人ではありません。",
    flowSteps: ["EEG ファイル", "信号処理", "特徴抽出", "構造化サマリー", "AI 解説", "読みやすいレポート"],
    flowTitle: "NeuroAccess の仕組み",
    flowMore: "処理の全工程を見る",
    samplesTitle: "サンプル EEG",
    samplesSub: "サンプルを選ぶと、数十秒で完全な EEG 分析結果を確認できます（登録不要）。",
    tryThis: "このサンプルを分析",
    analyzing: "分析中…",
    exploreTitle: "EEG を探索",
    exploreKnowledge: "EEG ナレッジ",
    exploreKnowledgeDesc: "基礎・波形の種類・各周波数帯の意味",
    exploreSimulator: "EEG シミュレーター",
    exploreSimulatorDesc: "パラメータを調整して波形を生成し、各帯域を理解",
    exploreCases: "ケーススタディ",
    exploreCasesDesc: "さまざまな EEG パターンの実例",
    sponsorTitle: "インフラ支援",
    sponsorBody: "本プラットフォームは河南博創信遠科技有限公司の賛助を受けています。",
    purpose: "用途",
    source: "データ出所",
    license: "ライセンス",
    recording: "記録情報",
    lookFor: "観察ポイント",
    channelsUnit: "ch",
    freeBadge: "無料 · オープンソース · プライバシー優先",
    p1: [
      { name: "クリーン EEG", purpose: "基本的な EEG 構造・波形・周波数情報を示す", lookFor: "安定した α 律動、低ノイズ、高い信号品質スコア" },
      { name: "ノイズ入り EEG", purpose: "ノイズ・アーチファクト・信号品質評価を示す", lookFor: "瞬目/筋電/電源由来のアーチファクトが品質スコアを下げる様子" },
      { name: "周波数の例", purpose: "各 EEG 周波数帯の分析方法を示す", lookFor: "実 64 チャンネル記録での δ/θ/α/β/γ 相対パワー" },
    ],
  },
  es: {
    heroTitle: "Entiende el EEG sin complicaciones.",
    heroSub: "Una plataforma gratuita, de código abierto y centrada en la privacidad para explorar y comprender datos de ondas cerebrales.",
    ctaPrimary: "Probar EEG de ejemplo",
    ctaSecondary: "Analizar mi EEG",
    privacyLead: "Tu EEG permanece privado.",
    privacyBody: "Su archivo se carga únicamente para ejecutar este análisis. El procesamiento de señal se realiza en el servidor de NeuroAccess y el .edf original se elimina en el momento en que finaliza el análisis: nunca se conserva a largo plazo ni se comparte. La capa de IA solo recibe los resultados estructurados, nunca la grabación en bruto.",
    tagline: "Analiza señales, no personas.",
    flowSteps: ["Archivo EEG", "Procesamiento de señal", "Extracción de características", "Resumen estructurado", "Explicación con IA", "Informe legible"],
    flowTitle: "Cómo funciona NeuroAccess",
    flowMore: "Ver el proceso completo",
    samplesTitle: "EEG de ejemplo",
    samplesSub: "Elige una muestra y verás un análisis EEG completo en segundos, sin crear cuenta.",
    tryThis: "Analizar esta muestra",
    analyzing: "Analizando…",
    exploreTitle: "Explorar EEG",
    exploreKnowledge: "Conocimientos de EEG",
    exploreKnowledgeDesc: "Fundamentos, tipos de onda y el significado de cada banda",
    exploreSimulator: "Simulador de EEG",
    exploreSimulatorDesc: "Ajusta parámetros y genera señales para entender cada banda",
    exploreCases: "Casos de estudio",
    exploreCasesDesc: "Ejemplos reales de distintos patrones EEG",
    sponsorTitle: "Apoyo de infraestructura",
    sponsorBody: "Esta plataforma está patrocinada por Henan Bochuang Xinyuan Technology Co., Ltd.",
    purpose: "Propósito",
    source: "Fuente",
    license: "Licencia",
    recording: "Grabación",
    lookFor: "Qué observar",
    channelsUnit: "canales",
    freeBadge: "Gratis · Código abierto · Privacidad primero",
    p1: [
      { name: "EEG limpio", purpose: "Mostrar la estructura básica del EEG, la forma de onda y la información de frecuencia", lookFor: "Un ritmo alfa estable, poco ruido y una puntuación de calidad alta" },
      { name: "EEG con ruido", purpose: "Mostrar ruido, artefactos y evaluación de la calidad de la señal", lookFor: "Cómo los artefactos de parpadeo/músculo/red reducen la puntuación de calidad" },
      { name: "Ejemplo de frecuencia", purpose: "Mostrar cómo se analiza cada banda de frecuencia del EEG", lookFor: "Potencia relativa δ/θ/α/β/γ en una grabación real de 64 canales" },
    ],
  },
  fr: {
    heroTitle: "Comprendre l'EEG sans complexité.",
    heroSub: "Une plateforme gratuite, open source et respectueuse de la vie privée pour explorer et comprendre les données d'ondes cérébrales.",
    ctaPrimary: "Essayer un EEG d'exemple",
    ctaSecondary: "Analyser mon EEG",
    privacyLead: "Votre EEG reste privé.",
    privacyBody: "Votre fichier n'est téléversé que pour exécuter cette analyse. Le traitement du signal s'effectue sur le serveur NeuroAccess et le fichier .edf d'origine est supprimé dès la fin de l'analyse — jamais conservé à long terme, jamais partagé. La couche IA ne reçoit que les résultats structurés, jamais l'enregistrement brut.",
    tagline: "Analyser des signaux, pas des personnes.",
    flowSteps: ["Fichier EEG", "Traitement du signal", "Extraction des caractéristiques", "Résumé structuré", "Explication par IA", "Rapport lisible"],
    flowTitle: "Comment fonctionne NeuroAccess",
    flowMore: "Voir le pipeline complet",
    samplesTitle: "EEG d'exemple",
    samplesSub: "Choisissez un exemple et obtenez une analyse EEG complète en quelques secondes, sans compte.",
    tryThis: "Analyser cet exemple",
    analyzing: "Analyse en cours…",
    exploreTitle: "Explorer l'EEG",
    exploreKnowledge: "Connaissances EEG",
    exploreKnowledgeDesc: "Fondamentaux, types d'ondes et signification de chaque bande",
    exploreSimulator: "Simulateur EEG",
    exploreSimulatorDesc: "Ajustez les paramètres et générez des signaux pour comprendre chaque bande",
    exploreCases: "Études de cas",
    exploreCasesDesc: "Exemples réels de différents motifs EEG",
    sponsorTitle: "Soutien d'infrastructure",
    sponsorBody: "Cette plateforme est sponsorisée par Henan Bochuang Xinyuan Technology Co., Ltd.",
    purpose: "Objectif",
    source: "Source",
    license: "Licence",
    recording: "Enregistrement",
    lookFor: "À observer",
    channelsUnit: "canaux",
    freeBadge: "Gratuit · Open source · Confidentialité",
    p1: [
      { name: "EEG propre", purpose: "Montrer la structure de base de l'EEG, la forme d'onde et les informations de fréquence", lookFor: "Un rythme alpha stable, peu de bruit, un score de qualité élevé" },
      { name: "EEG bruité", purpose: "Montrer le bruit, les artéfacts et l'évaluation de la qualité du signal", lookFor: "Comment les artéfacts oculaires/musculaires/secteur font baisser le score" },
      { name: "Exemple de fréquence", purpose: "Montrer comment chaque bande de fréquence EEG est analysée", lookFor: "Puissance relative δ/θ/α/β/γ sur un enregistrement réel 64 canaux" },
    ],
  },
  de: {
    heroTitle: "EEG verstehen — ohne Komplexität.",
    heroSub: "Eine kostenlose, quelloffene und datenschutzfreundliche Plattform zum Erkunden und Verstehen von Hirnwellendaten.",
    ctaPrimary: "Beispiel-EEG testen",
    ctaSecondary: "Mein EEG analysieren",
    privacyLead: "Ihr EEG bleibt privat.",
    privacyBody: "Ihre Datei wird nur hochgeladen, um diese Analyse auszuführen. Die Signalverarbeitung erfolgt auf dem NeuroAccess-Server, und die ursprüngliche .edf-Datei wird in dem Moment gelöscht, in dem die Analyse endet — niemals dauerhaft gespeichert, niemals weitergegeben. Die KI-Ebene erhält ausschließlich die strukturierten Ergebnisse, niemals die Rohaufzeichnung.",
    tagline: "Signale analysieren, nicht Menschen.",
    flowSteps: ["EEG-Datei", "Signalverarbeitung", "Merkmalsextraktion", "Strukturierte Zusammenfassung", "KI-Erklärung", "Lesbarer Bericht"],
    flowTitle: "So funktioniert NeuroAccess",
    flowMore: "Vollständige Pipeline ansehen",
    samplesTitle: "Beispiel-EEG",
    samplesSub: "Wählen Sie ein Beispiel und sehen Sie in Sekunden eine vollständige EEG-Analyse — ohne Konto.",
    tryThis: "Dieses Beispiel analysieren",
    analyzing: "Analyse läuft…",
    exploreTitle: "EEG erkunden",
    exploreKnowledge: "EEG-Wissen",
    exploreKnowledgeDesc: "Grundlagen, Wellenformen und die Bedeutung jeder Frequenzband",
    exploreSimulator: "EEG-Simulator",
    exploreSimulatorDesc: "Parameter einstellen und Signale erzeugen, um jedes Band zu verstehen",
    exploreCases: "Fallbeispiele",
    exploreCasesDesc: "Reale Beispiele unterschiedlicher EEG-Muster",
    sponsorTitle: "Infrastruktur-Unterstützung",
    sponsorBody: "Diese Plattform wird von der Henan Bochuang Xinyuan Technology Co., Ltd. gesponsert.",
    purpose: "Zweck",
    source: "Quelle",
    license: "Lizenz",
    recording: "Aufzeichnung",
    lookFor: "Worauf achten",
    channelsUnit: "Kanäle",
    freeBadge: "Kostenlos · Open Source · Datenschutz",
    p1: [
      { name: "Sauberes EEG", purpose: "Grundlegende EEG-Struktur, Wellenform und Frequenzinformationen zeigen", lookFor: "Stabiler Alpha-Rhythmus, wenig Rauschen, hoher Signalqualitätswert" },
      { name: "Verrauschtes EEG", purpose: "Rauschen, Artefakte und Signalqualitätsbewertung zeigen", lookFor: "Wie Augen-/Muskel-/Netzartefakte den Qualitätswert senken" },
      { name: "Frequenzbeispiel", purpose: "Zeigen, wie jedes EEG-Frequenzband analysiert wird", lookFor: "Relative δ/θ/α/β/γ-Leistung bei einer echten 64-Kanal-Aufzeichnung" },
    ],
  },
  ko: {
    heroTitle: "EEG를 어렵지 않게 이해하세요.",
    heroSub: "뇌파 데이터를 탐구하고 이해하기 위한 무료·오픈소스·프라이버시 우선 EEG 리터러시 플랫폼입니다.",
    ctaPrimary: "샘플 EEG 체험",
    ctaSecondary: "내 EEG 분석",
    privacyLead: "당신의 EEG는 비공개로 유지됩니다.",
    privacyBody: "파일은 이 분석을 실행할 때만 업로드됩니다. 신호 처리는 NeuroAccess 서버에서 이루어지며, 원본 .edf는 분석이 끝나는 순간 삭제됩니다 — 장기 보관하지 않고 공유하지도 않습니다. AI 계층은 구조화된 결과만 받으며 원본 기록은 전달되지 않습니다.",
    tagline: "분석하는 것은 신호이지 사람이 아닙니다.",
    flowSteps: ["EEG 파일", "신호 처리", "특징 추출", "구조화 요약", "AI 해설", "읽기 쉬운 보고서"],
    flowTitle: "NeuroAccess 작동 방식",
    flowMore: "전체 처리 과정 보기",
    samplesTitle: "샘플 EEG",
    samplesSub: "샘플을 선택하면 수십 초 안에 전체 EEG 분석 결과를 볼 수 있습니다. 가입은 필요 없습니다.",
    tryThis: "이 샘플 분석",
    analyzing: "분석 중…",
    exploreTitle: "EEG 둘러보기",
    exploreKnowledge: "EEG 지식",
    exploreKnowledgeDesc: "기초, 파형 유형, 각 주파수 대역의 의미",
    exploreSimulator: "EEG 시뮬레이터",
    exploreSimulatorDesc: "파라미터를 조정해 신호를 생성하며 각 대역 이해",
    exploreCases: "사례 모음",
    exploreCasesDesc: "다양한 EEG 패턴의 실제 사례",
    sponsorTitle: "인프라 지원",
    sponsorBody: "본 플랫폼은 허난보창신위안테크놀로지(河南博创信远科技有限公司)의 후원을 받습니다.",
    purpose: "목적",
    source: "출처",
    license: "라이선스",
    recording: "기록 정보",
    lookFor: "관찰 포인트",
    channelsUnit: "채널",
    freeBadge: "무료 · 오픈소스 · 프라이버시 우선",
    p1: [
      { name: "깨끗한 EEG", purpose: "기본 EEG 구조, 파형 및 주파수 정보 제시", lookFor: "안정적인 알파 리듬, 낮은 잡음, 높은 신호 품질 점수" },
      { name: "잡음 있는 EEG", purpose: "잡음, 아티팩트 및 신호 품질 평가 제시", lookFor: "눈깜빡임/근전도/전원 아티팩트가 품질 점수를 낮추는 양상" },
      { name: "주파수 예시", purpose: "각 EEG 주파수 대역의 분석 방식 제시", lookFor: "실제 64채널 기록의 δ/θ/α/β/γ 상대 파워" },
    ],
  },
};

const SAMPLE_ORDER: SampleId[] = ["clean", "noisy", "frequency"];

// 面向观察目标的本地化（p1 数组按 SAMPLE_ORDER 顺序对应）
function sampleText(s: Record<string, any>, idx: number): { name: string; purpose: string; lookFor: string } {
  const arr = s?.p1 as { name: string; purpose: string; lookFor: string }[] | undefined;
  return arr?.[idx] || { name: "", purpose: "", lookFor: "" };
}

export default function GuestLanding({
  onTrySample,
  busySample,
}: {
  onTrySample: (id: SampleId) => void;
  busySample?: string | null;
}) {
  const { lang } = useLang();
  const s = S[(lang as L)] || S.en;
  const [samples, setSamples] = useState<SampleMeta[]>([]);

  // 示例的技术性元数据（来源/许可/录制信息）由后端提供，前端不编造
  useEffect(() => {
    let alive = true;
    fetch("/api/samples")
      .then((r) => r.json())
      .then((d) => { if (alive && d?.success && Array.isArray(d.samples)) setSamples(d.samples); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // 流程步骤文案走 7 语言字典（此前硬编码英文，导致其它语言显示英文）
  const flowIcons = [UploadCloud, Cpu, Activity, Layers, Sparkles, FileText];
  const flow = ((s.flowSteps as string[]) || []).map((label, i) => ({
    icon: flowIcons[i] || Activity,
    key: label,
  }));

  return (
    <div className="space-y-8 sm:space-y-12">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="pt-2 text-center sm:pt-6">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
          <ShieldCheck className="h-3.5 w-3.5" />
          {s.freeBadge}
        </div>
        <h1 className="mx-auto max-w-3xl text-2xl font-bold leading-tight text-[var(--color-text)] sm:text-4xl">
          {s.heroTitle}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-secondary)] sm:text-base">
          {s.heroSub}
        </p>
        <p className="mx-auto mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-secondary)] sm:text-xs">
          {s.tagline}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => onTrySample("clean")}
            disabled={!!busySample}
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busySample ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {s.ctaPrimary}
          </button>
          <a
            href="#upload"
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-text-secondary)]"
          >
            <UploadCloud className="h-4 w-4" />
            {s.ctaSecondary}
          </a>
        </div>

        {/* 隐私说明（架构级，而非免责声明式恐吓） */}
        <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-sm font-semibold text-[var(--color-text)]">{s.privacyLead}</div>
              <p className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">{s.privacyBody}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-bold text-[var(--color-text)] sm:text-xl">{s.flowTitle}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          {flow.map((f, i) => (
            <div key={f.key} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-[var(--color-bg)] px-3 py-2">
                <f.icon className="h-4 w-4 text-[var(--color-text-secondary)]" />
                <span className="text-xs font-medium text-[var(--color-text)]">{f.key}</span>
              </div>
              {i < flow.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />}
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample EEG ──────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-[var(--color-text)] sm:text-xl">{s.samplesTitle}</h2>
        <p className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)] sm:text-sm">{s.samplesSub}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {SAMPLE_ORDER.map((id, idx) => {
            const meta = samples.find((x) => x.id === id);
            const local = sampleText(s, idx);
            return (
              <div key={id} className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="text-sm font-bold text-[var(--color-text)]">{local.name}</div>
                <div className="mt-2 text-xs leading-6 text-[var(--color-text-secondary)]">{local.purpose}</div>

                <dl className="mt-3 space-y-1.5 text-[11px] leading-5 text-[var(--color-text-secondary)]">
                  {meta?.source && (
                    <div><dt className="inline font-medium text-[var(--color-text)]">{s.source}: </dt><dd className="inline">{meta.source}</dd></div>
                  )}
                  {meta?.license && (
                    <div><dt className="inline font-medium text-[var(--color-text)]">{s.license}: </dt><dd className="inline">{meta.license}</dd></div>
                  )}
                  {(meta?.recording || meta?.channels) && (
                    <div>
                      <dt className="inline font-medium text-[var(--color-text)]">{s.recording}: </dt>
                      <dd className="inline">
                        {meta.recording || `${meta.channels} ${s.channelsUnit} · ${meta.sampling_rate} Hz · ${meta.duration_sec}s`}
                      </dd>
                    </div>
                  )}
                  <div><dt className="inline font-medium text-[var(--color-text)]">{s.lookFor}: </dt><dd className="inline">{local.lookFor}</dd></div>
                </dl>

                <button
                  onClick={() => onTrySample(id)}
                  disabled={!!busySample || meta?.available === false}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-text-secondary)] disabled:opacity-50"
                >
                  {busySample === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                  {busySample === id ? s.analyzing : s.tryThis}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Explore ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-[var(--color-text)] sm:text-xl">{s.exploreTitle}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            { href: "/guide", icon: BookOpen, title: s.exploreKnowledge, desc: s.exploreKnowledgeDesc },
            { href: "/eeg-simulator", icon: Activity, title: s.exploreSimulator, desc: s.exploreSimulatorDesc },
            { href: "/cases", icon: Stethoscope, title: s.exploreCases, desc: s.exploreCasesDesc },
          ].map((c) => (
            <Link key={c.href} href={c.href}
              className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-colors hover:border-[var(--color-text-secondary)]">
              <c.icon className="h-5 w-5 text-[var(--color-text-secondary)]" />
              <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[var(--color-text)]">
                {c.title}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">{c.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 赞助（克制，不抢主体）────────────────── */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-[11px] leading-6 text-[var(--color-text-secondary)]">
          <span className="font-medium text-[var(--color-text)]">{s.sponsorTitle}: </span>
          {s.sponsorBody}
        </p>
      </section>
    </div>
  );
}
