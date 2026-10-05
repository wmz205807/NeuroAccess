"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Stethoscope,
  Brain,
  Activity,
  Eye,
  ChevronDown,
  ChevronUp,
  User,
  GraduationCap,
  Microscope,
  Search,
  Filter,
  ArrowUpDown,
  Database,
} from "lucide-react";
import { useLang } from "@/lib/language-context";
import type { Lang } from "@/lib/translations";
import AnalyzeCasePanel from "@/components/AnalyzeCasePanel";


/* 案例数据类型（多语言） */
type LangString = Partial<Record<Lang, string>>;
type LangStringArray = Partial<Record<Lang, string[]>>;

interface CaseStudy {
  id: string;
  categoryKey: string;
  difficultyKey: "beginner" | "intermediate" | "advanced";
  signal_quality: number;
  learning_readability_score: number;
  tags: string[];
  readTime: string;
  // 多语言字段
  title: LangString;
  description: LangString;
  details: LangString;
  beginner_explanation: LangString;
  student_explanation: LangString;
  research_explanation: LangString;
  limitations: LangStringArray;
  what_this_data_cannot_tell: LangStringArray;
  /** 来源说明（教学示意 / 模拟 / 真实公开数据集） */
  source?: LangString;
  /**
   * 数据类型：simulated（教学模拟）/ real（真实记录）/ public（公开数据集）/ unknown（未核实）。
   * 缺省按 "unknown" 保守渲染，不猜测。
   *
   * 现状：本案例库的每个案例都绑定一段真实公开数据集的 EEG 片段，
   *   并逐条给出 dataset / citation / recordingType；dataKind 为 "real"，
   *   sourceType 为 "public"。新增案例时请同样提供可核实的来源，禁止编造。
   */
  dataKind?: DataKind;
  /**
   * 来源类型：reference（教育参考，本案例库现状）/ literature（有明确文献依据）/ 
   *          simulated（附带模拟记录）/ public（绑定公开数据集）/ unknown（未核实）。
   * 缺省按 reference 渲染——不猜测、不编造来源。
   *
   * 现状：全部案例均为 "public" —— 片段来自 CHB-MIT（PhysioNet，ODC-By 1.0）
   *   或 OpenNeuro ds004504（CC0），案例页附带对应片段文件，可直接分析。
   *   新增案例若来源无法核实，请按 "unknown" 保守渲染，不要猜测。
   */
  sourceType?: SourceType;
  /** 数据集名称（英文专名，通常不翻译）；缺省时界面显示 "Source information currently unavailable." */
  dataset?: LangString;
  /** 文献引用（作者 / 年份 / 期刊或 DOI）；缺省时界面显示 "Source information currently unavailable." */
  citation?: LangString;
  /** 记录类型描述 */
  recordingType?: LangString;
  /** 数据集内的记录号（如 chb01_03 / sub-001）；列表态与详情都用它锚定到具体片段 */
  recordRef?: string;
  /** 数据集许可（英文专名，不翻译）；ODC-By 等许可要求署名，必须展示 */
  license?: string;
}

/**
 * 数据类型，用于「Data Status」一行：
 *   illustrative —— 只有文字示意、不附带任何 EEG 记录文件（本案例库已不使用）；
 *   simulated —— 附带模拟生成的 EEG 记录；real —— 真实记录；public —— 公开数据集；unknown —— 未核实。
 */
type DataKind = "illustrative" | "simulated" | "real" | "public" | "unknown";

/** 来源类型（Source Type 一行） */
type SourceType = "reference" | "literature" | "simulated" | "public" | "unknown";

/* ────────────────────────────────────────────────────────────────────────────
 * 「数据来源与真实性」统一文案（自包含七语言，避免污染共享 translations.ts）
 * 事实基准：本案例库为真实公开数据集的 EEG 片段（CHB-MIT / OpenNeuro ds004504），
 *           用于练习 EEG 波形与模式的识别；
 *           NeuroAccess 展示 EEG 特征，不据用户上传的 EEG 判断其患有何种疾病。
 * ──────────────────────────────────────────────────────────────────────────── */
type SrcL = "zh" | "en" | "es" | "fr" | "de" | "ja" | "ko";

