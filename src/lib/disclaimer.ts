/**
 * 免责声明解析（共享工具）
 *
 * 背景：后端 analysis.disclaimer 历史上只提供 zh / en 两种语言。
 * 当界面语言是 es / fr / de / ja / ko 时，`disclaimer[lang]` 为 undefined，
 * 旧代码会回退成整个对象 `{zh, en}` 并直接渲染 → React 抛
 * "Objects are not valid as a React child"，报告页整块崩溃；
 * PDF 导出路径则会打印出 "[object Object]"。
 *
 * 这里严格只接受字符串：优先本语言 → 英文 → 中文 → 本语言兜底文案。
 * 兜底文案统一包含非医疗声明，与后端 NON_MEDICAL_DISCLAIMER 保持一致。
 */
export const DISCLAIMER_FALLBACK: Record<string, string> = {
  zh: "本报告仅用于 EEG 科普教育。NeuroAccess 面向教育与 EEG 素养，不是医疗诊断工具。EEG 数据不能单独用于诊断任何疾病。如有健康问题，请咨询专业医生。",
  en: "This report is for EEG educational purposes only. NeuroAccess is designed for education and EEG literacy. It is not a medical diagnostic tool. EEG data alone cannot diagnose any disease. For health concerns, consult a qualified physician.",
  ja: "本レポートはEEG教育のみを目的としています。NeuroAccessは教育とEEGリテラシーのためのツールであり、医療診断ツールではありません。EEGデータ単独で病気を診断することはできません。健康上の懸念がある場合は、専門医にご相談ください。",
  es: "Este informe es solo para fines educativos de EEG. NeuroAccess está diseñado para la educación y la alfabetización en EEG. No es una herramienta de diagnóstico médico. Los datos de EEG por sí solos no pueden diagnosticar ninguna enfermedad. Si tiene inquietudes de salud, consulte a un médico cualificado.",
  fr: "Ce rapport est uniquement destiné à l'éducation à l'EEG. NeuroAccess est conçu pour l'éducation et la littératie en EEG. Ce n'est pas un outil de diagnostic médical. Les données EEG seules ne permettent pas de diagnostiquer une maladie. En cas de préoccupation de santé, consultez un médecin qualifié.",
  de: "Dieser Bericht dient ausschließlich der EEG-Bildung. NeuroAccess ist für Bildung und EEG-Kompetenz gedacht und kein medizinisches Diagnosewerkzeug. EEG-Daten allein können keine Krankheit diagnostizieren. Bei gesundheitlichen Bedenken wenden Sie sich an eine qualifizierte Ärztin oder einen qualifizierten Arzt.",
  ko: "이 보고서는 EEG 교육 목적으로만 제공됩니다. NeuroAccess는 교육과 EEG 리터러시를 위한 도구이며 의료 진단 도구가 아닙니다. EEG 데이터만으로는 어떤 질병도 진단할 수 없습니다. 건강에 대한 우려가 있으면 전문 의료인과 상담하십시오.",
};

export function resolveDisclaimer(raw: any, lang: string): string {
  let v: any = raw;
  if (v && typeof v === "object") v = v[lang] ?? v.en ?? v.zh;
  if (typeof v === "string" && v.trim()) return v;
  return DISCLAIMER_FALLBACK[lang] || DISCLAIMER_FALLBACK.en;
}