const SRC_L: Record<SrcL, {
  heading: string;
  labelSource: string;
  labelDataset: string;
  labelCitation: string;
  labelLicense: string;
  labelRecordingType: string;
  labelDataKind: string;
  kindSimulated: string;
  kindReal: string;
  kindPublic: string;
  kindUnknown: string;
  simulated: string;
  unavailable: string;
  pending: string;
  limitationsTitle: string;
  cannotTellTitle: string;
  labelSourceType: string;
  labelDataStatus: string;
  stReference: string;
  stLiterature: string;
  stSimulated: string;
  stPublic: string;
  stUnknown: string;
  dsIllustrative: string;
  dsSimulated: string;
  dsReal: string;
  dsPublic: string;
  dsUnknown: string;
  rtIllustrative: string;
}> = {
  zh: {
    heading: "数据来源与真实性",
    labelSource: "来源",
    labelDataset: "数据集",
    labelCitation: "文献引用",
    labelLicense: "许可",
    labelRecordingType: "记录类型",
    labelDataKind: "数据类型",
    kindSimulated: "模拟数据（教育演示）",
    kindReal: "真实记录",
    kindPublic: "公开数据集",
    kindUnknown: "未核实",
    simulated: "模拟 EEG，用于教育演示。",
    unavailable: "来源信息暂不可用。",
    pending: "来源核实中。",
    limitationsTitle: "本案例的局限",
    cannotTellTitle: "这份数据不能告诉你什么",
    labelSourceType: "来源类型",
    labelDataStatus: "数据状态",
    stReference: "教育参考（无可核实的具体来源）",
    stLiterature: "基于文献整理的教学示例",
    stSimulated: "模拟 EEG",
    stPublic: "公开 EEG 数据集",
    stUnknown: "未核实",
    dsIllustrative: "教育参考（示意内容）",
    dsSimulated: "教育演示用模拟数据",
    dsReal: "真实记录",
    dsPublic: "公开数据集",
    dsUnknown: "未核实",
    rtIllustrative: "文字示意——本案例不附带 EEG 记录文件。",
  },
  en: {
    heading: "Data source & authenticity",
    labelSource: "Source",
    labelDataset: "Dataset",
    labelCitation: "Citation",
    labelLicense: "License",
    labelRecordingType: "Recording type",
    labelDataKind: "Data type",
    kindSimulated: "Simulated (educational)",
    kindReal: "Real recording",
    kindPublic: "Public dataset",
    kindUnknown: "Unverified",
    simulated: "Simulated EEG for educational demonstration.",
    unavailable: "Source information currently unavailable.",
    pending: "Source verification pending.",
    limitationsTitle: "Limitations of this case",
    cannotTellTitle: "What this data cannot tell you",
    labelSourceType: "Source Type",
    labelDataStatus: "Data Status",
    stReference: "Educational reference (no verifiable source)",
    stLiterature: "Literature-based educational example",
    stSimulated: "Simulated EEG",
    stPublic: "Public EEG Dataset",
    stUnknown: "Unverified",
    dsIllustrative: "Educational reference",
    dsSimulated: "Simulated for educational demonstration",
    dsReal: "Real recording",
    dsPublic: "Public dataset",
    dsUnknown: "Unverified",
    rtIllustrative: "Illustrative description — no EEG recording file is bundled with this case.",
  },
  es: {
    heading: "Origen y autenticidad de los datos",
    labelSource: "Fuente",
    labelDataset: "Conjunto de datos",
    labelCitation: "Cita",
    labelLicense: "Licencia",
    labelRecordingType: "Tipo de registro",
    labelDataKind: "Tipo de datos",
    kindSimulated: "Simulado (educativo)",
    kindReal: "Registro real",
    kindPublic: "Conjunto de datos público",
    kindUnknown: "Sin verificar",
    simulated: "EEG simulado con fines de demostración educativa.",
    unavailable: "Información de origen no disponible actualmente.",
    pending: "Verificación de la fuente pendiente.",
    limitationsTitle: "Limitaciones de este caso",
    cannotTellTitle: "Lo que estos datos no pueden decirte",
    labelSourceType: "Tipo de fuente",
    labelDataStatus: "Estado de los datos",
    stReference: "Referencia educativa (sin fuente verificable)",
    stLiterature: "Ejemplo educativo basado en literatura",
    stSimulated: "EEG simulado",
    stPublic: "Conjunto de datos EEG público",
    stUnknown: "Sin verificar",
    dsIllustrative: "Referencia educativa",
    dsSimulated: "Simulado con fines de demostración educativa",
    dsReal: "Registro real",
    dsPublic: "Conjunto de datos público",
    dsUnknown: "Sin verificar",
    rtIllustrative: "Descripción ilustrativa: este caso no incluye ningún archivo de registro EEG.",
  },
  fr: {
    heading: "Origine et authenticité des données",
    labelSource: "Source",
    labelDataset: "Jeu de données",
    labelCitation: "Citation",
    labelLicense: "Licence",
    labelRecordingType: "Type d'enregistrement",
    labelDataKind: "Type de données",
    kindSimulated: "Simulé (éducatif)",
    kindReal: "Enregistrement réel",
    kindPublic: "Jeu de données public",
    kindUnknown: "Non vérifié",
    simulated: "EEG simulé à des fins de démonstration éducative.",
    unavailable: "Informations sur la source actuellement indisponibles.",
    pending: "Vérification de la source en attente.",
    limitationsTitle: "Limites de ce cas",
    cannotTellTitle: "Ce que ces données ne peuvent pas vous dire",
    labelSourceType: "Type de source",
    labelDataStatus: "Statut des données",
    stReference: "Référence éducative (aucune source vérifiable)",
    stLiterature: "Exemple éducatif issu de la littérature",
    stSimulated: "EEG simulé",
    stPublic: "Jeu de données EEG public",
    stUnknown: "Non vérifié",
    dsIllustrative: "Référence éducative",
    dsSimulated: "Simulé à des fins de démonstration éducative",
    dsReal: "Enregistrement réel",
    dsPublic: "Jeu de données public",
    dsUnknown: "Non vérifié",
    rtIllustrative: "Description illustrative — ce cas n'inclut aucun fichier d'enregistrement EEG.",
  },
  de: {
    heading: "Datenquelle & Authentizität",
    labelSource: "Quelle",
    labelDataset: "Datensatz",
    labelCitation: "Zitat",
    labelLicense: "Lizenz",
    labelRecordingType: "Aufzeichnungstyp",
    labelDataKind: "Datentyp",
    kindSimulated: "Simuliert (edukativ)",
    kindReal: "Echte Aufzeichnung",
    kindPublic: "Öffentlicher Datensatz",
    kindUnknown: "Nicht verifiziert",
    simulated: "Simuliertes EEG zu didaktischen Demonstrationszwecken.",
    unavailable: "Quellenangabe derzeit nicht verfügbar.",
    pending: "Quellenprüfung ausstehend.",
    limitationsTitle: "Grenzen dieses Falls",
    cannotTellTitle: "Was diese Daten nicht aussagen können",
    labelSourceType: "Quellentyp",
    labelDataStatus: "Datenstatus",
    stReference: "Didaktische Referenz (keine überprüfbare Quelle)",
    stLiterature: "Literaturbasiertes didaktisches Beispiel",
    stSimulated: "Simuliertes EEG",
    stPublic: "Öffentlicher EEG-Datensatz",
    stUnknown: "Nicht verifiziert",
    dsIllustrative: "Didaktische Referenz",
    dsSimulated: "Simuliert zu didaktischen Demonstrationszwecken",
    dsReal: "Echte Aufzeichnung",
    dsPublic: "Öffentlicher Datensatz",
    dsUnknown: "Nicht verifiziert",
    rtIllustrative: "Illustrative Beschreibung – diesem Fall liegt keine EEG-Aufzeichnungsdatei bei.",
  },
  ja: {
    heading: "データの出典と真正性",
    labelSource: "出典",
    labelDataset: "データセット",
    labelCitation: "引用",
    labelLicense: "ライセンス",
    labelRecordingType: "記録タイプ",
    labelDataKind: "データ種別",
    kindSimulated: "シミュレーション（教育用）",
    kindReal: "実記録",
    kindPublic: "公開データセット",
    kindUnknown: "未検証",
    simulated: "教育デモンストレーション用のシミュレーションEEGです。",
    unavailable: "出典情報は現在利用できません。",
    pending: "出典を確認中です。",
    limitationsTitle: "このケースの限界",
    cannotTellTitle: "このデータから分からないこと",
    labelSourceType: "出典タイプ",
    labelDataStatus: "データ状態",
    stReference: "教育用リファレンス（検証可能な出典なし）",
    stLiterature: "文献に基づく教育用例",
    stSimulated: "シミュレーションEEG",
    stPublic: "公開EEGデータセット",
    stUnknown: "未検証",
    dsIllustrative: "教育用リファレンス",
    dsSimulated: "教育デモンストレーション用のシミュレーションデータ",
    dsReal: "実記録",
    dsPublic: "公開データセット",
    dsUnknown: "未検証",
    rtIllustrative: "文章による例示——このケースにEEG記録ファイルは添付されていません。",
  },
  ko: {
    heading: "데이터 출처 및 진위",
    labelSource: "출처",
    labelDataset: "데이터셋",
    labelCitation: "인용",
    labelLicense: "라이선스",
    labelRecordingType: "기록 유형",
    labelDataKind: "데이터 유형",
    kindSimulated: "시뮬레이션(교육용)",
    kindReal: "실제 기록",
    kindPublic: "공개 데이터셋",
    kindUnknown: "미검증",
    simulated: "교육 시연용 시뮬레이션 EEG입니다.",
    unavailable: "출처 정보를 현재 사용할 수 없습니다.",
    pending: "출처 확인 중입니다.",
    limitationsTitle: "이 사례의 한계",
    cannotTellTitle: "이 데이터가 알려주지 못하는 것",
    labelSourceType: "출처 유형",
    labelDataStatus: "데이터 상태",
    stReference: "교육용 참고(검증 가능한 출처 없음)",
    stLiterature: "문헌 기반 교육용 예시",
    stSimulated: "시뮬레이션 EEG",
    stPublic: "공개 EEG 데이터셋",
    stUnknown: "미검증",
    dsIllustrative: "교육용 참고",
    dsSimulated: "교육 시연용 시뮬레이션 데이터",
    dsReal: "실제 기록",
    dsPublic: "공개 데이터셋",
    dsUnknown: "미검증",
    rtIllustrative: "설명용 예시——이 사례에는 EEG 기록 파일이 포함되어 있지 않습니다.",
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * 案例库：全部基于真实公开 EEG 数据集
 * ----------------------------------------------------------------------------
 * 每个案例都对应一段真实患者/被试的 EEG 记录，来源可逐条核实：
 *   · CHB-MIT Scalp EEG Database v1.0.0（PhysioNet，ODC-By 1.0）
 *     —— 局灶性癫痫患者的连续头皮 EEG，发作时间由数据集官方标注
 *   · OpenNeuro ds004504（CC0）
 *     —— 阿尔茨海默病 / 额颞叶痴呆 / 健康对照的闭眼静息态 EEG
 *
 * 每个片段只做了「时间窗裁剪 + 标准 EDF 重写」，未滤波、未合成、未改动信号内容。
 * 页面上展示的信号质量与频段功率，是用 NeuroAccess 自身的分析流程在该片段上
 * 实测得到的数值（不是估计值，也不是教科书上的示例值）。
 *
 * 边界：这里描述的是信号特征，不是诊断。EEG 特征不能单独用于诊断任何疾病，
 *      也不能用来推断任何一个具体的人的健康状况。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 生成「来源」说明（七语言模板；dataset 为英文专名，不翻译） */
const mkSource = (dataset: string, record: string): LangString => ({
  zh: `真实记录：本案例使用的 EEG 片段来自公开数据集 ${dataset}（记录 ${record}），按该数据集的开放许可使用。片段只做了时间窗裁剪与标准 EDF 重写，未改动信号内容。`,
  en: `Real recording: the EEG segment used in this case comes from the public dataset ${dataset} (record ${record}), used under that dataset's open license. The segment was only time-windowed and re-written in standard EDF; the signal itself was not modified.`,
  es: `Registro real: el segmento de EEG usado en este caso proviene del conjunto de datos público ${dataset} (registro ${record}), utilizado bajo su licencia abierta. El segmento solo se recortó en el tiempo y se reescribió en EDF estándar; la señal no se modificó.`,
  fr: `Enregistrement réel : le segment EEG utilisé dans ce cas provient du jeu de données public ${dataset} (enregistrement ${record}), utilisé sous sa licence ouverte. Le segment a seulement été découpé dans le temps et réécrit au format EDF standard ; le signal n'a pas été modifié.`,
  de: `Echte Aufzeichnung: Das in diesem Fall verwendete EEG-Segment stammt aus dem öffentlichen Datensatz ${dataset} (Aufzeichnung ${record}) und wird unter dessen offener Lizenz verwendet. Das Segment wurde nur zeitlich zugeschnitten und im Standard-EDF neu geschrieben; das Signal selbst wurde nicht verändert.`,
  ja: `実際の記録：このケースで使用したEEGセグメントは公開データセット ${dataset}（記録 ${record}）からのもので、当該データセットのオープンライセンスに基づき使用しています。セグメントは時間窓で切り出し、標準EDFに書き直しただけであり、信号自体は改変していません。`,
  ko: `실제 기록: 이 사례에 사용된 EEG 세그먼트는 공개 데이터셋 ${dataset}(기록 ${record})에서 가져왔으며, 해당 데이터셋의 오픈 라이선스에 따라 사용합니다. 세그먼트는 시간 창으로 잘라 표준 EDF로 다시 쓴 것일 뿐, 신호 자체는 변경하지 않았습니다.`,
});

/** 生成「记录类型」说明（七语言模板） */
const mkRec = (
  ch: number, hz: number, sec: number, montageZh: string, montageEn: string,
): LangString => ({
  zh: `真实记录：${ch} 通道 · ${hz} Hz · ${sec} 秒 · ${montageZh}。本案例附带该片段文件，可直接分析。`,
  en: `Real recording: ${ch} channels · ${hz} Hz · ${sec} s · ${montageEn}. The segment file is bundled with this case and can be analysed directly.`,
  es: `Registro real: ${ch} canales · ${hz} Hz · ${sec} s · ${montageEn}. El archivo del segmento se incluye con este caso y puede analizarse directamente.`,
  fr: `Enregistrement réel : ${ch} canaux · ${hz} Hz · ${sec} s · ${montageEn}. Le fichier du segment accompagne ce cas et peut être analysé directement.`,
  de: `Echte Aufzeichnung: ${ch} Kanäle · ${hz} Hz · ${sec} s · ${montageEn}. Die Segmentdatei liegt diesem Fall bei und kann direkt analysiert werden.`,
  ja: `実際の記録：${ch}チャンネル · ${hz} Hz · ${sec}秒 · ${montageEn}。このセグメントファイルは本ケースに添付されており、直接分析できます。`,
  ko: `실제 기록: ${ch}채널 · ${hz} Hz · ${sec}초 · ${montageEn}. 이 세그먼트 파일은 본 사례에 포함되어 있으며 직접 분석할 수 있습니다.`,
});

const CHB_DATASET = "CHB-MIT Scalp EEG Database v1.0.0 (PhysioNet)";
const DS_DATASET = "OpenNeuro ds004504 (Alzheimer's disease, FTD and healthy subjects)";
const CHB_CITE = "Guttag, J. (2010). CHB-MIT Scalp EEG Database (version 1.0.0). PhysioNet. doi:10.13026/C2K01R";
const DS_CITE = "Miltiadous, A. et al. (2023). Data, 8(6), 95. doi:10.3390/data8060095 (dataset doi:10.18112/openneuro.ds004504.v1.0.9)";
const CHB_LIC = "Open Data Commons Attribution License v1.0 (ODC-By 1.0)";
const DS_LIC = "CC0 1.0 (public domain dedication)";
const CHB_MONTAGE_ZH = "双极导联，国际 10-20 系统";
const CHB_MONTAGE_EN = "bipolar montage, international 10-20 system";
const DS_MONTAGE_ZH = "单极导联，国际 10-20 系统，闭眼静息态";
const DS_MONTAGE_EN = "referential montage, international 10-20 system, eyes-closed resting state";

const cases: CaseStudy[] = [
  {
    id: "c1",
    title: {
      zh: "癫痫发作期 EEG（真实患者 · 病例 1）",
      en: "Seizure EEG, Ictal (Real Patient · Case 1)",
    },
    categoryKey: "patterns",
    difficultyKey: "advanced",
    description: {
      zh: "真实患者记录：11 岁女性局灶性癫痫患者（CHB-MIT 数据集 chb01 病例）连续监测中的 55 秒片段，覆盖数据集官方标注的一次癫痫发作（起始 2996 秒、结束 3036 秒，持续 40 秒）。发作段以高幅慢活动为主导。",
      en: "A real patient recording: a 55-second segment from continuous monitoring of an 11-year-old female with focal epilepsy (case chb01 in the CHB-MIT database). It spans a seizure annotated by the dataset itself (onset 2996 s, offset 3036 s — 40 seconds). High-amplitude slow activity dominates during the seizure.",
    },
    details: {
      zh: "1. 片段共 55 秒，发作从第 10 秒开始、持续约 40 秒\n2. 实测频段相对功率：δ 59.3%、θ 25.9%、α 13.0%、β 1.9% —— 慢波（δ+θ）合计约 85%\n3. 与同一患者的发作间期记录（本页病例 4）对比：β 由 7.4% 降至 1.9%，快波被明显抑制\n4. 信号质量评分 83.6 / 100\n\n以上数值均由 NeuroAccess 的分析流程在该片段上实测得到。",
      en: "1. The segment is 55 s; the seizure starts at ~10 s and lasts about 40 s\n2. Measured relative band power: δ 59.3%, θ 25.9%, α 13.0%, β 1.9% — slow activity (δ+θ) totals ~85%\n3. Compared with the same patient's interictal record (case 4 on this page): β falls from 7.4% to 1.9%, i.e. fast activity is clearly suppressed\n4. Signal quality score 83.6 / 100\n\nAll figures were measured on this segment by NeuroAccess's own analysis pipeline.",
    },
    signal_quality: 83.59,
    learning_readability_score: 88.6,
    beginner_explanation: {
      zh: "这段脑电来自一位真实的癫痫患者，记录的正是发作期间的大脑电活动。你会看到波形整体变得又慢又大（慢波占优势），而平时存在的快速小波动几乎消失。需要特别强调：脑电只能反映电活动特征，不能单独诊断癫痫，也不能据此判断某个人是否患病。",
      en: "This EEG comes from a real patient and captures brain activity during a seizure. The waveform becomes slow and large (slow activity dominates), while the small fast ripples normally present almost disappear. Important: EEG reflects electrical features only — it cannot diagnose epilepsy on its own, and it says nothing about whether any particular person has a condition.",
    },
    student_explanation: {
      zh: "发作期频谱以 δ/θ 慢活动为绝对主导（合计约 85%），β 快波降至 2% 以下，符合「发作期背景节律被广泛抑制、代之以高幅慢活动」的描述。与同一病例的发作间期片段对比，可见清晰的高频抑制模式 —— 这是本案例库中最容易定量展示的一对对照。",
      en: "The ictal spectrum is dominated by δ/θ slow activity (~85% combined), with β falling below 2%, consistent with widespread suppression of background rhythms during a seizure and their replacement by high-amplitude slow activity. Compared with the same patient's interictal segment, a clear high-frequency suppression pattern emerges — the most easily quantified contrast in this case library.",
    },
    research_explanation: {
      zh: "片段取自 CHB-MIT chb01 病例（局灶性癫痫，11 岁女性），发作时间采用数据集官方标注（2996–3036 s）。该 55 s 窗内相对频段功率为 δ 59.3 / θ 25.9 / α 13.0 / β 1.9（%），主频 1.67 Hz。记录为 23 通道双极导联（10-20 系统）、256 Hz。局限：无视频-EEG 同步，单次记录不能确定发作起源区，也不能替代完整的临床电生理评估。",
      en: "The segment comes from CHB-MIT case chb01 (focal epilepsy, 11-year-old female); seizure timing follows the dataset's own annotation (2996–3036 s). Over this 55 s window the relative band power is δ 59.3 / θ 25.9 / α 13.0 / β 1.9 (%), with a dominant frequency of 1.67 Hz. The recording is 23-channel bipolar montage (10-20 system) at 256 Hz. Limitations: no video-EEG correlation; a single recording cannot localise the seizure onset zone and does not replace a full clinical electrophysiological assessment.",
    },
    limitations: {
      zh: ["片段只有 55 秒，不能代表该患者整体的脑电特征", "单次记录无法确定发作起源区（需视频-EEG 同步与完整临床资料）", "本案例不提供任何诊断信息，也不代表其他癫痫患者的表现"],
      en: ["A 55-second segment cannot represent this patient's overall EEG characteristics", "A single recording cannot localise the seizure onset zone (video-EEG and full clinical data are required)", "This case provides no diagnostic information and does not represent other patients with epilepsy"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人是否真的患有癫痫（需临床诊断）", "发作从大脑的哪个区域开始", "任何与本例相似的人的健康状况"],
      en: ["Whether this person truly has epilepsy (clinical diagnosis required)", "Which brain region the seizure arises from", "The health status of anyone who resembles this case"],
    },
    recordRef: "chb01_03",
    source: mkSource(CHB_DATASET, "chb01_03"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: CHB_DATASET, en: CHB_DATASET },
    citation: { zh: CHB_CITE, en: CHB_CITE },
    license: CHB_LIC,
    recordingType: mkRec(23, 256, 55, CHB_MONTAGE_ZH, CHB_MONTAGE_EN),
    tags: ["seizure", "epilepsy", "ictal", "chb-mit", "real-data"],
    readTime: "6 分钟",
  },
  {
    id: "c2",
    title: {
      zh: "癫痫发作期 EEG（真实患者 · 病例 2）",
      en: "Seizure EEG, Ictal (Real Patient · Case 2)",
    },
    categoryKey: "patterns",
    difficultyKey: "advanced",
    description: {
      zh: "同一患者（CHB-MIT chb01 病例）另一次发作的 42 秒片段，覆盖数据集标注的发作区间（起始 1467 秒、结束 1494 秒，持续 27 秒）。这一次慢波占比比病例 1 更高。",
      en: "A 42-second segment covering another seizure in the same patient (CHB-MIT case chb01), spanning the dataset-annotated interval (onset 1467 s, offset 1494 s — 27 seconds). Here slow activity accounts for an even larger share than in case 1.",
    },
    details: {
      zh: "1. 片段共 42 秒，发作从第 10 秒开始、持续约 27 秒\n2. 实测频段相对功率：δ 85.6%、θ 12.0%、α 1.9%、β 0.4%\n3. 与病例 1 相比，本次发作的 α 与 β 成分进一步下降（α 12.9% → 1.9%）\n4. 信号质量评分 80.9 / 100\n\n同一位患者两次发作的频谱并不相同 —— 这一点本身就是真实数据的特征：发作的电生理表现会随发作而变化。",
      en: "1. The segment is 42 s; the seizure starts at ~10 s and lasts about 27 s\n2. Measured relative band power: δ 85.6%, θ 12.0%, α 1.9%, β 0.4%\n3. Compared with case 1, both α and β are further reduced (α 12.9% → 1.9%)\n4. Signal quality score 80.9 / 100\n\nThe two seizures in the same patient do not have identical spectra — that variability is itself a feature of real data: the electrophysiological expression of a seizure varies from event to event.",
    },
    signal_quality: 80.87,
    learning_readability_score: 85.4,
    beginner_explanation: {
      zh: "这是同一个患者的另一次发作。波形同样以慢而大的活动为主，而且比第一次更「慢」——几乎看不到快速波动。把两段放在一起看，你会发现：即使是同一个人，每次发作的脑电也不完全一样。",
      en: "This is another seizure in the same patient. The waveform is again dominated by slow, large activity — and it is even slower than the first one, with almost no fast ripples visible. Looking at both together shows that even within one person, each seizure looks somewhat different.",
    },
    student_explanation: {
      zh: "本段 δ 占比达 85.6%，α/β 合计不足 2.5%，属于发作期慢波化的极端表现。与病例 1（δ 59.2%）对照可以直观看到：同为发作期，频谱构成差异可以很大。这提示在自动化发作检测中，单靠某个固定频段阈值并不稳健。",
      en: "δ accounts for 85.6% here, with α+β below 2.5% — an extreme degree of ictal slowing. Contrasting with case 1 (δ 59.2%) shows that spectral composition during seizures can vary widely, which is a caution for automated seizure detection that relies on fixed band thresholds.",
    },
    research_explanation: {
      zh: "同患者（chb01）第二次发作片段，官方标注 1467–1494 s。实测相对频段功率 δ 85.6 / θ 12.0 / α 1.9 / β 0.4（%）。与 chb01_03 相比慢波占比由 85% 升至 97.6%（δ+θ），提示发作不同阶段的频谱演化可能差别明显。局限同病例 1：单通道组、无同步视频、无发作起源定位信息。",
      en: "Second seizure segment from the same patient (chb01), annotated at 1467–1494 s. Measured relative band power: δ 85.6 / θ 12.0 / α 1.9 / β 0.4 (%). Versus chb01_03, slow activity rises from ~85% to 97.6% (δ+θ), suggesting marked spectral evolution across seizures. Same limitations as case 1: single montage, no synchronised video, no onset-localisation information.",
    },
    limitations: {
      zh: ["42 秒片段不足以刻画完整的发作演变过程", "无法判断这次发作与病例 1 的发作在临床上是否属于同一类型", "本案例不提供任何诊断信息"],
      en: ["A 42-second segment is too short to capture the full evolution of the seizure", "Cannot determine whether this and case 1 are clinically the same seizure type", "This case provides no diagnostic information"],
    },
    what_this_data_cannot_tell: {
      zh: ["发作的类型与起源部位", "发作的诱发因素", "这个人当前的临床状况"],
      en: ["The seizure type or its site of origin", "What triggered the seizure", "This person's current clinical status"],
    },
    recordRef: "chb01_04",
    source: mkSource(CHB_DATASET, "chb01_04"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: CHB_DATASET, en: CHB_DATASET },
    citation: { zh: CHB_CITE, en: CHB_CITE },
    license: CHB_LIC,
    recordingType: mkRec(23, 256, 42, CHB_MONTAGE_ZH, CHB_MONTAGE_EN),
    tags: ["seizure", "epilepsy", "ictal", "chb-mit", "real-data"],
    readTime: "5 分钟",
  },
  {
    id: "c3",
    title: {
      zh: "癫痫发作期 EEG（真实患者 · 病例 3）",
      en: "Seizure EEG, Ictal (Real Patient · Case 3)",
    },
    categoryKey: "patterns",
    difficultyKey: "advanced",
    description: {
      zh: "同一患者的第三次发作片段（CHB-MIT chb01 病例，官方标注起始 1732 秒、结束 1772 秒，持续 40 秒）。在本次记录中，δ+θ 慢活动合计占 98.2%，是三个发作片段中最「慢」的一段。",
      en: "A third seizure segment from the same patient (CHB-MIT case chb01, dataset-annotated onset 1732 s, offset 1772 s — 40 seconds). In this record δ+θ slow activity accounts for 98.2% combined — the slowest of the three seizure segments.",
    },
    details: {
      zh: "1. 片段共 55 秒，发作从第 10 秒开始、持续约 40 秒\n2. 实测频段相对功率：δ 86.8%、θ 11.4%、α 1.6%、β 0.3%\n3. δ+θ 合计 98.2%，是三个发作片段中最「慢」的一段\n4. 信号质量评分 81.7 / 100\n\n三个发作片段（病例 1–3）来自同一位患者，可以放在一起观察发作间频谱差异。",
      en: "1. The segment is 55 s; the seizure starts at ~10 s and lasts about 40 s\n2. Measured relative band power: δ 86.8%, θ 11.4%, α 1.6%, β 0.3%\n3. δ+θ total 98.2% — the slowest of the three seizure segments\n4. Signal quality score 81.7 / 100\n\nThe three seizure segments (cases 1–3) come from the same patient and can be compared side by side for inter-seizure spectral variation.",
    },
    signal_quality: 81.69,
    learning_readability_score: 84.2,
    beginner_explanation: {
      zh: "这一段几乎全部是慢波。你可以把病例 1、2、3 放在一起看：同一个人的三次发作，慢波占比一次比一次高。真实数据往往就是这样有变化，而不是每次都长得一模一样。",
      en: "This segment is almost entirely slow activity. Compare cases 1, 2 and 3: across three seizures in one person, the slow-wave share increases each time. Real data often varies like this rather than looking identical every time.",
    },
    student_explanation: {
      zh: "本段 δ 86.8% + θ 11.4% = 98.2%，α/β 合计仅 1.9%，属于深度慢波化。三例发作片段的 δ+θ 依次为 85.2% / 97.6% / 98.2%，可作为「发作期频谱并非固定模板」的直观教学材料。",
      en: "Here δ 86.8% + θ 11.4% = 98.2%, leaving only 1.9% for α/β — profound slowing. Across the three seizure segments δ+θ is 85.2% / 97.6% / 98.2%, a vivid illustration that the ictal spectrum is not a fixed template.",
    },
    research_explanation: {
      zh: "chb01 第三次发作片段，官方标注 1732–1772 s。实测 δ 86.8 / θ 11.4 / α 1.6 / β 0.3（%）。三例发作的 δ+θ 占比分别为 85.2 / 97.6 / 98.2（%），提示发作间频谱构成存在实质差异；在教学与算法评测中，不宜用单一频谱模板代表「发作期」。局限：同病例 1。",
      en: "Third seizure segment from chb01, annotated 1732–1772 s. Measured δ 86.8 / θ 11.4 / α 1.6 / β 0.3 (%). Across the three seizures δ+θ is 85.2 / 97.6 / 98.2 (%), indicating substantive inter-seizure spectral variation; a single spectral template should not be used to represent 'the ictal state' in teaching or algorithm benchmarking. Limitations as in case 1.",
    },
    limitations: {
      zh: ["55 秒片段只覆盖发作的一个时间窗", "三个片段来自同一位患者，不能代表癫痫群体的多样性", "本案例不提供任何诊断信息"],
      en: ["The 55-second segment covers only one window of the seizure", "All three segments come from a single patient and do not represent the diversity of epilepsy", "This case provides no diagnostic information"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人的癫痫类型", "发作对认知或意识的影响", "任何其他人的情况"],
      en: ["This person's epilepsy type", "The effect of the seizure on cognition or awareness", "Anything about anyone else"],
    },
    recordRef: "chb01_15",
    source: mkSource(CHB_DATASET, "chb01_15"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: CHB_DATASET, en: CHB_DATASET },
    citation: { zh: CHB_CITE, en: CHB_CITE },
    license: CHB_LIC,
    recordingType: mkRec(23, 256, 55, CHB_MONTAGE_ZH, CHB_MONTAGE_EN),
    tags: ["seizure", "epilepsy", "ictal", "chb-mit", "real-data"],
    readTime: "5 分钟",
  },
  {
    id: "c4",
    title: {
      zh: "癫痫发作间期 EEG（无发作基线）",
      en: "Interictal EEG (Seizure-Free Baseline)",
    },
    categoryKey: "patterns",
    difficultyKey: "intermediate",
    description: {
      zh: "同一患者（CHB-MIT chb01 病例）在**没有发作**的时间段取得的 55 秒片段。数据集官方标注该记录不含任何癫痫发作。这一段最适合用来与发作期片段做对照。",
      en: "A 55-second segment from the same patient (CHB-MIT case chb01) taken during a period with **no seizure**. The dataset annotates this record as containing no seizure. This is the natural baseline for comparison with the ictal segments.",
    },
    details: {
      zh: "1. 官方标注：chb01_02 记录内发作次数为 0；本片段取自离任何发作都很远的时间窗\n2. 实测频段相对功率：δ 67.7%、θ 18.6%、α 6.3%、β 7.4%\n3. 与发作期对照的关键差异：β 7.4%（发作期 0.3–1.9%）—— 快波在发作间期明显更为丰富\n4. 信号质量评分 69.1 / 100\n\n这段记录里可见 11 个通道被标记为噪声偏高，并有「阵发性尖峰样活动」提示 —— 真实记录很少是「干净」的。",
      en: "1. Dataset annotation: chb01_02 contains zero seizures; this window is taken far from any seizure\n2. Measured relative band power: δ 67.7%, θ 18.6%, α 6.3%, β 7.4%\n3. Key contrast with the ictal segments: β 7.4% (ictal 0.3–1.9%) — fast activity is markedly richer between seizures\n4. Signal quality score 69.1 / 100\n\nEleven channels are flagged as relatively noisy here, together with a transient spike-like activity note — real recordings are rarely 'clean'.",
    },
    signal_quality: 69.11,
    learning_readability_score: 79.6,
    beginner_explanation: {
      zh: "这是同一位患者在「没有发作」的时候记录的脑电。和前面三段发作期相比，这里能看到更多快速的小波动，波形也没那么「又大又慢」。把发作期和发作间期放在一起对比，是学习癫痫脑电最直观的方法。",
      en: "This is the same patient's EEG when they were not having a seizure. Compared with the three ictal segments, you can see more fast, small fluctuations and less 'big and slow' activity. Comparing ictal with interictal records is the most intuitive way to learn about epilepsy EEG.",
    },
    student_explanation: {
      zh: "发作间期频谱 δ 67.7 / θ 18.6 / α 6.3 / β 7.4（%），与发作期（β ≤1.9%）形成清晰的高频抑制对照。需要注意的是：本段仍有大量慢波成分、且 11 个通道被判为噪声偏高 —— 发作间期记录并不等于「正常脑电」。",
      en: "The interictal spectrum is δ 67.7 / θ 18.6 / α 6.3 / β 7.4 (%), forming a clear high-frequency contrast against the ictal segments (β ≤1.9%). Note that this segment still contains substantial slow activity and 11 channels are flagged as noisy — an interictal record is not the same as a 'normal EEG'.",
    },
    research_explanation: {
      zh: "chb01_02（数据集标注 0 次发作）中的一段 55 s 窗。实测相对频段功率 δ 67.7 / θ 18.6 / α 6.3 / β 7.4（%），主频 1.67 Hz。与三个发作期片段对比可见 β 的显著差异，可作为「发作期高频抑制」的定量对照。局限：发作间期记录中仍可能存在发作间期痫样放电（本页未做棘波检测标注），因此不能把本段当作「正常参考」。",
      en: "A 55 s window from chb01_02 (dataset-annotated zero seizures). Measured relative band power δ 67.7 / θ 18.6 / α 6.3 / β 7.4 (%), dominant frequency 1.67 Hz. The β difference versus the three ictal segments gives a quantitative contrast for 'ictal high-frequency suppression'. Limitation: interictal records may still contain interictal epileptiform discharges (not annotated here), so this segment must not be treated as a 'normal reference'.",
    },
    limitations: {
      zh: ["这是一位癫痫患者的发作间期记录，不是健康人的脑电基线", "本页未对发作间期痫样放电做标注", "55 秒片段不能代表该患者长期的脑电背景"],
      en: ["This is an interictal record from a patient with epilepsy, not a healthy baseline", "Interictal epileptiform discharges are not annotated on this page", "A 55-second segment cannot represent this patient's long-term EEG background"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人是否患有癫痫（发作间期记录尤其不能用来排除）", "该患者下一次发作会在什么时候出现", "健康人群的脑电应该是什么样"],
      en: ["Whether this person has epilepsy (an interictal record especially cannot exclude it)", "When this patient's next seizure will occur", "What a healthy person's EEG should look like"],
    },
    recordRef: "chb01_02",
    source: mkSource(CHB_DATASET, "chb01_02"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: CHB_DATASET, en: CHB_DATASET },
    citation: { zh: CHB_CITE, en: CHB_CITE },
    license: CHB_LIC,
    recordingType: mkRec(23, 256, 55, CHB_MONTAGE_ZH, CHB_MONTAGE_EN),
    tags: ["epilepsy", "interictal", "baseline", "chb-mit", "real-data"],
    readTime: "6 分钟",
  },
  {
    id: "c5",
    title: {
      zh: "阿尔茨海默病 EEG（真实患者 · MMSE 16）",
      en: "Alzheimer's Disease EEG (Real Patient · MMSE 16)",
    },
    categoryKey: "clinical",
    difficultyKey: "intermediate",
    description: {
      zh: "真实患者记录：57 岁女性，数据集将其归入阿尔茨海默病组（Group A），MMSE 简易智力状态评分为 16。这是闭眼静息态记录的前 60 秒。",
      en: "A real patient recording: a 57-year-old female classified by the dataset into the Alzheimer's disease group (Group A), with an MMSE score of 16. This is the first 60 seconds of an eyes-closed resting-state recording.",
    },
    details: {
      zh: "1. 数据集标注：Group A（阿尔茨海默病），MMSE 16，57 岁女性\n2. 实测频段相对功率：δ 87.3%、θ 7.9%、α 2.4%、β 2.4%\n3. 同数据集的健康对照（本页病例 8）实测 α 为 4.7% —— 本例 α 约为其一半\n4. 信号质量评分 72.6 / 100\n\n同一数据集内的 α 频段差异是一个可定量比较的信号特征；但它只是单个被试的一段 60 秒记录。",
      en: "1. Dataset annotation: Group A (Alzheimer's disease), MMSE 16, 57-year-old female\n2. Measured relative band power: δ 87.3%, θ 7.9%, α 2.4%, β 2.4%\n3. A healthy control from the same dataset (case 8 on this page) measures α at 4.7% — roughly twice the value here\n4. Signal quality score 72.6 / 100\n\nThe α-band difference within one dataset is a quantifiable signal feature; but this is a single 60-second recording from one participant.",
    },
    signal_quality: 72.62,
    learning_readability_score: 84.0,
    beginner_explanation: {
      zh: "这段脑电来自一位被诊断为阿尔茨海默病的患者。分析显示，其中的 α 节律（约 8–13 Hz 的波动）占比偏低。研究文献中常提到：一些阿尔茨海默病患者的 α 活动会减少、慢波增多。但请注意：这只是一个人的一段记录，不能用来诊断任何人，也不能代表所有患者。",
      en: "This EEG comes from a person diagnosed with Alzheimer's disease. The analysis shows a relatively low share of α rhythm (roughly 8–13 Hz). The literature often notes that some patients with Alzheimer's disease show reduced α activity and increased slow waves. Note carefully, however: this is one recording from one person — it cannot diagnose anyone and does not represent all patients.",
    },
    student_explanation: {
      zh: "本段 α 相对功率 2.4%，慢波（δ+θ）合计 95.2%。若与同数据集的健康对照（α 4.7%）并置，可见 α 减少的倾向 —— 与文献中「AD 患者 α 功率下降、慢波功率上升」的方向一致。但这只是一个被试的横截面观察，任何因果或个体化推断都不成立。",
      en: "α relative power here is 2.4%, with slow activity (δ+θ) at 95.2%. Placed beside a healthy control from the same dataset (α 4.7%), a tendency toward reduced α emerges — consistent in direction with reports that α power decreases and slow-wave power increases in Alzheimer's disease. This is, however, a single cross-sectional observation; no causal or individualised inference follows.",
    },
    research_explanation: {
      zh: "ds004504 的 sub-001（Group A，MMSE 16，57 岁女性）闭眼静息态前 60 s。19 通道、500 Hz、10-20 系统。实测相对频段功率 δ 87.3 / θ 7.9 / α 2.4 / β 2.4（%），主频 1.95 Hz。参考该数据集的原始描述文献（doi:10.3390/data8060095）与 DICE-net 研究（doi:10.1109/ACCESS.2023.3294618）。局限：单被试、单时间窗、未做个体化阻抗/伪迹校正，不可用于任何诊断或筛查用途。",
      en: "First 60 s of eyes-closed resting-state EEG from ds004504 sub-001 (Group A, MMSE 16, 57-year-old female); 19 channels at 500 Hz, 10-20 system. Measured relative band power δ 87.3 / θ 7.9 / α 2.4 / β 2.4 (%), dominant frequency 1.95 Hz. See the dataset descriptor (doi:10.3390/data8060095) and the DICE-net study (doi:10.1109/ACCESS.2023.3294618). Limitations: single subject, single window, no individualised impedance/artefact correction; not usable for any diagnostic or screening purpose.",
    },
    limitations: {
      zh: ["只有这一位患者的一段 60 秒记录，不能代表阿尔茨海默病群体", "患者年龄、用药、睡眠状态等都会影响频谱，本页无法控制这些因素", "本案例不提供任何诊断或筛查信息"],
      en: ["One 60-second recording from one patient cannot represent the Alzheimer's disease population", "Age, medication and sleep state all affect the spectrum and cannot be controlled here", "This case provides no diagnostic or screening information"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人是否患有阿尔茨海默病（需临床评估与神经心理学检查）", "认知障碍的严重程度或进展速度", "任何其他人的认知状况"],
      en: ["Whether this person has Alzheimer's disease (clinical assessment and neuropsychological testing are required)", "The severity or rate of progression of cognitive impairment", "Anyone else's cognitive status"],
    },
    recordRef: "sub-001",
    source: mkSource(DS_DATASET, "sub-001"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: DS_DATASET, en: DS_DATASET },
    citation: { zh: DS_CITE, en: DS_CITE },
    license: DS_LIC,
    recordingType: mkRec(19, 500, 60, DS_MONTAGE_ZH, DS_MONTAGE_EN),
    tags: ["alzheimers", "dementia", "alpha", "resting-state", "ds004504", "real-data"],
    readTime: "6 分钟",
  },
  {
    id: "c6",
    title: {
      zh: "阿尔茨海默病 EEG（真实患者 · MMSE 22）",
      en: "Alzheimer's Disease EEG (Real Patient · MMSE 22)",
    },
    categoryKey: "clinical",
    difficultyKey: "intermediate",
    description: {
      zh: "同数据集中的另一位阿尔茨海默病患者：78 岁女性，MMSE 22。同样是闭眼静息态的前 60 秒。与病例 5 相比，两位患者的频谱并不相同。",
      en: "Another patient with Alzheimer's disease from the same dataset: a 78-year-old female with an MMSE of 22. Again the first 60 seconds of an eyes-closed resting-state recording. Compared with case 5, the two patients do not share the same spectrum.",
    },
    details: {
      zh: "1. 数据集标注：Group A（阿尔茨海默病），MMSE 22，78 岁女性\n2. 实测频段相对功率：δ 89.5%、θ 6.5%、α 2.1%、β 1.9%\n3. 与病例 5（MMSE 16，α 2.4%）相比，本例 α 更低（2.1%）—— 但两个被试的 MMSE 差异并不能由一条频谱解释\n4. 信号质量评分 74.7 / 100",
      en: "1. Dataset annotation: Group A (Alzheimer's disease), MMSE 22, 78-year-old female\n2. Measured relative band power: δ 89.5%, θ 6.5%, α 2.1%, β 1.9%\n3. Compared with case 5 (MMSE 16, α 2.4%), α is slightly lower here (2.1%) — but the MMSE difference between two participants cannot be explained by one spectrum\n4. Signal quality score 74.7 / 100",
    },
    signal_quality: 74.69,
    learning_readability_score: 84.0,
    beginner_explanation: {
      zh: "这是同数据集里的另一位患者。虽然都被归入阿尔茨海默病组，但两人的脑电频谱并不一样。这一点很重要：一个标签（诊断）背后，脑电表现可以有很多种样子。",
      en: "This is another patient from the same dataset. Although both are classified in the Alzheimer's disease group, their spectra differ. That matters: behind one label (a diagnosis), the EEG can look quite different from person to person.",
    },
    student_explanation: {
      zh: "δ 89.0% 是本案例库中慢波占比最高的一段。与病例 5 并置可见：同为 Group A，δ 从 86.7% 到 89.0%、α 从 2.4% 到 2.1%。这些差异说明「组内变异」不可忽略，也说明单被试比较的局限。",
      en: "δ at 89.0% is the highest slow-wave share in this case library. Side by side with case 5: within Group A, δ ranges 86.7–89.0% and α 2.4–2.1%. Such differences show that within-group variability cannot be ignored and illustrate the limits of single-subject comparison.",
    },
    research_explanation: {
      zh: "ds004504 的 sub-002（Group A，MMSE 22，78 岁女性）闭眼静息态前 60 s。19 通道 500 Hz。实测 δ 89.5 / θ 6.5 / α 2.1 / β 1.9（%），主频 1.95 Hz。与 sub-001 并置可作为「同组内频谱异质性」的示例；真正的人群层面结论需要按该数据集的规范流程（含全部被试、交叉验证）得出，单例不构成证据。",
      en: "First 60 s of eyes-closed resting-state EEG from ds004504 sub-002 (Group A, MMSE 22, 78-year-old female); 19 channels at 500 Hz. Measured δ 89.5 / θ 6.5 / α 2.1 / β 1.9 (%), dominant frequency 1.95 Hz. Together with sub-001 this illustrates within-group spectral heterogeneity; population-level conclusions require the dataset's full protocol (all participants, cross-validation) — single cases are not evidence.",
    },
    limitations: {
      zh: ["单被试记录，不能代表阿尔茨海默病群体", "不能由频谱差异反推认知评分的差异", "本案例不提供任何诊断或筛查信息"],
      en: ["A single-subject recording cannot represent the Alzheimer's disease population", "Spectral differences cannot be used to infer differences in cognitive scores", "This case provides no diagnostic or screening information"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人是否患有阿尔茨海默病", "疾病处于什么阶段", "任何其他人的认知状况"],
      en: ["Whether this person has Alzheimer's disease", "What stage the disease is at", "Anyone else's cognitive status"],
    },
    recordRef: "sub-002",
    source: mkSource(DS_DATASET, "sub-002"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: DS_DATASET, en: DS_DATASET },
    citation: { zh: DS_CITE, en: DS_CITE },
    license: DS_LIC,
    recordingType: mkRec(19, 500, 60, DS_MONTAGE_ZH, DS_MONTAGE_EN),
    tags: ["alzheimers", "dementia", "alpha", "resting-state", "ds004504", "real-data"],
    readTime: "5 分钟",
  },
  {
    id: "c7",
    title: {
      zh: "额颞叶痴呆 EEG（真实患者）",
      en: "Frontotemporal Dementia EEG (Real Patient)",
    },
    categoryKey: "clinical",
    difficultyKey: "intermediate",
    description: {
      zh: "真实患者记录：73 岁男性，数据集将其归入额颞叶痴呆组（Group F），MMSE 20。闭眼静息态前 60 秒。额颞叶痴呆是另一类常见的早发性痴呆。",
      en: "A real patient recording: a 73-year-old male classified by the dataset into the frontotemporal dementia group (Group F), with an MMSE of 20. The first 60 seconds of an eyes-closed resting-state recording. Frontotemporal dementia is another common form of early-onset dementia.",
    },
    details: {
      zh: "1. 数据集标注：Group F（额颞叶痴呆），MMSE 20，73 岁男性\n2. 实测频段相对功率：δ 87.2%、θ 8.1%、α 2.7%、β 2.1%\n3. 信号质量评分 67.3 / 100（本案例库中最低的一段，伪影扣分 15.0）\n\n把 AD 与 FTD 两组片段并置可以看出：闭眼静息态频谱在两组之间并没有一眼可辨的差异 —— 这正是需要在规范流程下做定量研究的原因。",
      en: "1. Dataset annotation: Group F (frontotemporal dementia), MMSE 20, 73-year-old male\n2. Measured relative band power: δ 87.2%, θ 8.1%, α 2.7%, β 2.1%\n3. Signal quality score 67.3 / 100 (the lowest in this case library, with a full 15.0 artefact penalty)\n\nPlacing AD and FTD segments side by side shows that the resting-state spectrum does not differ in any immediately obvious way between the two groups — which is exactly why quantitative study under a formal protocol is needed.",
    },
    signal_quality: 67.27,
    learning_readability_score: 83.9,
    beginner_explanation: {
      zh: "这段脑电来自一位被诊断为额颞叶痴呆的患者。它的频谱看起来和前面阿尔茨海默病的两段很接近 —— 这提醒我们：光靠肉眼看脑电波形，往往区分不出不同的疾病。脑电是一种需要定量分析的信号。",
      en: "This EEG comes from a person diagnosed with frontotemporal dementia. Its spectrum looks close to the two Alzheimer's segments above — a reminder that different conditions often cannot be told apart by eye from an EEG trace. EEG is a signal that calls for quantitative analysis.",
    },
    student_explanation: {
      zh: "本例 δ 87.2 / θ 8.1 / α 2.7 / β 2.1（%），与病例 5、6（AD 组）几乎落在同一区间。同时本例信号质量最低（67.3，伪影扣满分）—— 真实临床记录中伪影与被试状态的影响很难完全排除，这是做组间比较时必须处理的问题。",
      en: "Here δ 87.2 / θ 8.1 / α 2.7 / β 2.1 (%) sits almost in the same range as cases 5 and 6 (AD group). Signal quality is also the lowest here (67.3, full artefact penalty) — in real clinical recordings, artefact and participant state cannot be fully excluded, which is precisely what group comparisons must account for.",
    },
    research_explanation: {
      zh: "ds004504 的 sub-066（Group F，MMSE 20，73 岁男性）闭眼静息态前 60 s。19 通道 500 Hz。实测 δ 87.2 / θ 8.1 / α 2.7 / β 2.1（%），主频 1.95 Hz，信号质量 67.3（伪影扣分 15.0，为满分扣分）。AD（sub-001/002）与 FTD（sub-066）在本页三个单例上不可区分；跨组别区分需按数据集规范做全样本建模与交叉验证。",
      en: "First 60 s of eyes-closed resting-state EEG from ds004504 sub-066 (Group F, MMSE 20, 73-year-old male); 19 channels at 500 Hz. Measured δ 87.2 / θ 8.1 / α 2.7 / β 2.1 (%), dominant frequency 1.95 Hz, signal quality 67.3 (artefact penalty at its maximum). AD (sub-001/002) and FTD (sub-066) are indistinguishable across these three single cases; cross-group discrimination requires full-sample modelling and cross-validation per the dataset protocol.",
    },
    limitations: {
      zh: ["单被试记录，不能代表额颞叶痴呆群体", "本段信号质量较低，伪影可能影响频谱估计", "本案例不提供任何诊断信息"],
      en: ["A single-subject recording cannot represent the FTD population", "Signal quality is relatively low here, so artefact may affect the spectral estimate", "This case provides no diagnostic information"],
    },
    what_this_data_cannot_tell: {
      zh: ["这个人是否患有额颞叶痴呆", "与阿尔茨海默病如何区分", "任何其他人的健康状况"],
      en: ["Whether this person has frontotemporal dementia", "How to distinguish it from Alzheimer's disease", "Anyone else's health status"],
    },
    recordRef: "sub-066",
    source: mkSource(DS_DATASET, "sub-066"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: DS_DATASET, en: DS_DATASET },
    citation: { zh: DS_CITE, en: DS_CITE },
    license: DS_LIC,
    recordingType: mkRec(19, 500, 60, DS_MONTAGE_ZH, DS_MONTAGE_EN),
    tags: ["ftd", "dementia", "resting-state", "ds004504", "real-data"],
    readTime: "5 分钟",
  },
  {
    id: "c8",
    title: {
      zh: "健康对照 EEG（同数据集对照组）",
      en: "Healthy Control EEG (Same Dataset)",
    },
    categoryKey: "clinical",
    difficultyKey: "beginner",
    description: {
      zh: "真实被试记录：57 岁男性，数据集将其归入健康对照组（Group C），MMSE 30（满分）。这是与病例 5–7 来自同一数据集、同一记录方案的对照记录。",
      en: "A real participant recording: a 57-year-old male classified by the dataset into the healthy control group (Group C), with a full MMSE of 30. This is a control recording from the same dataset and the same acquisition protocol as cases 5–7.",
    },
    details: {
      zh: "1. 数据集标注：Group C（健康对照），MMSE 30，57 岁男性\n2. 实测频段相对功率：δ 85.0%、θ 7.8%、α 4.7%、β 2.5%\n3. 关键对照点：本例 α 4.7%，而 AD 两例分别为 2.4%、2.1% —— 约为一倍差距\n4. 信号质量评分 70.0 / 100\n\n请注意：这是一位健康被试的记录，但它同样只是一段 60 秒的数据，不能代表「正常人脑电」的全部样貌。",
      en: "1. Dataset annotation: Group C (healthy control), MMSE 30, 57-year-old male\n2. Measured relative band power: δ 85.0%, θ 7.8%, α 4.7%, β 2.5%\n3. The key contrast: α is 4.7% here versus 2.4% and 2.1% in the two Alzheimer's cases — roughly a two-fold difference\n4. Signal quality score 70.0 / 100\n\nNote: this is a healthy participant's recording, but it is still one 60-second window and does not represent the full range of 'normal' EEG.",
    },
    signal_quality: 70.01,
    learning_readability_score: 84.0,
    beginner_explanation: {
      zh: "这是同一位研究者记录的「健康对照组」脑电。把它和前面阿尔茨海默病、额颞叶痴呆的片段对比，你会看到 α 节律（约 8–13 Hz 的波动）占比相对更高一些。但一定要记住：这是单个被试、单段记录，不能拿来判定任何人的健康与否。",
      en: "This is a healthy-control EEG from the same study. Compare it with the Alzheimer's and FTD segments above and you will see a somewhat higher share of α rhythm (roughly 8–13 Hz). Always remember: this is a single participant and a single window — it cannot be used to judge anyone's health.",
    },
    student_explanation: {
      zh: "本例 α 相对功率 4.7%，约为同数据集 AD 两例（2.4%、2.1%）的两倍。这组数值构成了「对照组—患者组」在这一指标上的直观对照，但单例对照不构成统计证据。",
      en: "α relative power here is 4.7%, roughly double that of the two Alzheimer's cases in the same dataset (2.4%, 2.1%). These values provide an intuitive control-versus-patient contrast on this metric — but single-case contrasts are not statistical evidence.",
    },
    research_explanation: {
      zh: "ds004504 的 sub-037（Group C，MMSE 30，57 岁男性）闭眼静息态前 60 s。19 通道 500 Hz。实测 δ 85.0 / θ 7.8 / α 4.7 / β 2.5（%），主频 1.95 Hz。本段与 sub-001/002（AD）、sub-066（FTD）使用完全相同的采集与预处理流程，因此适合作为「同方案对照」展示。局限：单被试、单窗、未做个体化校正。",
      en: "First 60 s of eyes-closed resting-state EEG from ds004504 sub-037 (Group C, MMSE 30, 57-year-old male); 19 channels at 500 Hz. Measured δ 85.0 / θ 7.8 / α 4.7 / β 2.5 (%), dominant frequency 1.95 Hz. This segment shares the identical acquisition and preprocessing protocol with sub-001/002 (AD) and sub-066 (FTD), making it suitable as a same-protocol control. Limitations: single subject, single window, no individualised correction.",
    },
    limitations: {
      zh: ["单个健康被试不能代表「正常脑电」的分布范围", "本例年龄（57 岁）与患者组并不完全匹配", "本案例不提供任何诊断或筛查信息"],
      en: ["A single healthy participant cannot represent the distribution of 'normal EEG'", "This participant's age (57) is not perfectly matched to the patient groups", "This case provides no diagnostic or screening information"],
    },
    what_this_data_cannot_tell: {
      zh: ["任何人的健康状况", "判断某段脑电是否「异常」的通用阈值", "人群层面的组间差异"],
      en: ["Anyone's health status", "A universal threshold for calling an EEG 'abnormal'", "Group-level differences at the population scale"],
    },
    recordRef: "sub-037",
    source: mkSource(DS_DATASET, "sub-037"),
    dataKind: "real",
    sourceType: "public",
    dataset: { zh: DS_DATASET, en: DS_DATASET },
    citation: { zh: DS_CITE, en: DS_CITE },
    license: DS_LIC,
    recordingType: mkRec(19, 500, 60, DS_MONTAGE_ZH, DS_MONTAGE_EN),
    tags: ["control", "healthy", "alpha", "resting-state", "ds004504", "real-data"],
    readTime: "5 分钟",
  },
];
const difficultyColor: Record<string, string> = {
  beginner: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
  intermediate: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800",
  advanced: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
};

export default function CasesPage() {
  const { lang, t } = useLang();
  /** 「教育参考案例 + 数据来源」统一文案（自包含七语言） */
  const src = SRC_L[lang as SrcL] || SRC_L.en;
  // 来源类型 / 数据状态文案：缺省一律回退到最保守的「教育参考」，绝不猜测来源
  const sourceTypeText = (v?: SourceType) =>
    v === "literature" ? src.stLiterature
      : v === "simulated" ? src.stSimulated
        : v === "public" ? src.stPublic
          : v === "unknown" ? src.stUnknown
            : src.stReference;
  const dataStatusText = (k?: DataKind) =>
    k === "illustrative" ? src.dsIllustrative
      : k === "real" ? src.dsReal
        : k === "public" ? src.dsPublic
          : k === "unknown" ? src.dsUnknown
            : src.dsSimulated;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("default");

  const categories = ["all", ...Array.from(new Set(cases.map((c) => c.categoryKey)))];
  const difficulties = ["all", "beginner", "intermediate", "advanced"];

  const filtered = useMemo(() => {
    let result = cases.filter((c) => {
      if (selectedCategory !== "all" && c.categoryKey !== selectedCategory) return false;
      if (selectedDifficulty !== "all" && c.difficultyKey !== selectedDifficulty) return false;
      if (selectedTag && !c.tags.includes(selectedTag)) return false;
      const q = search.toLowerCase();
      if (q) {
        const title = (c.title[lang] || c.title.en || c.title.zh || "").toLowerCase();
        const desc = (c.description[lang] || c.description.en || c.description.zh || "").toLowerCase();
        const tags = c.tags.join(" ").toLowerCase();
        if (!title.includes(q) && !desc.includes(q) && !tags.includes(q)) return false;
      }
      return true;
    });

    // 排序
    if (sortBy === "quality") result.sort((a, b) => b.signal_quality - a.signal_quality);
    if (sortBy === "difficulty") {
      const order = { beginner: 0, intermediate: 1, advanced: 2 };
      result.sort((a, b) => (order[a.difficultyKey] || 0) - (order[b.difficultyKey] || 0));
    }

    return result;
  }, [cases, selectedCategory, selectedDifficulty, search, selectedTag, sortBy, lang]);

  const toggle = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <motion.div
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.05 }}
    >
      <section className="max-w-6xl mx-auto px-3 sm:px-5 py-4 sm:py-8 pb-[env(safe-area-inset-bottom,16px)]">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t("casesTitle")}</h1>
          <p className="text-sm text-[var(--color-text)]/70 mt-1">{t("casesSubtitle")}</p>
        </div>

        {/* 搜索 + 筛选 */}
        <div className="space-y-4 mb-6">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("casesSearchPlaceholder")}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/50 focus:border-[var(--color-primary)]/30 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/10"
            />
          </div>

          {/* 筛选栏 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 分类 */}
            <div className="flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    selectedCategory === cat
                      ? "bg-blue-600 text-white dark:bg-blue-500 border-blue-600 dark:bg-blue-600 dark:text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {cat === "all" ? t("all") : t(`cat${cat}`)}
                </button>
              ))}
            </div>

            {/* 难度 */}
            <div className="flex items-center gap-1.5 ml-2">
              <Filter className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
              {difficulties.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDifficulty(d)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    selectedDifficulty === d
                      ? "bg-blue-600 text-white dark:bg-blue-500 border-blue-600 dark:bg-blue-600 dark:text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {d === "all" ? t("all") : t(`diff${d}`)}
                </button>
              ))}
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-1.5 ml-auto">
              <ArrowUpDown className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[var(--color-text)] focus:outline-none"
              >
                <option value="default">{t("casesSortDefault")}</option>
                <option value="quality">{t("quality")}</option>
                <option value="difficulty">{t("casesSortDifficulty")}</option>
              </select>
            </div>
          </div>

          {/* 标签筛选（仅在有选中标签时显示清除按钮） */}
          {selectedTag && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-secondary)]">{t("tags")}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/30 px-2.5 py-0.5 text-xs text-blue-700 dark:text-blue-400">
                {t("tag" + selectedTag.charAt(0).toUpperCase() + selectedTag.slice(1)) || selectedTag}
                <button onClick={() => setSelectedTag(null)} className="ml-1 hover:text-blue-900 dark:hover:text-blue-200">×</button>
              </span>
            </div>
          )}
        </div>

        {/* 案例列表 */}
        <div className="space-y-4">
          {filtered.map((c, i) => {
            const isExpanded = expandedId === c.id;
            const title = c.title[lang] || c.title.en || c.title.zh || "";
            const description = c.description[lang] || c.description.en || c.description.zh || "";
            const details = c.details[lang] || c.details.en || c.details.zh || "";

            const beginnerExp = c.beginner_explanation[lang] || c.beginner_explanation.en || c.beginner_explanation.zh || "";
            const studentExp = c.student_explanation[lang] || c.student_explanation.en || c.student_explanation.zh || "";
            const researchExp = c.research_explanation[lang] || c.research_explanation.en || c.research_explanation.zh || "";
            const limitations = c.limitations[lang] || c.limitations.en || c.limitations.zh || [];
            const cannotTell = c.what_this_data_cannot_tell[lang] || c.what_this_data_cannot_tell.en || c.what_this_data_cannot_tell.zh || [];
            const sourceNote = c.source ? (c.source[lang] || c.source.en || c.source.zh || "") : "";

            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
                className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden hover:shadow-lg hover:shadow-gray-900/5 transition-all duration-300"
              >
                {/* 卡片头部（点击展开） */}
                <div
                  className="p-5 cursor-pointer select-none"
                  onClick={() => toggle(c.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* 标签行 */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${difficultyColor[c.difficultyKey]}`}
                        >
                          {t(`diff${c.difficultyKey}`)}
                        </span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{t(`cat${c.categoryKey}`)}</span>
                        <span className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {t("readTime").replace("{min}", c.readTime.replace(/[^0-9]/g, ""))}
                        </span>
                      </div>
                      {/* 标题 */}
                      <h3 className="text-sm font-bold text-[var(--color-text)] leading-snug">{title}</h3>
                      {/* 简介 */}
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 line-clamp-2">{description}</p>
                      {/* 真实数据来源标识（列表态即显示：读者与搜索引擎都能看到来源真实可查） */}
                      {c.dataset && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
                          <Database className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">
                            {c.dataset[lang] || c.dataset.en || c.dataset.zh}
                            {c.recordRef ? ` · ${c.recordRef}` : ""}
                          </span>
                        </p>
                      )}
                    </div>
                    {/* 展开/折叠箭头 */}
                    <div className="pt-1">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-[var(--color-text-secondary)]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" />
                      )}
                    </div>
                  </div>
                </div>

                {/* 展开内容 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.05 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-6 border-t border-[var(--color-border)]">

                        {/* 详细描述 */}
                        <div className="pt-4">
                          <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-2">{t("caseDetails")}</h4>
                          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">{details}</p>
                        </div>

                        {/* 信号质量 */}
                        <div>
                          <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-2">{t("signalQualityScore")}</h4>
                          <div className="flex items-center gap-3">
                            <div className={`text-lg font-bold ${
                              c.signal_quality >= 80 ? "text-green-600" : c.signal_quality >= 60 ? "text-yellow-600" : "text-red-600"
                            }`}>{c.signal_quality}/100</div>
                            <div className="flex-1 h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  c.signal_quality >= 80 ? "bg-green-500" : c.signal_quality >= 60 ? "bg-yellow-500" : "bg-red-500"
                                }`}
                                style={{ width: `${c.signal_quality}%` }}
                              />
                            </div>
                          </div>
                        </div>


                        {/* 三层 AI 解释 */}
                        <div>
                          <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-3">{t("aiExplanation")}（{t("beginnerMode")} / {t("studentMode")} / {t("researchMode")}）</h4>
                          <div className="space-y-4">
                            {/* Beginner */}
                            <div className="bg-green-50/50 border border-green-200 rounded-xl p-4 dark:bg-green-950/30 dark:border-green-800">
                              <div className="flex items-center gap-2 mb-2">
                                <User className="w-4 h-4 text-green-600 dark:text-green-400" />
                                <span className="text-xs font-bold text-green-700 dark:text-green-400">{t("beginnerMode")}</span>
                              </div>
                              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{beginnerExp}</p>
                            </div>
                            {/* Student */}
                            <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 dark:bg-blue-950/30 dark:border-blue-800">
                              <div className="flex items-center gap-2 mb-2">
                                <GraduationCap className="w-4 h-4 text-blue-600" />
                                <span className="text-xs font-bold text-blue-700 dark:text-blue-400">{t("studentMode")}</span>
                              </div>
                              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{studentExp}</p>
                            </div>
                            {/* Research */}
                            <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-4 dark:bg-purple-950/30 dark:border-purple-800">
                              <div className="flex items-center gap-2 mb-2">
                                <Microscope className="w-4 h-4 text-purple-600" />
                                <span className="text-xs font-bold text-purple-700 dark:text-purple-400">{t("researchMode")}</span>
                              </div>
                              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{researchExp}</p>
                            </div>
                          </div>
                        </div>

                        {/* 局限与不可推断项（教育透明度：让读者知道这些数据不说明什么） */}
                        {(limitations.length > 0 || cannotTell.length > 0) && (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {limitations.length > 0 && (
                              <div>
                                <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-2">
                                  {src.limitationsTitle}
                                </h4>
                                <ul className="space-y-1.5">
                                  {limitations.map((x, k) => (
                                    <li
                                      key={k}
                                      className="flex gap-2 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                                    >
                                      <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[var(--color-text-secondary)]" />
                                      <span>{x}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {cannotTell.length > 0 && (
                              <div>
                                <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-2">
                                  {src.cannotTellTitle}
                                </h4>
                                <ul className="space-y-1.5">
                                  {cannotTell.map((x, k) => (
                                    <li
                                      key={k}
                                      className="flex gap-2 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                                    >
                                      <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[var(--color-text-secondary)]" />
                                      <span>{x}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 标签 */}
                        <div className="flex flex-wrap gap-1.5">
                          {c.tags.map((tag) => (
                            <button
                              key={tag}
                              onClick={(e) => { e.stopPropagation(); setSelectedTag(tag === selectedTag ? null : tag); }}
                              className={`text-xs px-2 py-0.5 rounded-md transition-all ${
                                selectedTag === tag
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
                                  : "bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-text)]/10"
                              }`}
                            >
                              {t("tag" + tag.charAt(0).toUpperCase() + tag.slice(1)) || tag}
                            </button>
                          ))}
                        </div>

                        {/* Source Information（统一来源区域，置于案例详情底部） */}
                        <div>
                          <h4 className="text-xs font-bold text-[var(--color-text-secondary)] mb-2">{src.heading}</h4>
                          {sourceNote && (
                            <p className="mb-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">{sourceNote}</p>
                          )}
                          <dl className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
                            {[
                              { label: src.labelSourceType, value: sourceTypeText(c.sourceType), emphasis: true },
                              // 数据集来源：c1–c4 绑定 CHB-MIT Scalp EEG Database（PhysioNet，ODC-By 1.0），
                              //   c5–c8 绑定 OpenNeuro ds004504（CC0 1.0）。全部为公开、可下载、可核实的数据集。
                              //   注意：新增案例必须提供真实可核实的 dataset 字段并在此声明许可与出处，
                              //   严禁编造数据集名称；缺失时按下方逻辑回退为“暂缺”。
                              {
                                label: src.labelDataset,
                                value: c.dataset
                                  ? c.dataset[lang] || c.dataset.en || c.dataset.zh || src.unavailable
                                  : src.unavailable,
                              },
                              // 文献引用：各案例均给出可核实的原始论文 / DOI（Guttag 2010 doi:10.13026/C2K01R；
                              //   Miltiadous et al. 2023 doi:10.3390/data8060095）。新增案例必须附真实文献，
                              //   严禁编造引用；缺失时回退为“待核实”。
                              {
                                label: src.labelCitation,
                                value: c.citation
                                  ? c.citation[lang] || c.citation.en || c.citation.zh || src.pending
                                  : src.pending,
                              },
                              // 许可：CHB-MIT 为 ODC-By 1.0（要求署名），ds004504 为 CC0。
                              // ODC-By 的核心义务就是署名，因此许可必须显式展示。
                              {
                                label: src.labelLicense,
                                value: c.license || src.unavailable,
                              },
                              {
                                label: src.labelRecordingType,
                                value: c.recordingType
                                  ? c.recordingType[lang] || c.recordingType.en || c.recordingType.zh || src.rtIllustrative
                                  : src.rtIllustrative,
                              },
                              { label: src.labelDataStatus, value: dataStatusText(c.dataKind) },
                            ].map((row) => (
                              <div
                                key={row.label}
                                className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3"
                              >
                                <dt className="w-28 flex-shrink-0 text-xs font-medium text-[var(--color-text-secondary)]">
                                  {row.label}
                                </dt>
                                <dd
                                  className={`text-xs leading-relaxed ${
                                    row.emphasis
                                      ? "font-semibold text-[var(--color-text)]"
                                      : "text-[var(--color-text-secondary)]"
                                  }`}
                                >
                                  {row.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        {/* 真实数据可验证：直接分析本案例附带的真实公开数据集片段 */}
                        <AnalyzeCasePanel caseId={c.id} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* 空状态 */}
        {filtered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-16 text-center"
          >
            <Stethoscope className="w-12 h-12 text-[var(--color-border)] mx-auto mb-4" />
            <p className="text-[var(--color-text-secondary)]">{t("noFilesSelected")}</p>
          </motion.div>
        )}
      </section>
    </motion.div>
  );
}
