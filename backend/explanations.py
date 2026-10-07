"""
NeuroAccess Backend — AI 解释生成模块
OpenRouter API 调用 / prompt 构建 / 三层解释
"""
import os
import re
import json
import concurrent.futures
import requests
from typing import Any, Dict

from utils import safe_float, to_jsonable

# ── Language name map for AI prompt output language ──────────────────
LANG_NAME_MAP = {
    "zh": "Chinese",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ja": "Japanese",
    "ko": "Korean",
}

# ── OpenRouter 配置 ─────────────────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"

# 研究档「扩展重写」的提示后缀。
# 2026-10-05：抽成模块常量，供「并行预取」与「按需兜底」共用同一份文本
# （过去它是就地拼在长度校验分支里，只能在首批返回之后串行发起 —— 实测白等 +7.16s）。
RESEARCH_EXPANSION_SUFFIX = (
    "\n\n[EXPANSION REQUEST] The previous output was too short. "
    "Expand each paragraph with deeper technical detail: include precise frequency bands, "
    "amplitude relationships, dominant rhythm and its typical physiological correlate, "
    "data-quality caveats per weak channel group, and methodological limitations. "
    "Aim for AT LEAST 60% longer than the student-tier explanation."
)

# Beginner 禁止术语（中英文）——只禁真正深奥的术语；
# 允许 channel/电极/采样率/frequency/alpha/beta 等描述性词（AI 需要它们描述数据本身）
FORBIDDEN = [
    "psd", "bandpower", "montage", "artifact", "amplitude", "impedance",
    "oscillation", "rhythm", "spectrum", "filtering", "nyquist",
    "功率谱", "伪迹", "阻抗", "振幅", "振荡", "节律", "频谱", "滤波", "奈奎斯特",
]


def contains_beginner_jargon(text: str) -> bool:
    """检查 beginner 解释是否包含过多深奥术语；出现 >= 3 个禁用词才认为是 jargon"""
    text_lower = str(text).lower()
    count = sum(1 for t in FORBIDDEN if t in text_lower)
    return count >= 3


def call_openrouter(prompt: str, timeout: int = 30, max_tokens: int = 400) -> Dict[str, Any]:
    """调用 OpenRouter API；失败返回 { success: False, error }"""
    if not OPENROUTER_API_KEY:
        return {"success": False, "error": "OpenRouter API key not configured"}
    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.15,
                # 2026-10-07 换用推理模型 deepseek/deepseek-v4-flash 后必须关掉推理：
                # 推理 token 会占用 max_tokens 预算，而本项目各档预算很小
                # （beginner 200 / student 450 / research 1500），预算被推理吃光后
                # message.content 会直接返回 JSON null —— 实测导致三档全部回退模板。
                # 关掉后 reasoning_tokens=0，全部预算用于正文，行为与原先非推理模型一致；
                # 提示词、max_tokens、清洗链等其余部分一律未动。
                "reasoning": {"enabled": False},
            },
            timeout=(10, timeout),
        )
        if resp.status_code != 200:
            body = resp.text[:500]
            # 友好的错误归类：上下文超长属于已知可降级情况，不向用户暴露原始 API 文本
            if "input length" in body.lower() or "too long" in body.lower():
                return {"success": False, "error": "AI input exceeded model context limit; using template explanation."}
            return {"success": False, "error": f"OpenRouter failed (HTTP {resp.status_code})."}
        text = str(resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
        if not text:
            return {"success": False, "error": "OpenRouter returned empty response"}
        return {"success": True, "text": text}
    except requests.exceptions.Timeout:
        return {"success": False, "error": f"OpenRouter request timed out after {timeout} seconds."}
    except Exception as e:
        return {"success": False, "error": f"OpenRouter unexpected error: {str(e)}"}


def call_ollama(prompt: str, timeout: int = 120, max_tokens: int = 400) -> Dict[str, Any]:
    """兼容旧接口，内部调用 OpenRouter"""
    return call_openrouter(prompt, timeout=timeout, max_tokens=max_tokens)


def _fmt_duration(a: Dict, lang: str) -> str:
    """按语言格式化录音时长：en→'20 seconds'/'1 min 5 s'，zh→'20秒'/'1分5秒'"""
    sec = a.get("recording_duration_seconds") or a.get("duration_seconds")
    if isinstance(sec, (int, float)) and sec >= 0:
        s = int(round(sec))
        m, r = divmod(s, 60)
        if lang == "zh":
            return f"{m}分{r}秒" if m > 0 else f"{r}秒"
        return f"{m} min {r} s" if m > 0 else f"{r} seconds"
    return str(a.get("duration") or "?")


def _quality_level(score: Any, lang: str) -> str:
    s = safe_float(score, -1)
    if s >= 80: return "good" if lang == "en" else ("较好" if lang == "zh" else "good")
    if s >= 55: return "moderate" if lang == "en" else ("中等" if lang == "zh" else "moderate")
    if s >= 0:  return "limited" if lang == "en" else ("受限" if lang == "zh" else "limited")
    return "unknown" if lang == "en" else ("暂不确定" if lang == "zh" else "unknown")


def _band_plain_name(band: str | None, lang: str) -> str:
    """把频段名转成入门级通俗名称"""
    if lang != "zh":
        if not band: return "an unknown wave type"
        return {"delta": "slow waves", "theta": "slow waves", "alpha": "mid-speed waves", "beta": "fast waves"}.get(band, f"{band} waves")
    if not band: return "一种未知波型"
    return {"delta": "慢波", "theta": "慢波", "alpha": "中速波", "beta": "快波"}.get(band, f"{band}波")


def _pct(v) -> float | None:
    """把 bandpower_percent 的值（可能是 '58.1%'、'58.1'、数字、None）统一转成 float；失败返回 None"""
    if v is None: return None
    try:
        s = str(v).strip().rstrip('%').strip()
        return float(s)
    except (TypeError, ValueError):
        return None


# 标准 10-20 系统电极名 + 通用命名模式（数字编号 / 自定义名）—— 用于检测 AI 是否违规列出了通道名
_CHANNEL_PATTERNS = [
    r"\bEEG\s*Fp1\b", r"\bEEG\s*Fp2\b", r"\bEEG\s*AF[3-7]\b", r"\bEEG\s*F[3-8z]\b",
    r"\bEEG\s*T[3-6]\b", r"\bEEG\s*C[3-4z]\b", r"\bEEG\s*P[3-4z]\b", r"\bEEG\s*O[1-2z]\b",
    r"\bEEG\s*A[1-2]\b", r"\bEEG\s*M[1-2]\b", r"\bEEG\s*I[1-2]\b",
    r"\bFp1\b", r"\bFp2\b", r"\bAF[3-7]\b", r"\bF[3-8z]\b",
    r"\bT[3-6]\b", r"\bC[3-4z]\b", r"\bP[3-4z]\b", r"\bO[1-2z]\b",
    r"\bA[1-2]\b", r"\bM[1-2]\b", r"\bI[1-2]\b",
    r"\bEEG\s*CH\s*\d+\b", r"\bEEG\s*\d{2,3}\b", r"\bchannel\s*\d+\b",
]
_CHANNEL_RE = re.compile(
    "|".join(p[:-2] + r"(?![A-Za-z0-9])" if p.endswith(r"\b") else p for p in _CHANNEL_PATTERNS),
    re.IGNORECASE,
)
# 连续通道名列表（逗号/顿号/空格/和/及 分隔），整体替换为一个中性词，保留句子主干
# 注意：不带前缀的裸数字（如 68、128）不是通道名，不能匹配——只有 EEG/CH/channel 前缀的数字编号才算
# 尾部用 (?![A-Za-z0-9]) 而非 \b：中文（如"和""的"）在 re 中是 \w，\b 在中文相邻时失效
_CHANNEL_ATOM = r"(?:(?:EEG|CH|Channel|channel)\s*)?(?:Fp1|Fp2|AF[3-7]|F[3-8z]|T[3-6]|C[3-4z]|P[3-4z]|O[1-2z]|A[1-2]|M[1-2]|I[1-2])"
_CHANNEL_LIST_RE = re.compile(
    r"\b" + _CHANNEL_ATOM + r"(?:\s*[,，、;；\s]\s*" + _CHANNEL_ATOM + r")*(?![A-Za-z0-9])",
    re.IGNORECASE,
)


def _strip_channel_names(text: str) -> str:
    """强制清除 AI 输出中的通道名（不符合 STYLE RULES 时兜底）。
    直接删除通道名本身并清理残留连接词/标点，不留下'各通道'之类的占位词。
    例如 '两个噪声通道：EEG O2和EEG A2-A1。' → '两个噪声通道。'"""
    if not text:
        return text
    # 1) 连续通道名列表整体删除（含连接逗号/顿号/和/及）
    out = _CHANNEL_LIST_RE.sub("", text)
    # 2) 孤立单个通道名删除（含可选 EEG/CH/channel 前缀）
    out = _CHANNEL_RE.sub("", out)
    # 3) 清理残留（只处理被删通道名留下的碎片，不动正常标点）：
    #    a) 孤立的 EEG/CH/channel 前缀（后跟标点/连接词/破折号/行尾）。
    #       不能用 \b（中文相邻时 \b 失效），改用 (?<![A-Za-z0-9])
    #       后置 lookahead 加上 "和/与/及"：处理 'EEG 和EEG' 这类连接词残留
    out = re.sub(r"(?<![A-Za-z0-9])(?:EEG|CH|Channel|channel)(?=\s*[-—–。.,，、;；:！？!?和与及]|\s*$)", "", out)
    #    b) 孤立的连接词"和/与/及"（前是标点/空格，后是标点/空格/行尾）
    out = re.sub(r"(?<=[：:,，、;；\s])(?:和|与|及|or|and)(?=\s*[-—–。.,，、;；:！？!?\s]|$)", "", out)
    #    c) 破折号碎片 "A2-A1" → "-"
    out = re.sub(r"-{1,3}", "", out)
    #    d) "：。" / "，。" / "、。" → "。"
    out = re.sub(r"[：:，,、;；]\s*[。.]", "。", out)
    #    e) 行尾残留冒号/连接词/空格
    out = re.sub(r"[：:,，、;；\s]+$", "", out)
    # 压缩行内多余空格（不碰换行——避免把 ### 标题与正文合并，导致标题正则误删整段）
    out = re.sub(r"[ \t]+", " ", out)
    return out.strip()


def _norm_for_dedup(s: str) -> str:
    """归一化句子：去所有空白与标点，小写。用于精确去重。"""
    return re.sub(r"[\s\W_]+", "", s).lower()


def _tokens_for_dedup(s: str) -> set:
    """去重用的 token 集合：CJK 按单字、Latin/digit 按词。"""
    toks = set(re.findall(r"[a-z0-9]+", s.lower()))
    toks |= set(re.findall(r"[\u4e00-\u9fff]", s))
    return toks


def _is_near_dup(toks: set, seen: list, jac: float = 0.85) -> bool:
    """与已保留句子中任一高度重叠（Jaccard >= jac）则视为重复。"""
    if not toks:
        return False
    for st in seen:
        if not st:
            continue
        inter = len(toks & st)
        if inter == 0:
            continue
        union = len(toks | st)
        if union and inter / union >= jac:
            return True
    return False


_BAND_WORDS_RE = re.compile(r"\b(alpha|beta|theta|delta|gamma)\b", re.IGNORECASE)


def _num_fact_keys(s: str) -> set:
    """提取句子的「数字事实键」：(数值, 数字前≤2个中文字)。

    '信号质量评分为63.405' → ('63.405', '分为')
    同一事实换说法复读时键相同（如评分出现两遍）；
    不同事实即使同数值键也不同（如 '采样率为500Hz' vs '500Hz采样'），避免误删。
    不用数字后的上下文——后面的评语/比较词会变，反而漏掉真重复。"""
    keys = set()
    for m in re.finditer(r"\d+(?:\.\d+)?", s):
        before = s[max(0, m.start() - 2):m.start()]
        before_cjk = "".join(ch for ch in before if "\u4e00" <= ch <= "\u9fff")
        keys.add((m.group(0), before_cjk))
    return keys


def _is_num_anchored_dup(s: str, seen: list, contain: float = 0.5) -> bool:
    """数字锚定去重：与前面某句共享同一个「数字事实键」且 token 包含度 >= contain 视为重复。

    专门抓模型"同一事实换说法复读"（如 '评分为63.405…' 出现两遍）。
    规避误删：若两句包含【不同】的频段名（alpha/beta/theta/delta/gamma），
    说明是在比较不同频段（如 '是theta的4.1倍' vs '是beta的4.1倍'），不算重复。"""
    keys = _num_fact_keys(s)
    if not keys:
        return False
    toks = _tokens_for_dedup(s)
    bands = set(_BAND_WORDS_RE.findall(s))
    for st_keys, st_toks, st_bands in seen:
        if not (keys & st_keys):
            continue
        if bands and st_bands and bands != st_bands:
            continue  # 不同频段间的同数值比较句，保留
        inter = len(toks & st_toks)
        mn = min(len(toks), len(st_toks))
        if mn and inter / mn >= contain:
            return True
    return False


def _dedup_sentences(text: str) -> str:
    """单档内去重：删除与前面句子归一化相同或高度重叠的重复句，
    防止模型同义复读凑字数。跨段落累计去重，保留段落结构。"""
    if not text:
        return text
    paras = re.split(r"\n{1,}", text)
    out_paras: list = []
    seen_norm: list = []
    seen_toks: list = []
    seen_num: list = []
    for para in paras:
        if not para.strip():
            continue
        raw = re.split(r"(?<=[。！？!?；;])|(?<=\.)(?<!\d\.)(?!\d)", para)
        kept: list = []
        for seg in raw:
            s = seg.strip()
            if not s:
                continue
            norm = _norm_for_dedup(s)
            if norm and norm in seen_norm:
                continue
            toks = _tokens_for_dedup(s)
            if _is_near_dup(toks, seen_toks):
                continue
            if _is_num_anchored_dup(s, seen_num):
                continue
            if norm:
                seen_norm.append(norm)
            seen_toks.append(toks)
            seen_num.append((_num_fact_keys(s), toks, set(_BAND_WORDS_RE.findall(s))))
            kept.append(seg)
        if kept:
            out_paras.append("".join(kept))
    return "\n\n".join(out_paras).strip()


def _dominant_band_from_percent(bp: Dict[str, Any]) -> str | None:
    """从 bandpower_percent 字典找主导频段（数值最高），自动处理 '%' 字符串"""
    best, best_v = None, -1.0
    for k, v in bp.items():
        pv = _pct(v)
        if pv is not None and pv > best_v:
            best_v, best = pv, k
    return best


def _band_pct_display(bp: Dict[str, Any]) -> str:
    """把 bandpower_percent 渲染成 'delta: 12.1%, beta: 58.1%'，自动剥 % 防双 %。全部频段（含 gamma）。"""
    items = []
    for k, v in bp.items():
        p = _pct(v)
        if p is None:
            items.append(f"{k}: {v}")
        else:
            items.append(f"{k}: {p:.1f}%")
    return ", ".join(items)


def _transient_info(a: Dict) -> Dict:
    """提取瞬态活动摘要（level/ratio_pct/channels），缺省为 none。"""
    qd = (a.get("signal_quality") or {}).get("quality_details") or {}
    t  = qd.get("transient_activity") or a.get("transient_activity") or {}
    if not isinstance(t, dict):
        return {"level": "none", "ratio_pct": 0.0, "channels": 0}
    return {
        "level": str(t.get("level") or "none"),
        "ratio_pct": t.get("ratio_pct") or 0.0,
        "channels": t.get("channels") or 0,
    }


def _speculate_situation(a: Dict, lang: str, style: str = "teaching") -> str:
    """根据数据特征「推测」该 EEG 可能呈现的情况。

    - 只有数据存在明确的异常特征时才推测病情方向（谨慎措辞，不做诊断）；
      正常/无异常特征的记录则说明"整体未见明显异常倾向"，不强行关联病情。
    - style: plain（入门大白话）/ teaching（进阶）/ research（研究专业，带数字依据）。
    返回已按界面语言组织好的句子；不支持的风格回退 teaching。
    """
    bp   = a.get("bandpower_percent") or a.get("frequency_analysis", {}).get("bandpower_percent") or {}
    dom  = _dominant_band_from_percent(bp) if bp else None
    fa   = a.get("frequency_analysis") or {}
    peak = _rnd(fa.get("dominant_frequency") or a.get("dominant_frequency"), 2)
    ti   = _transient_info(a)
    tlv  = ti.get("level", "none")
    tr   = ti.get("ratio_pct")
    tr_s = f"{round(float(tr)*100)}%" if isinstance(tr, (int, float)) and tr else ""
    zh   = lang == "zh"

    alpha_pct = _pct(bp.get("alpha")) or 0
    beta_pct  = _pct(bp.get("beta")) or 0
    theta_pct = _pct(bp.get("theta")) or 0
    delta_pct = _pct(bp.get("delta")) or 0
    gamma_pct = _pct(bp.get("gamma")) or 0
    slow_pct  = delta_pct + theta_pct
    has_bp    = any(v > 0 for v in (alpha_pct, beta_pct, theta_pct, delta_pct, gamma_pct))

    def _t(research_txt: str, teaching_txt: str, plain_txt: str) -> str:
        if style == "research":
            return research_txt
        if style == "plain":
            return plain_txt
        return teaching_txt

    def _h(zh_r, zh_t, zh_p, en_r, en_t, en_p):
        return _t(zh_r, zh_t, zh_p) if zh else _t(en_r, en_t, en_p)

    # ── ① 病情方向：仅在明确的异常特征出现时推测 ──
    hints: list = []

    # R1 瞬态尖样活动 → 癫痫样活动相关
    if tlv in ("high", "moderate"):
        tr_zh = f"{tr_s}的" if tr_s else "相当比例的"
        tr_en = f"{tr_s} of " if tr_s else "a notable fraction of "
        hints.append(_h(
            f"存在 {tr_zh}高幅瞬态尖样活动，这类模式通常与癫痫样放电相关，常见于痫样活动相关情况",
            "记录中较频繁的高幅瞬态尖样波动，通常与癫痫样放电模式相关，常见于痫样活动相关情况",
            "记录里的这种一阵阵的尖状波动，通常和一类脑部异常放电（癫痫样活动）的情况有关",
            f"there is {tr_en}high-amplitude transient spike-like activity, a pattern typically associated "
            f"with epileptiform discharges, commonly seen with epileptiform activity",
            "the fairly frequent high-amplitude transient spike-like deflections are typically associated "
            "with epileptiform discharge patterns, commonly seen with epileptiform activity",
            "the recurring sharp spikes in this recording are usually linked to a type "
            "of abnormal brain discharge (epileptiform activity)"))

    # R2 弥漫性慢波为主、α 明显压低 → 代谢性脑病/神经退行
    if dom in ("delta", "theta", "Delta", "Theta") or (slow_pct >= 45 and alpha_pct < slow_pct * 0.6):
        hints.append(_h(
            f"弥漫性慢波为主（δ+θ 约 {round(slow_pct)}%）且 α 明显减少，这类谱形通常与脑功能弥漫性改变相关，"
            f"如代谢性脑病或神经退行性疾病的早期弥漫性异常",
            "以弥漫性慢波为主且 α 活动明显减少的谱形，通常与脑功能弥漫性改变相关，"
            "如代谢性脑病或神经退行性疾病的早期弥漫性异常",
            "这种以慢波为主的图形，也常和大脑整体活动变慢的一些情况有关，比如代谢紊乱或神经退行性疾病的早期表现",
            f"diffuse slow-wave dominance (delta+theta ≈ {round(slow_pct)}%) with markedly reduced alpha is "
            f"typically associated with diffuse cerebral changes, such as metabolic encephalopathy or early "
            f"diffuse abnormalities in neurodegenerative disease",
            "a diffusely slow-wave-dominant profile with markedly reduced alpha is typically associated "
            "with diffuse cerebral changes, such as metabolic encephalopathy or early "
            "diffuse abnormalities in neurodegenerative disease",
            "a mostly-slow pattern is also commonly linked to conditions where overall brain activity "
            "slows down, such as metabolic disturbances or early signs of neurodegenerative disease"))

    # R3 θ 明显突出（非慢波主导时）→ 注意功能相关
    if len(hints) < 2 and theta_pct >= 30 and delta_pct < 35 and dom not in ("delta", "theta", "Delta", "Theta"):
        hints.append(_h(
            f"θ 活动明显增多（约 {round(theta_pct)}%），常与注意功能相关情况（如注意缺陷时 θ 增高）或困倦早期状态有关",
            f"θ 活动明显增多（约 {round(theta_pct)}%），常与注意功能相关情况（如注意缺陷时 θ 增高）或困倦早期状态有关",
            "这种偏慢一点的脑波（θ 波）明显比较多时，常和走神、犯困或者注意力方面的情况有关",
            f"the markedly increased theta activity (≈{round(theta_pct)}%) commonly relates to "
            f"attention-related conditions (e.g., elevated theta in attention deficits) or early drowsiness",
            f"the markedly increased theta activity (≈{round(theta_pct)}%) commonly relates to "
            f"attention-related conditions (e.g., elevated theta in attention deficits) or early drowsiness",
            "when this slower brainwave (theta) is clearly prominent, it often relates to "
            "daydreaming, drowsiness, or attention-related situations"))

    # R7b α 峰值频率偏慢 → 认知功能下降相关
    if len(hints) < 2 and isinstance(peak, (int, float)) and peak < 8.6 and (dom in ("alpha", "Alpha") or alpha_pct > 20):
        hints.append(_h(
            f"α 峰值频率偏慢（约 {peak} Hz，成人 α 峰多位于 10 Hz 附近），这类特征常见于认知功能下降相关疾病（如阿尔茨海默病早期）",
            f"α 峰值频率偏慢（约 {peak} Hz，成人 α 峰多位于 10 Hz 附近），这类特征常见于认知功能下降相关疾病（如阿尔茨海默病早期）",
            f"这种偏慢的脑波频率（约 {peak} Hz），也常和思考反应变慢一类的情况有关",
            f"the alpha peak is slow (≈{peak} Hz; adult alpha peaks usually near 10 Hz), a feature commonly "
            f"seen in cognitive-decline-related conditions (e.g., early Alzheimer's disease)",
            f"the alpha peak is slow (≈{peak} Hz; adult alpha peaks usually near 10 Hz), a feature commonly "
            f"seen in cognitive-decline-related conditions (e.g., early Alzheimer's disease)",
            f"the somewhat slow brainwave frequency (≈{peak} Hz) also relates to conditions involving "
            f"slower thinking and response"))

    # ── ② 生理状态推测（按档位给出具体、丰富的状态推测） ──
    if dom in ("alpha", "Alpha"):
        pct_part = f"（约占 {round(alpha_pct)}%）" if alpha_pct else ""
        pct_en = f" (≈{round(alpha_pct)}%)" if alpha_pct else ""
        state = _h(
            (f"α 节律主导{pct_part}，这是典型静息态的标志，通常对应放松清醒（闭眼静息）状态；"
             f"结合波形平稳，推测这段记录更可能来自安静放松、闭目休息的情境，而不是紧张或专注用脑的情境"),
            ("以 α 节律为主导且波形平稳，这种组合通常出现在清醒、放松、安静闭眼的状态下；"
             "α 波增多往往意味着思维放松、没有紧张任务，推测记录者当时处于放松清醒的静息状态"),
            "这种以中速节律为主、波形平稳的图形，通常可能来自清醒且放松的人，比如安静地闭着眼睛休息",
            (f"alpha dominates{pct_en}, a hallmark of resting state, typically corresponding to relaxed "
             f"wakefulness (eyes-closed resting); with a steady waveform, this recording more likely comes from "
             f"a quiet, eyes-closed rest situation than a tense or focused one"),
            ("With alpha as the dominant rhythm and a steady waveform, this combination typically appears during "
             "wakeful, relaxed, quiet eyes-closed states; increased alpha usually means relaxed, unfocused thinking"),
            "This kind of calm, steady brainwave pattern usually comes from someone who is awake and relaxed, "
            "such as sitting quietly with eyes closed",
        )
    elif dom in ("beta", "Beta"):
        pct_part = f"（约占 {round(beta_pct)}%）" if beta_pct else ""
        pct_en = f" (≈{round(beta_pct)}%)" if beta_pct else ""
        state = _h(
            (f"β 快波主导{pct_part}，1/f 样谱形通常更接近清醒警觉或主动认知加工状态，"
             f"推测这段记录更可能对应思维活跃、注意力集中的情境"),
            "以 β 快速节律为主导，通常对应清醒警觉、思维活跃或注意力集中的状态",
            "这种以快速节律为主的图形，通常可能来自清醒、警觉或正在专注思考的人",
            (f"beta dominance{pct_en} with a 1/f-like profile is closer to wakeful alertness or active cognitive "
             f"processing; this recording more likely reflects a state of active thinking or focused attention"),
            "With fast beta as the dominant rhythm, this typically corresponds to wakeful alertness, active "
            "thinking, or focused attention",
            "This kind of fast brainwave pattern usually comes from someone who is awake, alert, or concentrating",
        )
    elif dom in ("delta", "theta", "Delta", "Theta"):
        slow_part = f"（δ+θ 约 {round(slow_pct)}%）" if slow_pct else ""
        slow_en = f" (delta+theta ≈ {round(slow_pct)}%)" if slow_pct else ""
        state = _h(
            (f"δ/θ 慢波主导{slow_part}，通常对应困倦、浅睡或深度睡眠等低唤醒状态"),
            "以慢波（δ/θ）为主导，通常对应困倦、浅睡或深度睡眠等低唤醒状态",
            "这种以慢波为主的图形，通常可能出现在很困倦或正在睡眠的人身上",
            (f"delta/theta slow-wave dominance{slow_en} typically corresponds to low-arousal states such as "
             f"drowsiness, light sleep, or deep sleep"),
            "With slow waves (delta/theta) dominant, this typically corresponds to low-arousal states such as "
            "drowsiness, light sleep, or deep sleep",
            "This mostly-slow brainwave pattern usually appears in someone who is very drowsy or asleep",
        )
    elif dom in ("gamma", "Gamma"):
        pct_part = f"（约占 {round(gamma_pct)}%）" if gamma_pct else ""
        pct_en = f" (≈{round(gamma_pct)}%)" if gamma_pct else ""
        state = _h(
            (f"γ 高频活动主导{pct_part}，通常与主动认知加工有关，也可能包含肌肉伪迹，"
             f"推测记录时可能处于高强度脑力活动状态，或存在肌电污染"),
            "以 γ 高频活动为主导，通常与主动认知加工有关，也可能包含肌肉伪迹",
            "这种最高频的脑波比较多时，通常可能和大脑高强度运转或肌肉紧张有关",
            (f"gamma dominance{pct_en} usually relates to active cognitive processing and may include muscle "
             f"artifact; this may reflect intense mental activity or muscle contamination"),
            "With gamma activity dominant, this may relate to active cognitive processing, and may include "
            "muscle artifact",
            "When these highest-frequency waves are prominent, it may relate to intense mental activity or "
            "muscle tension",
        )
    else:
        state = _h(
            "各频段较为均衡，无单一突出频段，通常对应普通清醒状态下的复杂脑活动",
            "各频段较为均衡，通常对应普通清醒状态下的复杂脑活动",
            "几种脑波都比较平均时，通常对应普通清醒状态下的复杂脑活动",
            "a balanced spectrum with no single dominant band typically corresponds to complex brain activity "
            "in ordinary wakefulness",
            "With a balanced spectrum, this typically corresponds to complex brain activity in ordinary wakefulness",
            "When brainwaves are fairly balanced, it usually corresponds to complex brain activity in ordinary "
            "wakefulness",
        )

    # ── ③ 组装 ──
    # 保证 state 以句号结尾，避免与后续内容粘连（如"休息 整体未见"缺标点）
    _end_punct = (lambda s: s if s.endswith(("。", "；", "！", "？", "：", "，")) else s + "。") if zh else \
                 (lambda s: s if s.endswith((".", ";", "!", "?", ":", ",")) else s + ".")
    _sep = "" if zh else " "
    state = _end_punct(state)
    if hints:
        disease = "；".join(hints)
        return state + _sep + disease + "。"
    # 无明确异常 → 正常说明，不强行关联病情
    if gamma_pct >= 20:
        normal = ("γ 频段偏高，通常与肌电伪迹或高认知负荷有关，需先排除头皮或肌肉紧张造成的干扰；"
                  "除此之外整体未见明显异常倾向。"
                  if zh else
                  "The gamma band is relatively high, usually related to muscle artifact or high cognitive "
                  "load; after excluding scalp or muscle-tension contamination, no obvious abnormal tendency "
                  "is otherwise seen.")
    elif alpha_pct < 12 and has_bp:
        normal = ("α 活动偏低，可见于老年人或觉醒度降低等情况；整体未见明显异常倾向。"
                  if zh else
                  "Alpha activity is low, which can be seen in older adults or reduced arousal; overall, "
                  "no obvious abnormal tendency is seen.")
    else:
        normal = ("整体未见明显异常倾向。" if zh else "Overall, no obvious abnormal tendency is seen.")
    return state + _sep + normal


def template_beginner(a: Dict, lang: str) -> str:
    q     = _quality_level(a.get("signal_quality_score"), lang)
    n     = len(a.get("noisy_channels") or [])
    bp    = a.get("bandpower_percent") or a.get("frequency_analysis", {}).get("bandpower_percent") or {}
    dom   = _dominant_band_from_percent(bp) if bp else None
    ch_n  = a.get("channel_count")
    dur   = _fmt_duration(a, lang)
    dom_plain = _band_plain_name(dom, lang)
    pct_num   = round(_pct(bp[dom])) if dom and bp.get(dom) is not None else None
    n_s   = ("没有明显不清晰的区域" if lang == "zh" else "no noticeably unclear areas") if n == 0 else (
        f"有 {n} 个区域读数较不清晰" if lang == "zh" else f"{n} area(s) are harder to read")
    # 入门档正文只做事实描述，"推测可能的情况"作为专门段落追加，
    # 避免与 _speculate_situation 重复（同一段话既出现在正文又出现在推测段 = 凑数）。
    if lang == "en":
        return (
            f"This recording lasts about {dur or 'a short period'} and its main activity is {dom_plain}"
            + (f", accounting for about {pct_num}% of total activity" if pct_num is not None else "")
            + f". Signal clarity is {q}"
            + (f"; {n_s}." if n > 0 else "; readings across all positions are clear.")
            + "\n\nInference: " + _speculate_situation(a, "en", "plain")
        )
    if lang == "zh":
        return (
            f"这份记录时长约 {dur or '一小段时间'}，主要活动属于{dom_plain}"
            + (f"，约占全部活动的 {pct_num}%" if pct_num is not None else "")
            + f"。信号清晰度为{q}"
            + (f"，{n_s}。" if n > 0 else "，各位置的读数都比较清楚。")
            + "\n\n推测可能的情况：" + _speculate_situation(a, "zh", "plain")
        )
    # fallback English for unsupported languages
    return (
        f"This recording lasts about {dur or 'a short period'} and its main activity is {dom_plain}"
        + (f", accounting for about {pct_num}% of total activity" if pct_num is not None else "")
        + f". Signal clarity is {q}"
        + (f"; {n_s}." if n > 0 else "; readings across all positions are clear.")
        + "\n\nInference: " + _speculate_situation(a, "en", "plain")
    )


def template_student(a: Dict, lang: str) -> str:
    bp   = a.get("bandpower_percent") or a.get("frequency_analysis", {}).get("bandpower_percent") or {}
    # 主导频段（百分比最高的频段，自动处理 '%' 字符串）
    dom_band = _dominant_band_from_percent(bp) if bp else None
    ns   = a.get("noisy_channels") or []
    n_n  = len(ns)
    n_s  = ", ".join(ns[:3]) if ns else ("none" if lang == "en" else ("无" if lang == "zh" else "none"))
    q    = _quality_level(a.get("signal_quality_score"), lang)
    ch_n = a.get("channel_count")
    sr   = a.get("sampling_rate")
    dur  = _fmt_duration(a, lang)
    bp_s = _band_pct_display(bp)
    dom_str = (f"alpha/theta/beta range" if not dom_band else f"{dom_band} band") if lang == "en" else (f"{dom_band} 频段" if dom_band else "未知频段")
    if lang == "en":
        return (
            f"Recording overview: {ch_n} channels, SR={sr} Hz, duration={dur}. "
            f"Overall signal readability: {q}.\n\n"
            f"Spectral distribution across the recording (percent): {bp_s}. "
            f"The dominant band is the {dom_str}. "
            f"About {n_n} channel(s) appear noisier than the rest"
            + (f" (e.g., {n_s})" if ns else "")
            + ", which can affect local readings.\n\n"
            f"Possible interpretation: {_speculate_situation(a, 'en', 'teaching')}"
        )
    if lang == "zh":
        return (
            f"这份记录共有 {ch_n} 个通道，采样率 {sr} Hz，时长 {dur}。"
            f"整体信号可读性：{q}。\n\n"
            f"频段功率分布（百分比）：{bp_s}。"
            f"主导频段是 {dom_str}。"
            f"约 {n_n} 个通道信号偏弱"
            + (f"（如 {n_s}）" if ns else "")
            + "，可能影响局部数据的可信度。\n\n"
            f"推测可能的情况：{_speculate_situation(a, 'zh', 'teaching')}"
        )
    # fallback English
    return (
        f"Recording overview: {ch_n} channels, SR={sr} Hz, duration={dur}. "
        f"Overall signal readability: {q}.\n\n"
        f"Spectral distribution across the recording (percent): {bp_s}. "
        f"The dominant band is the {dom_str}. "
        f"About {n_n} channel(s) appear noisier than the rest"
        + (f" (e.g., {n_s})" if ns else "")
        + ", which can affect local readings.\n\n"
        f"Possible interpretation: {_speculate_situation(a, 'en', 'teaching')}"
    )


def template_research(a: Dict, lang: str) -> str:
    bp   = a.get("bandpower_percent") or a.get("frequency_analysis", {}).get("bandpower_percent") or {}
    dom_band = _dominant_band_from_percent(bp) if bp else None
    ns   = a.get("noisy_channels") or []
    n_s  = ", ".join(ns[:3]) if ns else ("none" if lang == "en" else ("无" if lang == "zh" else "none"))
    n_n  = len(ns)
    ch_n = a.get("channel_count")
    sr   = a.get("sampling_rate")
    dur  = _fmt_duration(a, lang)
    sq   = a.get("signal_quality_score")
    sq3  = _rnd(sq, 3)
    bp_s = _band_pct_display(bp)
    dom_str = f"{dom_band}" if dom_band else ("unknown" if lang == "en" else ("未知" if lang == "zh" else "unknown"))
    q_label = _quality_level(sq, lang)
    if lang == "en":
        return (
            f"Dataset: {ch_n} channels, SR={sr} Hz, duration={dur}; quality score {sq3}/100 ({q_label}).\n\n"
            f"The spectrum is dominated by the {dom_str} band. Relative bandpower percentages should be "
            f"interpreted alongside absolute power and cross-band ratios; relying on a single percentage can be misleading "
            f"because the underlying PSD computation (Welch method, window length and overlap) influences the numerical result. "
            f"Across all channels, {n_n} channel(s) fall below the noise tolerance threshold, and per-channel analyses on "
            f"those channels should be treated as unreliable. "
            f"Overall recording quality ({q_label}) is sufficient to support dataset-level spectral conclusions "
            f"(dominant rhythm, broad bandpower distribution), but limits analyses that require fine-grained time-frequency "
            f"resolution, single-trial peak alignment, or source localization. "
            f"At SR={sr} Hz, frequencies up to {int(sr/2) if isinstance(sr,(int,float)) else 'sr/2'} Hz (Nyquist) are recoverable; "
            f"any conclusions regarding very high-frequency activity should account for this ceiling.\n\n"
            f"Inference: {_speculate_situation(a, 'en', 'research')}"
        )
    if lang == "zh":
        return (
            f"数据集：{ch_n} 个通道，采样率 {sr} Hz，时长 {dur}；"
            f"信号质量评分 {sq3}/100（{q_label}）。\n\n"
            f"频谱以{dom_str}为主导。解读时应结合各频段的绝对功率与跨频段比值，"
            f"而非依赖单一百分比——因为 PSD 的计算方式（Welch 方法、窗长、重叠率）"
            f"会直接影响数值结果。全部通道中 {n_n} 个低于噪声容忍度阈值，"
            f"针对这些通道的逐通道分析应视为不可靠。"
            f"整体录制质量（{q_label}）足以支撑数据集级频谱结论"
            f"（主导节律、整体频段功率分布），但限制了需要精细时频分辨率、"
            f"单试次峰值对齐或溯源定位的分析。"
            f"采样率 {sr} Hz 对应奈奎斯特上限约 {int(sr/2) if isinstance(sr,(int,float)) else 'sr/2'} Hz，"
            f"任何针对极高频活动的结论都应考虑此上限。\n\n"
            f"推测：{_speculate_situation(a, 'zh', 'research')}"
        )
    # fallback English
    return (
        f"Dataset: {ch_n} channels, SR={sr} Hz, duration={dur}; quality score {sq3}/100 ({q_label}).\n\n"
        f"The spectrum is dominated by the {dom_str} band. Relative bandpower percentages should be "
        f"interpreted alongside absolute power and cross-band ratios; relying on a single percentage can be misleading "
        f"because the underlying PSD computation (Welch method, window length and overlap) influences the numerical result. "
        f"Across all channels, {n_n} channel(s) fall below the noise tolerance threshold, and per-channel analyses on "
        f"those channels should be treated as unreliable. "
        f"Overall recording quality ({q_label}) is sufficient to support dataset-level spectral conclusions "
        f"(dominant rhythm, broad bandpower distribution), but limits analyses that require fine-grained time-frequency "
        f"resolution, single-trial peak alignment, or source localization. "
        f"At SR={sr} Hz, frequencies up to {int(sr/2) if isinstance(sr,(int,float)) else 'sr/2'} Hz (Nyquist) are recoverable; "
        f"any conclusions regarding very high-frequency activity should account for this ceiling.\n\n"
        f"Inference: {_speculate_situation(a, 'en', 'research')}"
    )


def _rnd(v, dp: int = 3):
    """数值四舍五入到 dp 位小数；非数值原样返回（避免 AI 把 89.4021072898585 这类超长小数抄进文案）"""
    if isinstance(v, (int, float)):
        return round(float(v), dp)
    return v


def _parse_duration_seconds(dur) -> float | None:
    """从各种时长为字符串里解析出总秒数。返回 None 表示无法解析。
    覆盖 "2分3秒"/"0分20秒"/"20秒"/"3分02秒"/"2m 3s"/"2:03"/"123.5" 等常见格式。"""
    if isinstance(dur, (int, float)):
        return float(dur)
    if not isinstance(dur, str):
        return None
    s = dur.strip().replace(" ", "")
    # "X分Y秒" / "XmYs" / "Xmin Ysec"
    m = re.search(r"(?:(\d+(?:\.\d+)?)\s*(?:分|m(?:in)?)[：:]?\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec)?)", s)
    if m:
        minutes = float(m.group(1)) if m.group(1) else 0.0
        return minutes * 60 + float(m.group(2))
    # "mm:ss" / "mm:ss.x"
    m = re.match(r"^(\d+):(\d+(?:\.\d+)?)$", s)
    if m:
        return float(m.group(1)) * 60 + float(m.group(2))
    # 纯数字（可带小数/负号）
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _summarize_for_ai(a: Dict) -> Dict:
    """
    只保留 AI 解释需要的「派生标量指标」，剔除所有数组 / 波形 / 时间序列数据。
    目的：防止把过大的 analysis JSON 直接塞给 qwen2.5-7b（32K 上下文），
    触发 OpenRouter 的 "400 input length too long" 错误。
    """
    sq       = a.get("signal_quality") or {}
    fa       = a.get("frequency_analysis") or {}
    overview = a.get("overview") or {}
    literacy = a.get("literacy_scores") or a.get("eeg_literacy_scores") or {}
    qd       = sq.get("quality_details") or {}
    trans    = qd.get("transient_activity") or {}

    _dur = (overview.get("recording_duration_seconds") or a.get("recording_duration_seconds")
            or a.get("duration_seconds")
            or _parse_duration_seconds(overview.get("duration"))
            or _parse_duration_seconds(a.get("duration")))

    # ── 预计算所有「派生量」，禁止模型自己做算术 ─────────────────────────
    # 背景：research 层原本要求模型写出「alpha 是 theta 的 4.1 倍」这类跨频段比值。
    # qwen2.5-7b 这类小模型做多位数除法/加法时经常算错（算式幻觉），
    # 于是这里把派生量在 Python 侧算准后直接放进 JSON，并在 prompt 中
    # 明确要求「只能照抄这些字段，不得自行乘除加减」。
    _abs_raw = (fa.get("average_bandpower") or a.get("average_bandpower") or {})
    abs_bp = {}
    for _k, _v in _abs_raw.items():
        _fv = _pct(_v)
        if _fv is not None and _fv > 0:
            abs_bp[str(_k).lower()] = float(_fv)

    # 跨频段倍数：以绝对功率最大的频段（= 主导频段）为分子
    band_ratios = {}
    if len(abs_bp) >= 2:
        _dom = max(abs_bp, key=lambda kk: abs_bp[kk])
        for _k, _v in abs_bp.items():
            if _k == _dom:
                continue
            band_ratios["%s_over_%s" % (_dom, _k)] = round(abs_bp[_dom] / _v, 2)

    # 频段百分比合计（用于「占比是否自洽」这类判断，避免模型自己加 4 个数）
    _bp_pct = (fa.get("bandpower_percent") or a.get("bandpower_percent") or {})
    _pct_vals = [v for v in (_pct(x) for x in _bp_pct.values()) if v is not None]

    return {
        "channel_count":            overview.get("channel_count") or a.get("channel_count"),
        "sampling_rate":            overview.get("sampling_rate") or a.get("sampling_rate"),
        "duration":                 overview.get("duration") or a.get("duration"),
        "duration_seconds":         _dur,
        # 频率分辨率 = 1 / 记录时长（秒）。模型自己做 1/182 这类除法很容易出错，
        # 也可能把「预览窗口 10 秒」误当成记录时长 ⇒ 一律由后端算好。
        "frequency_resolution_hz":  (round(1.0 / float(_dur), 4) if isinstance(_dur, (int, float)) and float(_dur) > 0 else None),
        "signal_quality_score":     _rnd(sq.get("signal_quality_score") or a.get("signal_quality_score"), 3),
        # 只保留前若干项，避免超长通道列表
        "noisy_channels":           (sq.get("noisy_channels") or a.get("noisy_channels") or [])[:20],
        "possible_artifacts":       (sq.get("possible_artifacts") or a.get("possible_artifacts") or [])[:10],
        "clipping_detected":        sq.get("clipping_detected") or a.get("clipping_detected"),
        "missing_data":             sq.get("missing_data") or a.get("missing_data"),
        "high_frequency_noise":     sq.get("high_frequency_noise") or a.get("high_frequency_noise"),
        # 客观信号特征：异常值比例 + 瞬态尖峰样活动 + 最大幅度（用于客观描述，不做疾病推断）
        "outlier_percentage":       qd.get("outlier_percentage") or _rnd(a.get("outlier_percentage"), 3),
        "max_amplitude_uv":         trans.get("max_amplitude_uv") or a.get("max_amplitude_uv"),
        "transient_activity":       {
            "level": trans.get("level") or "none",
            "ratio_pct": trans.get("ratio_pct") or 0.0,
            "channels": trans.get("channels") or 0,
        } if trans else None,
        # 频段只用聚合百分比 / 均值（已经是 5 个 key 的字典），丢弃逐通道 bandpower 数组；数值顺手截位
        "bandpower_percent":        {k: _rnd(v, 1) for k, v in _bp_pct.items()},
        "average_bandpower":        {k: _rnd(v, 2) for k, v in _abs_raw.items()},
        # 预计算派生量（模型只能引用，不得自算）
        "bandpower_ratios":         band_ratios or None,
        "bandpower_percent_sum":    (round(sum(_pct_vals), 1) if _pct_vals else None),
        "dominant_frequency":       _rnd(fa.get("dominant_frequency") or a.get("dominant_frequency"), 2),
        "dominant_band":            fa.get("dominant_band") or a.get("dominant_band"),
        "dominant_band_abs_power":  (round(abs_bp.get(str(fa.get("dominant_band") or "").lower()), 2)
                                     if abs_bp and fa.get("dominant_band") else None),
        "literacy_scores":          {k: _rnd(v, 3) if isinstance(v, (int, float)) else v for k, v in literacy.items()},
        "file_size_mb":             _rnd(a.get("file_size_mb"), 2),
        "what_this_data_cannot_tell": a.get("what_this_data_cannot_tell"),
    }


def _build_prompt(a: Dict, level: str, lang: str) -> str:
    # 只发送精简后的派生指标，避免超出模型上下文窗口
    prompt_data = _summarize_for_ai(a)
    payload     = json.dumps(to_jsonable(prompt_data), ensure_ascii=False, indent=2)

    # 安全网：硬性限制发给模型的内容长度（qwen2.5-7b 上下文约 32K token ≈ 128K 字符，
    # 留出充裕余量给指令文本）。正常精简后远低于此值，这里仅作兜底。
    MAX_PROMPT_CHARS = 12000
    if len(payload) > MAX_PROMPT_CHARS:
        payload = payload[:MAX_PROMPT_CHARS] + "\n... [truncated: remaining metrics omitted]"
    output_lang  = LANG_NAME_MAP.get(lang, "English")
    boundary     = (
        "CRITICAL BOUNDARIES - You MUST follow these rules:\n"
        "1. NEVER give THIS recording a medical diagnosis, a disease label, treatment advice, or a normal/abnormal verdict. "
        "However, you MAY mention, in cautious educational terms, which disease/condition categories such patterns are "
        "typically associated with in the medical and teaching literature — e.g. 'transient spike-like discharges are "
        "patterns commonly studied in the context of epileptiform activity and epilepsy', 'diffuse slow-wave activity is "
        "often associated with metabolic encephalopathy or early neurodegenerative changes', 'a slowed "
        "alpha peak is commonly discussed in cognitive decline (e.g., early Alzheimer's disease)'. "
        "Always frame such mentions as general background knowledge ('typically / commonly / may be associated with'), "
        "NEVER as a statement that this specific recording belongs to a patient with that condition. "
        "CRITICAL: only mention a disease/condition when the JSON actually contains the corresponding feature "
        "(spike-like transient activity, diffuse slow-wave dominance with reduced alpha, or a slowed alpha peak). "
        "For recordings without such features, do NOT invent or force a medical interpretation; simply state that "
        "the recording shows no obvious abnormal tendency.\n"
        "2. You MUST interpret what the brainwave pattern typically means in cautious, educational terms. "
        "For example: 'fast-wave (beta) dominant activity is commonly associated with wakefulness, alertness, or active thinking'; "
        "'alpha-dominant activity often accompanies relaxed wakefulness, typically with eyes closed'; "
        "'slow-wave (delta/theta) dominance is more typical of drowsiness or deep sleep'. "
        "ALWAYS phrase such statements as general physiological correlates with 'typically / commonly / may be associated with' — "
        "NEVER state what THIS specific person was feeling, thinking, or doing, and NEVER diagnose or judge the recording as normal/abnormal.\n"
        "2b. If the JSON contains 'transient_activity' with level 'mild'/'moderate'/'high', or a 'possible_artifacts' entry "
        "mentioning 'Transient spike-like activity', you MUST describe it as an objective signal feature: e.g. "
        "'the recording contains frequent high-amplitude transient spike-like deflections (~X% of samples across N/M channels)'. "
        "After describing it objectively, you MAY cautiously speculate what such a pattern typically reflects in educational terms, "
        "e.g. 'high-amplitude transient spike-like discharges are patterns commonly studied in the context of epileptiform activity "
        "and epilepsy' — always phrased as a general correlate with "
        "'typically / commonly / may be associated with', never as a statement about this specific recording being abnormal. "
        "NEVER use the word 'seizure' or 'epilepsy' as a label for THIS recording; you may only mention such terms as generic "
        "background knowledge of what researchers study, never as a verdict on this data.\n"
        "3. NEVER suggest what the user should do based on EEG data (no lifestyle, medication, or therapy advice).\n"
        "4. NEVER claim to detect the actual emotions, attention levels, cognitive states, personality traits, or intelligence of the person who was recorded.\n"
        "5. ALWAYS use cautious language (e.g., 'typically associated with', 'commonly seen in', 'may reflect') when describing patterns.\n"
        "5b. NEVER use certainty words that assert a definite fact or 100% guarantee: banned — 'certainly', 'definitely', 'absolutely', '100%', 'guaranteed', 'proves', 'undoubtedly', 'always', 'never fails'. "
        "Instead ALWAYS hedge with probabilistic words: 'may', 'might', 'could', 'possibly', 'probably', 'usually', 'often', 'generally', 'tends to', 'likely'. "
        "For example write 'this pattern may reflect relaxed wakefulness' — NEVER 'this pattern definitely reflects relaxed wakefulness'.\n"
        "5c. 中文禁止使用肯定/绝对化措辞：禁用'肯定'、'绝对'、'百分之百'、'100%'、'一定'、'必然'、'必定'、'毫无疑问'、'显然就是'、'确凿'、'肯定无疑'等。"
        "一律使用推测性/概率性措辞：'可能'、'大概'、'或许'、'往往'、'通常'、'一般'、'倾向于'、'有较大可能'、'推测'。"
        "例如写'这种模式可能反映放松状态'，绝不写'这种模式绝对反映了放松状态'。\n"
        "6. This is for EEG literacy, education, and accessibility ONLY.\n"
        "7. Do NOT add ANY disclaimer, caveat, or hedging clause about medical/diagnostic limits — not at the end, not mid-sentence, not anywhere. FORBIDDEN examples: 'this does not mean the recording shows epilepsy/seizure', 'this cannot be used to diagnose', 'this is not a substitute for professional medical advice', 'consult a doctor', 'for reference only'. The website already shows limitation notices as a separate module, so your explanation must contain ZERO disclaimer sentences. Interpret the data educationally and move on.\n"
        "7b. 中文同样禁止在解释里写任何免责/兜底句（无论句尾还是句中），例如'但这并不意味着该记录存在癫痫'、'不能替代医学诊断'、'仅供参考'、'建议咨询医生'等。网站的免责声明是独立模块，解释段落里一律不要出现这类话。\n"
        "7c. ALSO never state that noise, artifacts, baseline drift, or data quality limitations 'may affect the accuracy/reliability of subsequent analysis' or similar quality-caveat sentences. You may DESCRIBE the noise/artifact objectively (e.g. 'several channels are noisy'), but do NOT add the follow-up clause that it affects analysis accuracy — that belongs to the separate limitation module. FORBIDDEN: 'these noise and baseline drift may affect the accuracy of subsequent analysis', 'this may affect data accuracy', 'analysis should be considered unreliable'.\n"
        "7d. 中文同样禁止写'噪声/伪影/基线漂移可能影响后续分析的准确性'这类质量限制句。可以客观描述噪声/伪影本身（如'存在3个噪声通道'），但不要追加'可能影响准确性/可靠性/应视为不可靠'这类话，那属于独立限制模块。禁止示例：'这些噪声和基线漂移可能会影响后续分析的准确性'、'这可能会影响数据的准确性'、'逐通道分析应视为不可靠'、'存在可信度上的限制'。\n"
        "8. NEVER list individual channel names (e.g., 'EEG 001, EEG 002, ...'). Refer to them collectively as 'the channels' or 'the recording'.\n"
        "9. NEVER pad the explanation with channel lists, sampling-rate restatements, or parameter dumps. Focus on INTERPRETATION and ANALYSIS.\n"
        "10. NEVER write meta or framing sentences such as 'The following is an analysis of this recording', "
        "'This report...', '以下/本文/本报告是对…的分析/介绍/总结', '综上所述', '总之', '总体来看', "
        "or closing invitations like '希望这份分析能帮助您' / '如需更多信息请咨询'. Output ONLY the explanation itself.\n"
        "11. EVERY sentence must add new information grounded in the JSON. Never repeat an earlier point in "
        "different words; a sentence that merely restates a parameter or an earlier statement is padding and must be removed. "
        "Cover ALL of the required items listed in your task below — do not stop early. "
        "Completeness is as important as conciseness.\n"
        "12. RECORDING LENGTH: whenever you mention how long the recording is, use the exact number in "
        "'duration_seconds' from the JSON (e.g. 182) — never 10, 20, or any preview-window length, "
        "and never a value you inferred. 'duration' is the human-readable form of the same value.\n"
        "12b. NEVER do your own arithmetic. Every derived number you may need is PRE-COMPUTED in the JSON: "
        "'bandpower_ratios' (cross-band power multiples of the dominant band, keyed like '<band>_over_<band>'), "
        "'frequency_resolution_hz' (= 1 / duration_seconds), 'bandpower_percent_sum', and "
        "'dominant_band_abs_power'. Quote those fields VERBATIM. Do NOT multiply, divide, add, subtract, "
        "average, or otherwise re-derive any number yourself — not even 'about half'. "
        "If the number you want is not in the JSON, describe it qualitatively or omit it instead of computing it. "
        "When you phrase a ratio, insert the ACTUAL value from bandpower_ratios — never a number you invented "
        "and never any example number that appears in these instructions.\n"
        "12c. 中文同样禁止自行做算术。所有派生数值（跨频段倍数 bandpower_ratios、频率分辨率 frequency_resolution_hz、"
        "频段百分比合计 bandpower_percent_sum、主导频段绝对功率 dominant_band_abs_power）都已在 JSON 中预先算好，"
        "必须原样引用，不得自行乘除加减、不得重新推算、不得估算。JSON 里没有的数就不要写，改成定性描述。\n"
        "13. VALUE OVER FORM: this explanation must be genuinely USEFUL to the reader, not a parameter dump. "
        "Do not merely restate JSON numbers; interpret what they MEAN for this recording. Every tier must: "
        "(a) state the single most important observation about this recording (what stands out most, with its real number); "
        "(b) explain what that observation implies (physiological correlate, quality caveat, or analysis limitation — in cautious educational language); "
        "(c) end with ONE concrete takeaway sentence (what the reader should understand about this recording). "
        "A sentence that only repeats a number without any interpretation is padding and must be rewritten or deleted. "
        "Aim for substance: shorter but insightful beats longer but hollow.\n"
    )
    sq = safe_float(a.get("signal_quality_score", 100), 100)
    uncertainty = ""
    if sq < 50:
        uncertainty = (
            "IMPORTANT - Low Data Quality Warning:\n"
            "Signal quality is below 50/100. The data may be too noisy for reliable interpretation.\n"
            "You MUST begin your explanation by stating this uncertainty clearly. "
            "Suggest that better quality recordings would provide more reliable insights.\n"
        )
    if level == "beginner":
        return (
            f"You are writing ONLY the Beginner explanation for an EEG literacy website.\n"
            f"Output language: {output_lang}.\n"
            f"This is LEVEL 1 of 3 — the SIMPLEST tier, written for an ordinary person who knows NOTHING about EEG. "
            f"Audience: complete non-experts (e.g. a curious family member).\n\n"
            f"TASK: Write a concise plain-language explanation (ONE paragraph). "
            f"Cover EACH item below in its own sentence and weave the actual numbers from the JSON into each sentence. "
            f"Keep it TIGHT: every sentence must carry one fact from the JSON — no filler, no padding, no repetition.\n"
            f"  (a) how long the recording is (use duration_seconds);\n"
            f"  (b) how many sensing positions were used (use channel_count);\n"
            f"  (c) what kind of brain activity dominates — mostly slow waves, mostly fast waves, or a balanced mix;\n"
            f"  (d) about how much of the activity that is (use bandpower_percent, in words like 'about half');\n"
            f"  (e) whether the recording is clear or noisy overall (use signal_quality_score and quality_label);\n"
            f"  (f) whether any specific areas were noticeably harder to read (use noisy_channels);\n"
            f"  (g) whether any obvious interference was present and roughly how widespread it was (use possible_artifacts / clipping_detected / high_frequency_noise);\n"
            f"  (h) whether the signal looked steady across the whole recording or changed noticeably over time;\n"
            f"  (i) in ONE plain-language sentence, SPECULATE what this pattern usually means — e.g., 'recordings dominated by fast waves "
            f"usually come from someone who is awake and alert' or 'mostly slow waves are more typical of drowsiness or deep sleep'. "
            f"This is an INFERENCE about the likely state or scenario, not a statement about this specific person.\n"
            f"  (j) IF the recording shows unusual features (spike-like transient activity, mostly-slow dominant waves, or a slowed "
            f"alpha peak), add ONE extra plain-language sentence mentioning which kind of medical condition such patterns are "
            f"usually discussed in connection with — e.g., 'patterns like this are often discussed in connection with certain "
            f"conditions involving abnormal brain discharges or a slowing of brain activity'. "
            f"If the recording shows NO unusual features, do NOT invent any medical condition; instead say in plain words that "
            f"the recording shows no obvious abnormal tendency. Phrase as general knowledge, never as a diagnosis.\n"
            f"Do NOT combine multiple items into one sentence. Do NOT stop early — cover all nine items, "
            f"but never pad to lengthen the answer.\n\n"
            f"FACTUALITY RULES (violation = FAILURE):\n"
            f"- The arrays in the JSON are the COMPLETE truth. An EMPTY array means ZERO — say 'no areas were harder to read' / "
            f"'no interference was detected'. NEVER invent a count, never say '21 channels' unless the JSON literally lists 21 names.\n"
            f"- No count you mention may exceed channel_count. If possible_artifacts is empty, say interference was not detected — "
            f"do not write 'some interference was present'. If clipping_detected is false, do not mention clipping.\n"
            f"- Only report numbers that appear in the JSON. Do not extrapolate or guess.\n\n"
            f"STYLE RULES:\n"
            f"- Use everyday words a complete beginner understands. NO technical terms: do NOT use alpha/beta/delta/theta, "
            f"bandpower, PSD, SNR, sampling rate, channel, or artifact. Say 'slow brainwaves' / 'fast brainwaves' or describe it in plain words.\n"
            f"- NEVER write the wave names alpha/beta/theta/delta/gamma (even translated) — always say 'slow waves' or 'fast waves'.\n"
            f"- Never dump percentages or parameter lists. You MAY say 'about half of the activity was in the slower range' "
            f"to convey a proportion in words.\n"
            f"- INCLUDE ONE plain-language sentence that SPECULATES what this pattern usually means — e.g., 'recordings dominated by fast waves "
            f"usually come from someone who is awake and alert', 'mostly slow waves are more typical of drowsiness or deep sleep'. "
            f"Phrase it as a general 'usually/typically' correlation. This is an INFERENCE about the likely state or scenario; "
            f"do NOT claim to know what this specific person was doing or feeling.\n"
            f"- You MAY give ONE hedged inference about what the pattern usually means ('usually comes from someone awake "
            f"and alert', 'more typical of drowsiness'), but do NOT assert what this specific person was doing or feeling.\n"
            f"- NEVER mention channel names or channel 1, channel 2, etc.\n"
            f"- NO meta sentences ('以下是对这份记录的分析', '本文介绍了…', '总的来说…'), NO disclaimers, NO advice, NO closing invitation.\n"
            f"- Do NOT repeat the same fact twice in different words — that is padding.\n"
            f"{uncertainty}"
            f"{boundary}\nEEG analysis JSON:\n{payload}\n"
        )
    if level == "student":
        return (
            f"You are writing ONLY the Student explanation for an EEG literacy website.\n"
            f"Output language: {output_lang}.\n"
            f"This is LEVEL 2 of 3 — the MIDDLE tier, clearly MORE technical and informative than the Beginner tier "
            f"but deliberately LESS deep than the Research tier. "
            f"Audience: neuroscience beginners taking their first EEG course.\n\n"
            f"TASK: Write a teaching-style explanation in 3 paragraphs. "
            f"This is a middle level — more detail than the beginner summary, less depth than a research report. "
            f"Each paragraph must teach a specific concept AND relate it to THIS recording's real numbers. "
            f"LENGTH: cover every required item below. Keep it CONCISE — every sentence must teach something new; "
            f"no filler, no padding, no repetition. A short complete answer is better than a long padded one.\n\n"
            f"PARAGRAPH 1 — The recording and its quality (cover all four points): "
            f"1) describe the setup in one line (channels, sampling rate, duration); "
            f"2) explain what the signal quality score means; "
            f"3) explain what THIS quality level implies for how much we can trust this data; "
            f"4) give one concrete caution specific to this recording's numbers. "
            f"Each of these four points in its own sentence.\n\n"
            f"PARAGRAPH 2 — Brainwave bands in this recording (cover all five bands): "
            f"Define EACH band — delta, theta, alpha, beta, gamma — in its own sentence with its rough frequency range, "
            f"and add ONE cautious physiological correlate per band ('fast waves commonly accompany wakefulness', "
            f"'alpha often appears during relaxed wakefulness', 'slow waves are more typical of drowsiness or sleep', "
            f"'gamma is typically associated with active cortical processing and attention'). "
            f"Cover each band concisely (definition + one correlate each). If gamma is missing or 0 in the JSON "
            f"(e.g. low sampling rate limits gamma assessment), say so briefly instead of inventing a gamma percentage. "
            f"Then name which band dominates in THIS recording "
            f"with its real percentage (cautious wording: typically associated with, commonly seen in, may reflect) "
            f"and compare the bands against each other using the real percentages. "
            f"Finally, add ONE explicit INFERENCE sentence: based on the dominant band and its real percentage, "
            f"state what state or scenario this recording most plausibly corresponds to "
            f"(e.g., wakeful alertness, relaxed eyes-closed wakefulness, drowsiness/sleep), "
            f"using cautious wording like 'typically corresponds to' / 'may reflect'. "
            f"Then add ONE more cautious sentence naming which disease/condition category this pattern is typically "
            f"associated with when the data shows spike-like transient activity, diffuse slow-wave "
            f"dominance, or a slowed alpha peak — e.g., 'epileptiform activity and epilepsy', 'metabolic encephalopathy "
            f"or early neurodegenerative changes', 'cognitive decline (e.g., early Alzheimer's disease)'. "
            f"If the data shows NONE of these abnormal features, do NOT invent or force a medical interpretation; "
            f"instead state that the recording shows no obvious abnormal tendency. "
            f"Always frame it as general background knowledge ('typically associated with…'), "
            f"never as a diagnosis of this recording.\n"
            f"NEVER state what THIS person was actually doing or feeling.\n\n"
            f"PARAGRAPH 3 — Noise and artifacts in this recording (cover all four points): "
            f"1) explain what EEG artifacts are; 2) explain what a noisy channel means; "
            f"3) state how many channels were flagged noisy here (or none) with the real number; "
            f"4) state whether artifacts/clipping/high-frequency noise were detected in this recording. "
            f"Each point in its own sentence.\n\n"
            f"TRANSIENT ACTIVITY (mandatory if present): If the JSON contains transient_activity with level "
            f"'mild'/'moderate'/'high', you MUST add one more sentence (as point 5 of paragraph 3, or a short "
            f"fourth paragraph) describing it objectively: e.g. 'this recording also shows frequent high-amplitude "
            f"transient spike-like deflections (X% of samples across M/N channels)'. Then add ONE cautious, "
            f"educational sentence about what such patterns typically reflect in the EEG literature, e.g. "
            f"'high-amplitude transient spike-like discharges are a pattern commonly studied in the context of "
            f"epileptiform activity' — always with 'typically / commonly / may be associated with', NEVER as a "
            f"diagnosis or a normal/abnormal verdict on THIS recording, and NEVER labeling this data as "
            f"seizure/epilepsy. If transient_activity is absent or level is 'none', do not mention it.\n\n"
            f"FACTUALITY RULES (violation = FAILURE):\n"
            f"- The arrays in the JSON are the COMPLETE truth. An EMPTY array means ZERO — write 'no channels were flagged noisy' / "
            f"'no artifacts were detected'. NEVER invent a count, never write '21 channels' unless the JSON literally lists 21 names.\n"
            f"- No count you mention may exceed channel_count. If possible_artifacts is empty, artifacts were not detected. "
            f"If clipping_detected / high_frequency_noise are false, do not say clipping or high-frequency noise were found.\n"
            f"- Only report numbers that appear in the JSON. Do not extrapolate or guess.\n\n"
            f"STYLE RULES:\n"
            f"- You MAY use the terms alpha/beta/theta/delta, bandpower, artifact, sampling rate, channel — but define each briefly the first time.\n"
            f"- DIFFERENTIATION: the Beginner tier already gives the plain-language overview; do NOT repeat a plain summary. "
            f"Instead TEACH — define each band, explain how to read the percentages, and relate each concept to THIS recording's real numbers.\n"
            f"- Each paragraph covers ONLY its own topic. State the dominant band percentage in paragraph 2 ONCE; "
            f"do NOT restate it or the quality score anywhere else. Never repeat a point already made in an earlier paragraph.\n"
            f"- If specific channels were flagged noisy, you MAY name them briefly (e.g., 'EEG 001, EEG 005'); "
            f"keep such lists to at most 3-5 names. Otherwise refer to the real noisy-channel count from the JSON or 'none'.\n"
            f"- DO NOT use markdown heading markers (### / ## / #) or 'Paragraph 1:' style section labels. "
            f"Output plain paragraphs separated by blank lines only — any markdown heading is stripped at output time.\n"
            f"- NO meta or framing sentences: do NOT write '以下/本文/本报告…', do NOT open or close with '总的来说' / '综上所述' / '总之' / '希望…'.\n"
            f"- You MAY cautiously INFER what state or scenario the pattern typically corresponds to "
            f"(e.g., 'this pattern may reflect relaxed wakefulness', 'fast-wave dominance typically appears during "
            f"wakeful alertness', 'slow-wave dominance usually accompanies drowsiness or sleep') — always hedged with "
            f"'may / typically / possibly / likely'. NEVER assert what THIS specific person was feeling, thinking, "
            f"or doing; bandpower is a signal property, not mind-reading.\n"
            f"- When stating a frequency range, ALWAYS keep the two numbers separate with a hyphen or '到' "
            f"(e.g., '8-13 Hz' or '8 到 13 Hz'); never merge them into one number (never write '813 Hz').\n"
            f"- Output language MUST be fully {output_lang}. NO English words mixed in (except technical "
            f"abbreviations: EEG, PSD, SNR, Nyquist, EEG 001/002 channel patterns). Everything else in {output_lang}.\n"
            f"- Use the real numbers from the JSON (percentages, quality score, counts).\n"
            f"- 3 paragraphs, each 3-4 sentences. This tier must be clearly MORE detailed than the Beginner tier "
            f"but LESS deep than the Research tier — it sits in the middle of the level ladder. "
            f"Keep it TIGHT — every sentence carries a real number or a "
            f"teaching point from THIS recording; no filler, no repetition.\n"
            f"{uncertainty}{boundary}\nEEG JSON:\n{payload}\n"
        )
    # research
    return (
        f"You are writing ONLY the Research explanation for an EEG literacy website.\n"
        f"Output language: {output_lang}.\n"
        f"This is LEVEL 3 of 3 — the MOST TECHNICAL tier, deliberately DEEPER, denser, and more informative "
        f"than the Student tier. For the reader who is already comfortable with the Student-level concepts, "
        f"this tier must add the highest-value professional insights the other two tiers cannot provide. "
        f"Audience: researchers, EEG technicians, and data analysts.\n\n"
        f"TASK: Write a RIGOROUS, DENSE research analysis of THIS recording in 3 paragraphs. "
        f"You MUST write EXACTLY three paragraphs — 段落1：频谱主导与绝对功率；段落2：方法学局限（频率分辨率等）；段落3：质量与下游处理。 "
        f"Each paragraph is mandatory; merging or skipping any paragraph is a FAILURE. "
        f"LENGTH: cover every required item below. Keep it DENSE and SHORT — every sentence carries a real number "
        f"(a %, a μV²/Hz value, a ratio taken verbatim from bandpower_ratios, a Hz resolution taken verbatim from "
        f"frequency_resolution_hz) or a precise technical judgment about THIS recording. "
        f"A sentence with neither is invalid text — delete it. A short complete answer is better than a long padded one. "
        f"No filler, no generic methodology notes.\n\n"
        f"KILL RULES — delete any sentence that:\n"
        f"  (a) merely restates the parameters without interpretation (e.g., 'the recording has 21 channels "
        f"at 500 Hz' is allowed ONLY as a brief opening clause, never a full sentence of its own);\n"
        f"  (b) would read identically for any EEG file ('sampling rate above Nyquist supports analysis', "
        f"'duration limits frequency resolution' — only keep when this recording's values make it a "
        f"REAL, quantified limitation such as 'only 20 s ⇒ ~0.05 Hz resolution');\n"
        f"  (c) is a hedge with no number behind it.\n\n"
        f"PARAGRAPH 1 — Dominant spectral finding & absolute power (4-5 sentences): "
        f"Open with the dominant band and its real percentage from bandpower_percent. Then use average_bandpower "
        f"(absolute power, μV²/Hz) together with the PRE-COMPUTED 'bandpower_ratios' object to QUANTIFY dominance "
        f"as exact cross-band multiples (e.g. if bandpower_ratios contains alpha_over_theta, write "
        f"'alpha power is <that value>× theta'). Copy those ratio values VERBATIM — they are already computed for you; "
        f"never recompute or re-derive a ratio yourself. Cover the dominant band against EACH other band that has "
        f"an entry in bandpower_ratios. Assess how physiological (1/f-like) the spectral profile is and how far it deviates. "
        f"Gamma, if present in the JSON, should be included in the ratios; if gamma is absent or zero "
        f"(low sampling rate limits gamma assessment), note that in ONE clause and move on — do not invent a gamma value. "
        f"Then INTERPRET the profile physiologically in cautious professional terms: what awake/alert, relaxed, or drowsy "
        f"patterns typically look like and which one this spectrum most resembles (e.g., 'a beta-dominant, 1/f-like profile "
        f"is most consistent with wakefulness or active cortical engagement'; 'an alpha-dominant profile typically accompanies "
        f"relaxed wakefulness'). Never diagnose the person; frame it as a general physiological correlate. "
        f"End paragraph 1 with ONE explicit INFERENCE sentence naming the most plausible state or scenario for THIS recording "
        f"(e.g., relaxed eyes-closed wakefulness, active wakefulness, drowsiness/sleep), justified by the dominant band, "
        f"its real percentage, and the peak frequency, and hedged with 'likely / most consistent with / suggests'. "
        f"Then add ONE more sentence, phrased as general clinical background knowledge, naming which "
        f"disease/condition category the profile is typically associated with when the data shows spike-like transient "
        f"activity, diffuse slow-wave dominance, or a slowed alpha peak — e.g., 'epileptiform activity and epilepsy', "
        f"'metabolic encephalopathy or early neurodegenerative changes', 'cognitive decline (e.g., early Alzheimer's "
        f"disease)'. If the data shows NONE of these abnormal features, do NOT invent or force a medical interpretation; "
        f"instead state that the recording shows no obvious abnormal tendency. "
        f"NEVER frame it as a diagnosis of this recording.\n\n"
        f"PARAGRAPH 2 — Methodological limits that actually bind THIS data (3-4 sentences): "
        f"State only the constraints that are REAL for this recording, quantified. Use the PRE-COMPUTED "
        f"'frequency_resolution_hz' field directly as the resolution value (it equals 1 / duration_seconds) — "
        f"do NOT compute 1/duration yourself, and never substitute a preview-window length for duration_seconds. "
        f"Phrase it as 'duration_seconds = <its value> s ⇒ frequency_resolution_hz ≈ <its value> Hz, ...' "
        f"using ONLY the two numbers that are actually present in the JSON "
        f"(e.g. adequate for band ratios but coarse for alpha-peak fitting). Say which analysis types this data CAN support vs where it "
        f"falls short — with the numbers justifying it.\n\n"
        f"PARAGRAPH 3 — Quality, downstream safety & handling (3-4 sentences): "
        f"Report the quality score, noisy-channel count (category only), and artifacts/clipping/high-freq "
        f"findings in ONE compact sentence. Then state the direct implication for downstream analyses "
        f"(which are safe vs risky) and end with 1 concrete preprocessing action derived from the actual "
        f"findings. No generic advice.\n\n"
        f"TRANSIENT ACTIVITY (mandatory if present): If the JSON contains transient_activity with level "
        f"'mild'/'moderate'/'high', you MUST give it its own sentence inside paragraph 3 (or right after it): "
        f"first state the objective feature with its real numbers, e.g. 'the recording shows frequent high-amplitude "
        f"transient spike-like deflections (X% of samples across M/N channels, up to Y µV)'. Then add ONE cautious, "
        f"educational speculation about what such patterns are typically associated with in the EEG literature, "
        f"e.g. 'high-amplitude transient spike-like discharges are a pattern commonly studied in the context of "
        f"epileptiform activity' — always framed as general background knowledge with 'typically / commonly / "
        f"may be associated with', NEVER as a diagnosis or a normal/abnormal verdict on THIS recording, and NEVER "
        f"labeling this data as seizure/epilepsy. If transient_activity is absent or level is 'none', do not "
        f"mention transient activity at all.\n\n"
        f"FACTUALITY RULES (violation = FAILURE):\n"
        f"- The arrays in the JSON are the COMPLETE truth. An EMPTY array means ZERO — report 'no channels were flagged noisy' / "
        f"'no artifacts detected'. NEVER invent a count, never write '21 channels' unless the JSON literally lists 21 names.\n"
        f"- No count you mention may exceed channel_count. If possible_artifacts is empty, artifacts were not detected. "
        f"If clipping_detected / high_frequency_noise are false, do not claim clipping or high-frequency noise were found.\n"
        f"- Only report numbers that appear in the JSON. Do not extrapolate or guess.\n\n"
        f"STYLE RULES:\n"
        f"- You MAY and SHOULD use technical terminology: PSD, bandpower, artifacts, Nyquist, montage, SNR.\n"
        f"- DIFFERENTIATION: the Student tier already reports the plain percentage breakdown (e.g., 'delta 28.5%, alpha 45.8%') "
        f"and the frequencies of each band. Do NOT repeat that summary here. This Research tier must go DEEPER: "
        f"absolute power (μV²/Hz), exact cross-band ratios quoted from bandpower_ratios, quantified methodological limits "
        f"(frequency_resolution_hz from duration), and ONE concrete actionable finding. If a sentence only restates a percentage "
        f"that the Student tier would show, replace it with the absolute-power or ratio version.\n"
        f"- EVERY sentence must carry at least one quantified value from the JSON (a %, a μV²/Hz value, a ratio from "
        f"bandpower_ratios, a Hz resolution from frequency_resolution_hz, a channel count) OR a precise technical judgment about THIS recording. "
        f"A sentence with neither is invalid text — delete it.\n"
        f"- NEVER define terms (bandpower, sampling rate, PSD, Nyquist…). The reader is a researcher.\n"
        f"- NO meta sentences, NO concluding summary ('综上所述' / '总体来看' / '总之'), NO disclaimers, NO advice.\n"
        f"- You MAY cautiously INFER what state or scenario the spectrum most plausibly corresponds to "
        f"(e.g., 'an alpha-dominant profile with a ~10 Hz peak is most consistent with relaxed eyes-closed wakefulness'; "
        f"'a beta-dominant 1/f profile suggests active wakefulness or cognitive engagement') — always hedged with "
        f"'most consistent with / suggests / likely / typically'. NEVER assert what THIS specific person was feeling, "
        f"thinking, or doing; bandpower describes the signal, not the person.\n"
        f"- If specific channels were flagged noisy, you MAY name them (e.g., 'EEG 001, EEG 005') in the quality sentence; "
        f"keep such lists to at most 3-5 names. Otherwise refer to a channel count or 'the channels'.\n"
        f"- Write the ENTIRE explanation, including any paragraph headings, in {output_lang}. "
        f"Never leave headings in English — translate or omit them. The output must be fully in {output_lang}.\n"
        f"- DO NOT use markdown heading markers (### / ## / #) or 'Paragraph 1:' / 'Paragraph 2:' style section labels. "
        f"Output plain paragraphs separated by blank lines only — any markdown heading or English section label "
        f"is automatically stripped at output time.\n"
        f"- Output language MUST be fully {output_lang}. NO mixing of English words or sentences inside a "
        f"Chinese explanation (and vice versa). Allowed technical abbreviations only: EEG, PSD, SNR, "
        f"Nyquist, EEG 001/002 (channel naming pattern). Everything else in {output_lang}.\n"
        f"- NEVER output sentences stating that the data cannot provide information about "
        f"intelligence, personality, mental health, diseases, emotions, or specific psychological disorders "
        f"(the website already displays a unified disclaimer; do not repeat it inside the explanation).\n"
        f"- Do NOT fabricate or overstate problems (e.g., do not claim hidden low-frequency noise or "
        f"threats to analyses unless the JSON explicitly shows them).\n"
        f"- 3 paragraphs, each 4-6 sentences. This tier must be the LONGEST of the three — clearly longer "
        f"and denser than the Student tier — because it carries the highest-value professional detail. "
        f"Do NOT pad with restatements, but DO cover every required item with real quantified analysis. "
        f"Every sentence must add information a researcher could not get by reading the raw parameters; "
        f"ALL required items from the three paragraph specs above must appear — a missing item is a failure.\n"
        f"{uncertainty}{boundary}\nEEG JSON:\n{payload}\n"
    )


import re

# 各语言常见免责声明句式，用于从 LLM 输出中移除末尾/穿插的重复免责说明
DISCLAIMER_PATTERNS = [
    # Chinese
    r"(?:但是|不过|然而|需要|请注意|重要|提醒|免责|声明|注意).*?(?:不能|无法|不应|不要|请勿|不应用来|不足以|不适合|无法判断|无法诊断|无法确定|不能反映|不代表|不说明|不表明|不等同于|不能作为|仅供参考|仅作参考|参考).*?(?:诊断|疾病|健康|智商|性格|心理|情绪|认知|功能|状态|治疗|建议|医疗|医学|专业|医生|医师|结论|判断|依据|用途)?[。；]?",
    r"(?:单次|一次|单次记录|一次记录|仅一次|单次 EEG|一次 EEG).*?(?:不能|无法|不应|不要|不足以|不适合|无法判断|无法诊断|无法确定|不能反映|不代表|不说明|不表明).*?(?:大脑|具体|功能|状态|智商|性格|心理|健康|疾病|情绪|认知|治疗|诊断|建议)?[。；]?",
    r"(?:EEG|脑电图|脑电|频谱|功率|波段|频段|分析).*?(?:不能|无法|不应|不要|不足以|不适合|无法用来|不能直接|不能简单|不能单独|不能作为).*?(?:诊断|判断|确定|说明|反映|代表|指示|预测|评估|衡量|评价).*?(?:疾病|健康|智商|性格|心理|情绪|认知|状态|功能|治疗|医疗|专业|结论)?[。；]?",
    # 癫痫类免责短句：从分句标点 + 连接词（但/不过/这/本记录…）起，到"...癫痫发作。"整句删除
    r'([，；。、,;\.\n])(?:但|不过|然而|而|这|本记录|本段|本次|该记录|这些|此)[^。；！？]*?(?:并不意味着|并不能说明|不代表|不说明|不表明|不能说明|无法说明)[^。；！？]*?(?:癫痫发作|癫痫|痫性发作)[。；！？]',
    # 通用兜底免责：从标点后紧跟的"但/不过/这/本记录…"分句起点删到句末标点
    r'([，；。、,;\.\n])(?:但|不过|然而|需要|请注意|重要|提醒|免责|声明|注意|虽然|而|这|本记录|本段|本次|该记录|这些|此)[^。；！？]*?(?:不意味|不代表|不说明|不表明|不能|无法|不应|不要|请勿|不应用来|不足以|不适合|无法判断|无法诊断|无法确定|不能反映|不能作为|不能替代|不应作为|无法作为|不构成|仅供参考|仅作参考|并非|建议咨询|咨询医生|咨询专业|专业医生|诊断|疾病|医疗|医学|替代)[^。；！？]*[。；！？]',
    # 独立短句（整句即免责，可能无句末标点）：仅供参考 / 仅作参考 / 建议咨询医生 等
    r'([，；。、,;\.\n]|^)[^。；！？]*?(?:仅供参考|仅作参考|参考用途|建议咨询|咨询医生|咨询专业|并非诊断|不构成诊断|不能替代|不应替代|无法替代)[^。；！？]*[。；！？]?',
    # 纯免责短句（整句都是免责，锚定段首/行首，短句，如"并不意味着该记录存在癫痫。"）
    r'(^|[\n])(?:这|本记录|本段|本次|该记录)?[^。；！？]{0,30}?(?:并不意味着|并不能说明|不代表|不说明|不表明|不能说明|无法说明|不能用于诊断|不能作为诊断依据)[^。；！？]{0,20}[。；！？]',
    # 质量限制声明：噪声/伪影/漂移"可能影响分析准确性/可靠性/可信度"，从连接词起删整句（保留客观描述）
    r'([，；。、,;\.\n])(?:这|这些|其|它|因此|所以|此外|同时|但|不过|然而)[^。；！？]*?(?:会影响|影响|降低|干扰|损害|限制|视为不可靠|应视为不可靠)[^。；！？]*?(?:准确性|可靠性|精度|可信度|准确测量|准确评估|判断)[^。；！？]*(?:[。；！？]|$)',
    r'([，；。、,;\.\n])(?:存在|仍存在)[^。；！？]{0,20}?(?:可信度|可靠性)[^。；！？]{0,10}?(?:限制|问题)[^。；！？]*(?:[。；！？]|$)',
    r'(^|[，；。、,;\.\n])[^。；！？，,]{0,14}?(?:应视为|可视为|视为)[^。；！？，,]{0,6}不可靠',
    r'(^|[，；。、,;\.\n])(?:存在|仍存在)[^。；！？，,]{0,20}(?:可信度|可靠性)[^。；！？，,]{0,8}(?:限制|问题)',
    # 段首变体：句子以"这/这些/因此/此外"开头且整句是质量限制声明 → 整句删
    r'(^|[\n])(?:这|这些|因此|所以|此外|同时|但|不过|然而|总之|其)[^。；！？]*?(?:会影响|影响|降低|干扰|损害|限制)[^。；！？]*?(?:准确性|可靠性|精度|可信度|准确测量|准确评估|判断)[^。；！？]*(?:[。；！？]|$)',
    # 段首纯限制短句（短句，如"逐通道分析应视为不可靠。""存在一些可信度上的限制。"）
    r'(^|[\n])[^。；！？]{0,28}?(?:应视为不可靠|视为不可靠|存在[^。；！？]{0,15}(?:可信度|可靠性)[^。；！？]{0,8}(?:限制|问题))(?:[。；！？]|$)',
    # English
    r"(?:However|But|Please note|Important|Disclaimer|Note that|Keep in mind|It is important to).*?(?:cannot|can not|should not|does not|is not|may not|unable to|not enough|not sufficient|not suitable|not appropriate|not intended|not a substitute|not diagnostic|not medical|not clinical).*?(?:diagnose|determine|reflect|represent|indicate|predict|assess|evaluate|measure|judge|tell|show|suggest|advise|treat|medical|health|disease|condition|IQ|personality|mental|cognitive|emotional|state|function|condition|disorder|ADHD|depression|anxiety|professional|physician|doctor|clinician)?[.!?;]?",
    r"(?:single|one|individual|single-session|one-time).*?(?:recording|session|measurement|data|EEG).*?(?:cannot|can not|should not|does not|is not|may not|unable to|not enough|not sufficient).*?(?:diagnose|determine|reflect|represent|indicate|predict|assess|evaluate|measure|judge|tell|show|characterize).*?(?:brain|health|disease|condition|IQ|personality|mental|cognitive|emotional|state|function|disorder|medical|clinical)?[.!?;]?",
    # 质量限制声明（英文）：noise/artifact "may affect accuracy/reliability" 从句
    r"([,;.\n])(?:this|these|it|therefore|thus|so|however|but)[^.!?;]*?(?:may|might|could|can)?[^.!?;]*?(?:affect|reduce|impair|limit|unreliable)[^.!?;]*?(?:accuracy|reliability|precision|confidence|measurement|interpretation)[^.!?;]*[.!?;]?",
    # Spanish
    r"(?:Esta|Este|La|El).*?(?:información|análisis|herramienta|sistema|resultado|dato|datos|aplicación).*?(?:no debe|no se debe|no debe ser|no puede|no es|no constituye|no reemplaza|no sustituye|no proporciona|no ofrece|no pretende|solo con fines|únicamente|meramente|exclusivamente).*?(?:diagnosticar|diagnóstico|médico|médica|consejo|consulta|tratamiento|terapia|enfermedad|enfermedades|condición|condiciones|trastorno|trastornos|evaluar|determinar|juzgar|indicar|predecir|asesorar)?[.!?;]?",
    r"(?:No|Este|Estos).*?(?:debe|deben|puede|pueden).*?(?:ser utilizado|ser utilizada|ser usada|ser usado|interpretarse|considerarse|tomarse).*?(?:como|para).*?(?:diagnóstico|diagnóstico médico|reemplazo|sustituto|sustituta|alternativa).*?(?:médico|médica|profesional|clínico)?[.!?;]?",
    r"(?:Solo|Únicamente|Meramente|Exclusivamente).*?(?:para|a título|con fines).*?(?:informativos|informativo|referencia|educativos|educativo|orientativos|orientativo).*?(?:y no|no|sin).*?(?:debe|puede|constituye|reemplaza|sustituye).*?(?:médico|médica|clínico|diagnóstico|tratamiento|profesional)?[.!?;]?",
    # French
    r"(?:Ces|Cette|Ce|L'|Les).*?(?:informations|analyse|outil|système|résultat|données|application|explication).*?(?:ne doit pas|ne doivent pas|ne peut pas|ne peuvent pas|n'est pas|ne sont pas|ne constitue pas|ne remplacent pas|ne remplace pas|ne se substitue pas|ne prétend pas|n'est pas destiné|uniquement à titre|à titre|uniquement).*?(?:diagnostiquer|diagnostic|médical|médicale|avis|consultation|traitement|thérapie|maladie|maladies|état|condition|trouble|troubles|évaluer|déterminer|indiquer|prédire|conseiller)?[.!?;]?",
    r"(?:Ne|À titre).*?(?:doit|doivent|peut|peuvent).*?(?:pas être utilisé|pas être utilisée|pas être employé|pas être employée|pas constituer|pas remplacer|pas se substituer).*?(?:un|une|le|la|comme|en tant que).*?(?:diagnostic|remplacement|substitut|alternative).*?(?:médical|médicale|professionnel|clinique)?[.!?;]?",
    r"(?:Uniquement|Seulement|À titre|Simplement).*?(?:informatif|informative|d'information|de référence|pédagogique|d'orientation).*?(?:et ne|sans).*?(?:doit|doivent|peut|peuvent|constitue|remplace|se substitue).*?(?:médical|médicale|clinique|diagnostic|traitement|professionnel)?[.!?;]?",
    # German
    r"(?:Diese|Dieser|Das|Die|Dieses).*?(?:Informationen|Analyse|Werkzeug|System|Ergebnis|Ergebnisse|Daten|Anwendung|Erklärung|Auswertung|Bewertung).*?(?:darf nicht|dürfen nicht|kann nicht|können nicht|ist nicht|sind nicht|stellt keine|stellen keine|ersetzt nicht|ersetzen nicht|sollte nicht|sollten nicht|nicht als|nicht zur|nicht für|ausschließlich|lediglich|nur).*?(?:Diagnose|diagnostizieren|medizinisch|medizinische|medizinischer|ärztlich|ärztliche|ärztlicher|Behandlung|Therapie|Krankheit|Krankheiten|Zustand|Zustände|Störung|Störungen|bewerten|beurteilen|feststellen|anzeigen|vorhersagen|beraten)?[.!?;]?",
    r"(?:Diese|Diese).*?(?:Informationen|Analyse|Ergebnisse|Daten).*?(?:sind nicht|ist nicht|dienen nicht|stellt keine|stellen keine).*?(?:als|für|zur).*?(?:medizinische|ärztliche|klinische).*?(?:Diagnose|Beurteilung|Beratung|Bewertung|Empfehlung)?[.!?;]?",
    r"(?:Nur|Ausschließlich|Lediglich|Bloß).*?(?:zu|zur|als|für).*?(?:Informationszwecken|Information|Referenz|Bildungszwecken|Orientierung).*?(?:und|aber).*?(?:nicht|keine|kein|keinen).*?(?:medizinisch|ärztlich|klinisch|Diagnose|Behandlung|Therapie|professionell)?[.!?;]?",
    # Japanese
    r"(?:この|本|当).*?(?:情報|分析|ツール|システム|結果|データ|アプリケーション|説明|評価).*?(?:は|が).*?(?:医療|医学|診断|治療|健康|病気|疾患|症状|状態).*?(?:目的|ため|用|代わり|代替|判断|評価|決定).*?(?:では(?:あり|ござい)ません|できません|しないでください|できません|するものでは(?:あり|ござい)ません|いたしません|行いません|できませんので|お控えください)?",
    r"(?:医師|専門家|医療機関).*?(?:の|による|へ).*?(?:診断|治療|相談|アドバイス|判断|指示).*?(?:を|に).*?(?:代わる|代替|置き換える).*?(?:ものでは(?:あり|ござい)ません|では(?:あり|ござい)ません|できません)?",
    r"(?:参考|参照|教育|学習|情報提供).*?(?:目的|用|ため|として).*?(?:のみ|だけ|限定).*?(?:であり|で).*?(?:医療|医学|診断|治療|健康).*?(?:目的|用|ため).*?(?:では(?:あり|ござい)ません|するものではありません)?",
    # Korean
    r"(?:이|본|해당).*?(?:정보|분석|도구|시스템|결과|데이터|애플리케이션|설명|평가).*?(?:는|은|이|가).*?(?:의학적|의료|진단|치료|건강|질병|질환|증상|상태).*?(?:목적|용도|대체|판단|평가|결정).*?(?:이(?: 아닙니| 아닙)다|할 수 없습니다|하지 마십시오|할 수 없습니다|위한 것이 아닙니다|목적으로 하지 않습니다)?",
    r"(?:의사|전문가|의료진|의료 기관).*?(?:의|에게|에).*?(?:진단|치료|상담|조언|판단|지시).*?(?:를|을).*?(?:대체|대신|갈음).*?(?:할 수 없습니다|하는 것이 아닙니다|위한 것이 아닙니다|되지 않습니다)?",
    r"(?:참고|참조|교육|학습|정보 제공).*?(?:목적|용도|용).*?(?:으로|로|만|만을|입니다).*?(?:의학적|의료|진단|치료|건강).*?(?:목적|용도|판단).*?(?:이(?: 아닙니| 아닙)다|할 수 없습니다|위한 것이 아닙니다)?",
]


def _strip_disclaimers(text: str) -> str:
    """移除 LLM 输出中的免责声明（整段或段落内嵌短句），保留主体解释内容。
    实现：逐段对每条 DISCLAIMER_PATTERNS 做内嵌删除（re.sub），再清理残留标点。
    纯免责段落删除后自然消失；若整段解释都被清掉则回退原文本，避免空输出。"""
    if not text:
        return text
    paras = [p.strip() for p in str(text).split("\n") if p.strip()]
    if not paras:
        return text
    out_paras = []
    for p in paras:
        cleaned_p = p
        for pat in DISCLAIMER_PATTERNS:
            cleaned_p = re.sub(pat, lambda m: m.group(1) if (m.groups() and m.group(1)) else "", cleaned_p, flags=re.IGNORECASE)
        # 清理因删除产生的多余标点/空白
        cleaned_p = re.sub(r"[,，。;；]?\s*[,，。;；]", "，", cleaned_p)
        cleaned_p = re.sub(r"^[,，。;；\s]+", "", cleaned_p)
        cleaned_p = re.sub(r"[,，。;；\s]+$", "", cleaned_p)
        cleaned_p = re.sub(r"\s{2,}", " ", cleaned_p)
        if cleaned_p.strip():
            out_paras.append(cleaned_p.strip())
    result = "\n\n".join(out_paras)
    # 删除免责后允许返回空（调用方 _dedup/生成逻辑会在清空时回退模板，避免空解释）；
    # 单个纯免责段落应被正常丢弃，因此这里直接返回 result（可能为空）。
    return result


# 确定性措辞 → 推测性措辞 软化替换（LLM 偶用"肯定/绝对/100%"时兜底改写）
_CERTAINTY_REPLACEMENTS = [
    # 中文：先处理长词，避免拆错
    ("百分之百", "可能"),
    ("100%", "可能"),
    ("肯定无疑", "很可能"),
    ("毫无疑问", "很可能"),
    ("必然", "往往"),
    ("必定", "很可能"),
    ("肯定", "可能"),
    ("确凿", "较明确"),
    ("显然就是", "可能"),
    ("显然", "通常"),
    # 英文
    ("guaranteed", "likely"),
    ("undoubtedly", "likely"),
    ("certainly", "likely"),
    ("definitely", "likely"),
    ("absolutely", "generally"),
    ("always", "usually"),
    ("never fails", "rarely"),
    ("proves", "suggests"),
    ("100%", "likely"),
]
# "绝对" 单独处理：仅当它是确定性副词时替换，术语"绝对功率/绝对振幅/绝对能量/绝对值"保留。
_ABS_TERM_RE = re.compile(r"绝对(?!功率|振幅|能量|值|大小|量级|幅度)")
# "一定" 单独处理：排除固定搭配"一定程度/一定范围/一定数量"（表示"有些"，非必然性）
_YIDING_RE = re.compile(r"一定(?!程度|范围|数量|比例|时长的|时间的|距离)")
# 相邻重复标点清理（软化替换后可能产生"往往。。"）
_DUP_PUNCT_RE = re.compile(r"([。！？；])\1+")
_SPACE_PUNCT_RE = re.compile(r"\s+([，。；！？])")


def _soften_claims(text: str) -> str:
    """把解释中的确定性/绝对化措辞替换为推测性措辞（'可能/大概/通常/往往'）。
    注意：不处理免责句（由 _strip_disclaimers 负责），只软化语气。"""
    if not text:
        return text
    t = text
    for src, dst in _CERTAINTY_REPLACEMENTS:
        t = t.replace(src, dst)
    # 绝对 → 通常（排除"绝对功率/振幅/能量"等术语）
    t = _ABS_TERM_RE.sub("通常", t)
    # 一定 → 往往（排除"一定程度/范围/数量"等固定搭配）
    t = _YIDING_RE.sub("往往", t)
    t = _DUP_PUNCT_RE.sub(r"\1", t)
    t = _SPACE_PUNCT_RE.sub(r"\1", t)
    return t


# 标题行模式：用于从非英文解释中剔除。
# ① AI 有时输出 "### Spectral analysis" / "### 噪声与伪迹分析" — 任何以 # 开头（1-4 个）作为段落分隔的行都视为多余标题，统一删除
# ② AI 有时输出 "Paragraph 1 — ..." / "Section 2:" 等英文段落标记，同样删除
_EN_HEADING_RE = re.compile(
    r"^#{1,6}\s+\S.*$",
    re.MULTILINE,
)


def _strip_en_headings(text: str, lang: str) -> str:
    """非英文解释中剔除 AI 偶尔留下的标题/段落标记（'Paragraph 1 — ...'、'### Spectral'、'### 中文标题'），
    保证输出与界面语言一致。英文解释原样保留。"""
    if lang == "en" or not text:
        return text
    # 1) 删 markdown 标题行（### 或 ## 等开头）
    text = _EN_HEADING_RE.sub("", text)
    # 2) 删英文段落标记 "Paragraph 1 — ...\n" 等（行首）
    text = re.sub(
        r"^(?:Paragraph|Section|Step|Part)\s*\d*[.:、\-\s]*[A-Za-z][A-Za-z0-9 ,&'()\-/]{2,80}\s*$",
        "",
        text,
        flags=re.MULTILINE,
    )
    # 2b) 删中文分节标签行："段落1：xxx" / "段落 2: xxx" / "第三部分：xxx"（设计不允许分节标签）
    text = re.sub(
        r"^(?:段落\s*[一二三四五六七八九十\d]*|第\s*[一二三四五六七八九十\d]+\s*(?:部分|小节))\s*[：:、.\-\s]*\S{0,40}$",
        "",
        text,
        flags=re.MULTILINE,
    )
    # 3) 清理通道名替换的啰嗦："各通道和EEG 各通道-各通道" → "各通道"
    text = re.sub(r"\bEEG\s*各通道", "各通道", text)
    text = re.sub(r"各通道\s*[,，、和与及]\s*EEG\s*各通道", "各通道", text)
    text = re.sub(r"各通道\s*[,，、和与及]+\s*各通道", "各通道", text)
    # 4) 删掉 AI 输出的中英混杂句（英文连续 ≥5 字符 + 中文夹在一起的整句）
    cleaned = []
    for line in text.split("\n"):
        if not line.strip():
            cleaned.append(line)
            continue
        ascii_run = max((len(m.group()) for m in re.finditer(r"[A-Za-z][A-Za-z\s,.\-']{4,}", line)), default=0)
        if ascii_run >= 8:  # 长英文片段 ≥8 字符
            # 2026-10-07 修正：原逻辑是「只要出现长英文片段就丢掉整行」，于是句子里
            # 只要引用一个英文指标名（alpha_over_delta / duration_seconds = 20.0 等）
            # 整段中文解释就被连坐删除。研究档天然会引用这些字段名，实测被砍掉上百字，
            # 最终比「进阶档」还短（分档倒挂）。
            # 改为：只有「整行以英文为主」时才删整行，中文为主的段落保留。
            _letters = len(re.findall(r"[A-Za-z]", line))
            _nonspace = len(re.sub(r"\s", "", line))
            if _nonspace and _letters / _nonspace >= 0.6:
                continue
        cleaned.append(line)
    text = "\n".join(cleaned)
    # 清理多余空行
    lines = [ln for ln in text.split("\n") if ln.strip()]
    return "\n".join(lines).strip()


# ── 无效文本/元话语清理 ──
# 删除 AI 偶尔输出的"元话语"和纯套话句子：自我指涉框架句、总结空壳、客套结尾、纯废话。
# 与 DISCLAIMER_PATTERNS 互补（免责声明那里已处理，这里处理"凑数"性质的无信息句）。
_META_SENTENCE_RES = [
    # 自我指涉框架句："以下/以上/本文/本报告/本分析…（…分析/介绍/总结/说明/解读/内容/信息）"
    re.compile(r"^[（(]?(?:以下|以上|上面|上文|本文|本报告|本分析|本内容|这一|这段|本次|此次)[^。！？!?；;]{0,24}?(?:分析|介绍|总结|说明|解读|内容|报告|结论|信息)[）)]?。?$"),
    # 总结空壳（后接内容 ≤4 字视为没实质内容）："综上所述。" "总而言之。" "总结来说。" "总体来看。"
    re.compile(r"^[（(]?(?:综上(?:所述)?|总而言之|总的说来|总结来说|总结|最后|结尾|结语)[，,:：]?[^。！？!?；;]{0,4}。?$"),
    # 客套/邀请结尾
    re.compile(r"^[（(]?(?:希望|愿|如需|若有|如果有|如您|有任何问题|请咨询|建议您|欢迎)[^。！？!?；;]{0,34}?[。！？!?]?$"),
    # 纯废话/空壳
    re.compile(r"^[（(]?(?:仅|只是|仅供)(?:供|作|作为)?(?:参考|科普参考|科普|学习|了解|示意|展示|科普所用)。?$"),
    re.compile(r"^(?:好的|OK|是的|嗯|总之|因此|可见|由上可知)。?$"),
]


def _strip_meta_sentences(text: str) -> str:
    """删除 AI 输出中的元话语/套话/空壳句（'以下是对…的分析'、'综上所述'、'希望这份分析能帮助您'、
    '仅供科普参考'等），与免责声明清理互补，保证每一句都有实质内容。按句切分处理，保留段落。"""
    if not text:
        return text
    lines = [ln for ln in str(text).split("\n") if ln.strip()]
    kept = []
    for ln in lines:
        segs = re.split(r"(?<=[。！？!?；;])|(?<=\.)(?<!\d\.)(?!\d)", ln)
        kept_segs = []
        for seg in segs:
            s = seg.strip()
            if not s:
                continue
            if any(p.match(s) for p in _META_SENTENCE_RES):
                continue
            # 句首/句尾带引号括号时再查一次
            s2 = s.strip("\"'“”‘’（）()【】[]「」")
            if s2 != s and any(p.match(s2) for p in _META_SENTENCE_RES):
                continue
            kept_segs.append(seg)
        if kept_segs:
            kept.append("".join(kept_segs))
    # 全删光就返回空串（由调用方决定是否回退模板），不要把无效文本原样还回去
    return "\n\n".join(kept).strip()


# ── 心智状态解读清理 ──
# 删除 AI 把频段功率解读成"人处于什么状态"的句子（违反边界规则 2：bandpower 是信号属性，不是读心）。
# 规则：句中同时出现「心智词」和「推测/关联词」才删，避免误删正常描述。
_MENTAL_WORDS = [
    "放松", "紧张", "注意力", "专注", "情绪", "认知", "心理", "精神状态", "清醒",
    "困倦", "疲劳", "睡眠", "焦虑", "兴奋", "平静", "警觉", "活跃", "做梦", "冥想",
    "思考", "心境", "压力", "意识", "心态",
    "relax", "attention", "emotion", "cognitive", "mental", "alert", "focus",
    "fatigue", "sleep", "calm", "anxiety", "thinking", "arousal", "stress", "mind",
]
_MENTAL_HEDGE = [
    "可能", "或许", "也许", "大概", "表明", "反映", "提示", "意味着", "说明",
    "暗示", "推测", "推断", "相关", "关联",
    "may", "might", "could", "likely", "suggests", "reflects", "indicates",
    "implies", "related", "associated",
]


def _strip_mental_states(text: str) -> str:
    """删除心智状态解读句（'alpha 占主导可能表明处于放松状态' 等），按句切分，保留段落。"""
    if not text:
        return text
    lines = [ln for ln in str(text).split("\n") if ln.strip()]
    kept = []
    for ln in lines:
        segs = re.split(r"(?<=[。！？!?；;])|(?<=\.)(?<!\d\.)(?!\d)", ln)
        kept_segs = []
        for seg in segs:
            s = seg.strip()
            if not s:
                continue
            low = s.lower()
            if any(w in low for w in _MENTAL_WORDS) and any(w in low for w in _MENTAL_HEDGE):
                continue
            kept_segs.append(seg)
        if kept_segs:
            kept.append("".join(kept_segs))
    return "\n\n".join(kept).strip()


# ── 无效元素清理 ──
# 删除两类无效句：
#  1) 针对"具体个体"的心智状态解读（"该个体处于放松状态"、"记录者可能……"）—— 边界规则4禁止
#  2) 建议/操作指导句（"建议……处理"、"应……"）—— 边界规则3禁止
# 一般性教育关联（"alpha波通常与放松清醒相关"）不属于无效元素，保留。
_SUBJECT_WORDS = [
    "该个体", "这个个体", "个体", "此人", "这个人", "该人", "记录者", "被试", "受试者",
    "被记录者", "测试者", "患者", "检测者", "the individual", "the subject",
    "this person", "the person", "the participant", "the patient", "the recorder",
    "the subject", "the participant",
]
_ADVICE_WORDS = [
    "建议", "应当", "应该", "最好", "可以尝试", "务必", "需要做", "需进行", "应进行",
    "we recommend", "it is recommended", "you should", "should be done", "we suggest",
    "it is advised", "should perform", "should remove", "should be removed",
]
# ⚠️ 2026-10-07 修正：此前列表中还有**裸单字 "应" 与 "请"**，做的是朴素子串匹配，
# 会误伤「感**应**位置 / 反**应** / 对**应** / **应**用 / 申**请** / 邀**请**」这类普通词 ——
# 只要句中含这些词，整句就被当成「建议句」删除。实测：换 deepseek 后 beginner 档
# 的整段输出（含「8 个感应位置」）被整句删除 ⇒ 4/4 回退模板。
# 这不是策略问题（策略禁止的是「面向个体的建议/指导」），而是匹配过宽。
# 改法：单字改为「只匹配真正的建议句式」，多字词条保持不变 ⇒ 策略语义不变、误伤消失。
_ADVICE_RES = [
    # 「应」只在后接建议性动词时才算建议
    re.compile(r"应(该|当|予|避免|注意|考虑|结合|保持|控制|尽量|确保|检查|降低|提高|调整|增加|减少|优先|先|再|把|将)"),
    # 「请」同理：后顾断言排除「申请 / 邀请」，否则「申请使用」会被当成「请使用」
    re.compile(r"(?<![申邀])请(注意|确保|检查|咨询|联系|使用|参考|务必|尝试|及时|先|再)"),
]


def _strip_invalid_sentences(text: str) -> str:
    """删除个体状态解读句与建议句；保留一般性频段-状态教育关联。按句切分，保留段落。"""
    if not text:
        return text
    lines = [ln for ln in str(text).split("\n") if ln.strip()]
    kept = []
    for ln in lines:
        segs = re.split(r"(?<=[。！？!?；;])|(?<=\.)(?<!\d\.)(?!\d)", ln)
        kept_segs = []
        for seg in segs:
            s = seg.strip()
            if not s:
                continue
            low = s.lower()
            # 个体状态解读：句中有具体对象 + 心智词
            if any(w in low for w in _SUBJECT_WORDS) and any(w in low for w in _MENTAL_WORDS):
                continue
            # 建议/指导句（多字词条做子串匹配 + 单字「应」「请」走建议句式正则，避免误伤普通词）
            if any(w in low for w in _ADVICE_WORDS) or any(p.search(low) for p in _ADVICE_RES):
                continue
            kept_segs.append(seg)
        if kept_segs:
            kept.append("".join(kept_segs))
    return "\n\n".join(kept).strip()


def _research_expansion_text(a: Dict, lang: str) -> str:
    """研究档「扩展重写」—— 与串行版本**完全同一份提示、同一套参数、同一条清洗链**，
    只是把发起时机从「长度校验失败后串行再发」改成「与首批三层同时并行发出」。

    可行性：扩展提示只由分析结果 a 与语言决定，**不依赖其它档位的输出**，因此提前发起
    不会改变任何判定。取用条件（`len(ext) > len(student) * 1.5` 才替换）保持原样 ——
    用户看到的内容不变，省掉的是那次串行等待（实测 +7.16s，且日志显示历史上 9/9 次
    扩展结果最终都被 `research replaced by template` 覆盖，等于纯白等）。

    失败返回空串，调用方按原有逻辑继续（不满足条件就不替换）。
    """
    try:
        ext = call_ollama(_build_prompt(a, "research", lang) + RESEARCH_EXPANSION_SUFFIX,
                          timeout=120, max_tokens=2000)
        txt = str(ext.get("text", "")).strip() if ext.get("success") else ""
        if not txt:
            return ""
        return _dedup_sentences(
            _strip_invalid_sentences(
                _strip_meta_sentences(
                    _soften_claims(
                        _strip_en_headings(_strip_disclaimers(txt), lang)
                    )
                )
            )
        )
    except Exception as e:
        print(f"[explanations] research expansion prefetch failed {lang}: {e}", flush=True)
        return ""


def _generate_explanations_for_lang(analysis: Dict, lang: str) -> Dict[str, str]:
    """为指定语言生成三层解释；三层各独立调用 Ollama（并行），失败用模板兜底"""
    a     = analysis.copy()
    results: Dict[str, str] = {}
    fallbacks = {
        "beginner": template_beginner(a, lang),
        "student":  template_student(a, lang),
        "research": template_research(a, lang),
    }
    # 各档的 max_tokens：入门短小、学习中等、研究最长（600-750 字目标，留足余量防截断）
    _MAX_TOKENS = {"beginner": 200, "student": 450, "research": 1500}

    def _call_level(level: str) -> str:
        try:
            prompt = _build_prompt(a, level, lang)
            ollama = call_ollama(prompt, timeout=100, max_tokens=_MAX_TOKENS.get(level, 400))
            text = str(ollama.get("text", "")).strip() if ollama.get("success") else ""
            if not text or (level == "beginner" and contains_beginner_jargon(text)):
                reason = "empty/jargon" if not text else "beginner jargon"
                print(f"[explanations] fallback {level}({lang}): {reason} | {ollama.get('error','')}", flush=True)
                return fallbacks[level]
            # 通道名保留完整显示（不删，避免半截残留）；只清免责声明/英文标题/元话语，
            # 末端做单档内去重（删同义复读），保证零凑数。
            # 注意：一般性频段-状态教育关联（"alpha通常与放松清醒相关"）保留；
            # 删除针对具体个体的状态解读与建议句（无效元素），再做去重。
            cleaned = _dedup_sentences(
                _strip_invalid_sentences(
                    _strip_meta_sentences(
                        _soften_claims(
                            _strip_en_headings(_strip_disclaimers(text), lang)
                        )
                    )
                )
            )
            # AI 输出全是无效文本（被清空）→ 回退模板，避免空解释
            if not cleaned.strip():
                print(f"[explanations] fallback {level}({lang}): cleaned-empty", flush=True)
                return fallbacks[level]
            # 按档位强制长度上限（保证入门 < 进阶 < 研究层次分明）
            # 从段落末尾整句截断，避免半句。
            _MAX_CHARS = {"beginner": 170, "student": 520, "research": 100000}
            _cap = _MAX_CHARS.get(level, 100000)
            if len(cleaned) > _cap:
                import re as _re
                _segs = _re.split(r"(?<=[。！？；\n])", cleaned)
                _buf = ""
                for _sg in _segs:
                    if _sg and len(_buf) + len(_sg) <= _cap:
                        _buf += _sg
                    elif _sg:
                        break
                if _buf.strip():
                    cleaned = _buf.strip()
                else:
                    cleaned = cleaned[:_cap] + "…"
            return cleaned
        except Exception as e:
            print(f"[explanations] fallback {level}({lang}): exception {e}", flush=True)
            return fallbacks[level]

    # 2026-10-05：research 档的「扩展重写」改为与首批**并行预取**（原来是在长度比例
    # 不达标后才串行再发一次，实测白等 +7.16s）。扩展提示不依赖其它档位输出，提前发起
    # 不改变任何判定；取用条件与清洗链保持原样 ⇒ 用户看到的内容不变，只去掉那段等待。
    # 提交顺序放在前三者之后，取用结果放在最后 —— 总耗时 ≈ max(四次)，而不是相加。
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        future_beginner = executor.submit(_call_level, "beginner")
        future_student  = executor.submit(_call_level, "student")
        future_research = executor.submit(_call_level, "research")
        future_research_long = executor.submit(_research_expansion_text, a, lang)
        for key, future in [("beginner", future_beginner), ("student", future_student), ("research", future_research)]:
            try:
                # 130s 必须 > call_ollama 的 100s：研究档 max_tokens 大、生成慢，
                # 之前 45s/90s 就把还没跑完的 AI 结果丢了 → 用户看到模板
                results[key] = future.result(timeout=130)
            except Exception as e:
                print(f"[explanations] fallback {key}({lang}): future timeout/err {e}", flush=True)
                results[key] = fallbacks[key]
        # 并行预取的扩展文本：此时首批已经跑完，它多半也已完成（内部 120s 超时兜底）
        try:
            research_long = future_research_long.result(timeout=130)
        except Exception as e:
            print(f"[explanations] research expansion future err {lang}: {e}", flush=True)
            research_long = ""

    # 长度顺序兜底：保证 beginner < student < research（用户已多次反馈"研究档怎么会比学习档短"）
    # 若 LLM 不遵守隐含长度规则，对偏短的档做一次"扩展"再生成，最坏情况用模板填充
    try:
        _bn, _st, _rs = len(results["beginner"]), len(results["student"]), len(results["research"])
        # 要求层次分明 1:2:3：beginner*2 < student 且 student*1.5 < research
        if not (_bn * 2 < _st and _st * 1.5 < _rs):
            print(f"[explanations] length order violated {lang}: b={_bn} s={_st} r={_rs}", flush=True)
            # 入门档必须明显短于进阶档（< 0.5x）→ 过长则回退模板
            if not (_bn * 2 < _st):
                results["beginner"] = fallbacks["beginner"]
                _bn = len(results["beginner"])
            # student 不够长于 beginner → 直接用模板填充
            if not (_bn < _st):
                results["student"] = fallbacks["student"]
                _st = len(results["student"])
            # research 不够长于 student*1.5 → 用**已并行预取**的扩展文本（保留 AI student 内容）
            # 2026-10-05：不再就地串行调用 —— 那次调用实测要 +7.16s，而日志显示它产出的文本
            # 历史上 9/9 次都被后续 `research replaced by template` 覆盖，属于纯等待。
            # 提示词、max_tokens、清洗链、（>1.5×student 才替换的）取用条件全部保持原样。
            if not (_st * 1.5 < _rs):
                try:
                    _ext_clean = research_long
                    if _ext_clean and len(_ext_clean) > len(results["student"]) * 1.5:
                        results["research"] = _ext_clean
                except Exception as _e:
                    print(f"[explanations] research expansion failed {lang}: {_e}", flush=True)
                # 扩展后仍不满足比例 → 保留 AI 内容，仅记日志（保证内容质量优先）
                _rs2 = len(results["research"])
                if not (len(results["student"]) * 1.5 < _rs2):
                    print(f"[explanations] ratio relaxed {lang}: b={len(results['beginner'])} s={len(results['student'])} r={_rs2}", flush=True)
    except Exception as _e:
        print(f"[explanations] length order post-check exception {lang}: {_e}", flush=True)

    # ── 推测模块兜底：三档解释都必须包含"推测可能情况"的内容 ──
    # 用户在代码审查中明确要求：AI 解释不能只复述文件里有什么，必须推测数据可能呈现的情况。
    # LLM 偶尔不写推测句（或写得含蓄），这里检测不到推测性语言就自动追加模板推测段。
    try:
        _INFERENCE_HINTS = (
            "推测", "可能", "可能情况", "推断", "通常", "很可能", "或许", "也许",
            "inference", "likely", "typically", "probably", "suggests", "plausibly", "consistent with",
        )
        # 研究档过短（LLM 输出被截断/偷懒）→ 用完整模板替换，保证内容完整且含推测段
        if len(results.get("research") or "") < 400:
            results["research"] = fallbacks["research"]
            print(f"[explanations] research replaced by template (too short, {lang})", flush=True)
    except Exception as _e:
        print(f"[explanations] inference fallback exception {lang}: {_e}", flush=True)

    # （原有的「严格递增保证」已下移到「追加推测段」之后 —— 见本函数 return 之前。
    #   2026-10-07：它原先跑在追加推测段之前，而三档追加的推测段长度各不相同，
    #   追加后会把刚保证好的顺序重新打破 ⇒ 用户看到「第二档比第三档字还多」。）

    # ── 每档固定追加"推测可能的情况"专门段 ──
    # 用户要求：入门/进阶/研究三档都必须在 AI 解释里各有一个专门的推测病情部分。
    # 模板版（template_*）内部已含推测段；LLM 版若没有专门的"推测："段则在此强制追加。
    # 追加前先去重：推测文本已出现在正文中则跳过（避免"推测段=正文整句复制"的凑数）。
    try:
        for _k, _style in (("beginner", "plain"), ("student", "teaching"), ("research", "research")):
            _txt = results.get(_k) or ""
            if "推测：" in _txt or "推测可能的情况" in _txt or "Inference:" in _txt:
                continue
            _spec = _speculate_situation(a, lang, _style)
            if not _spec:
                continue
            # 去重：推测句（或其主干）已出现在正文中 → 不再追加
            if _spec.strip() in _txt or _spec.strip()[:18] in _txt:
                print(f"[explanations] disease section skipped (dup) for {_k} ({lang})", flush=True)
                continue
            if lang == "zh":
                _label = "推测：" if _k == "research" else "推测可能的情况："
            else:
                _label = "Inference: "
            results[_k] = (_txt + "\n\n" + _label + _spec).strip()
            print(f"[explanations] disease section appended to {_k} ({lang})", flush=True)
    except Exception as _e:
        print(f"[explanations] disease-section append exception {lang}: {_e}", flush=True)

    # ── 最终硬性保证：交付前保证三档长度严格递增（beginner < student < research）──
    # 必须放在「追加推测段」之后：三档追加的推测段长度各不相同，追加会改变顺序。
    # 内容质量优先 —— 只在顺序真的被打破时，对偏长的那一档按句边界做最小截断。
    try:
        _bn, _st, _rs = len(results["beginner"]), len(results["student"]), len(results["research"])
        if not (_bn < _st < _rs):
            import re as _re2
            def _cut_by_sentence(text: str, max_len: int) -> str:
                segs = _re2.split(r"(?<=[。！？；\n])", text)
                buf = ""
                for sg in segs:
                    if sg and len(buf) + len(sg) <= max_len:
                        buf += sg
                    elif sg:
                        break
                return buf.strip() or text[:max_len].strip() + "…"
            # student 反而比 research 长 → 截断 student 到 research-1
            if len(results["student"]) >= len(results["research"]):
                results["student"] = _cut_by_sentence(results["student"], max(40, len(results["research"]) - 1))
            # beginner 反而比 student 长 → 截断 beginner 到 student-1
            if len(results["beginner"]) >= len(results["student"]):
                results["beginner"] = _cut_by_sentence(results["beginner"], max(30, len(results["student"]) - 1))
            _bn = len(results["beginner"])
            _st = len(results["student"])
            _rs = len(results["research"])
            print(f"[explanations] strict-order enforced (final) {lang}: b={_bn} s={_st} r={_rs}"
                  + ("" if _bn < _st < _rs else "  ⚠️ still-not-increasing"), flush=True)
    except Exception as _e:
        print(f"[explanations] final order exception {lang}: {_e}", flush=True)

    return results


def generate_explanations(analysis: Dict, primary_lang: str = "zh") -> Dict[str, Dict[str, str]]:
    """为分析结果生成指定语言的三层解释；英文直接用模板（省掉另外 3 次 OpenRouter 调用）"""
    results: Dict[str, Dict[str, str]] = {}

    # 主语言：调用 OpenRouter（3 路并行）
    try:
        results[primary_lang] = _generate_explanations_for_lang(analysis, primary_lang)
    except Exception as e:
        import traceback
        print(f"[explanations] generate_explanations TOP-LEVEL failed for {primary_lang}: {e}\n{traceback.format_exc()}", flush=True)
        results[primary_lang] = {
            "beginner": template_beginner(analysis, primary_lang),
            "student": template_student(analysis, primary_lang),
            "research": template_research(analysis, primary_lang),
        }

    # 其余语言：只用模板填充（避免额外 API 开销；用户切换语言时仍能看到对应语言的解释）
    for _lang in LANG_NAME_MAP.keys():
        if _lang in results:
            continue
        results[_lang] = {
            "beginner": template_beginner(analysis, _lang),
            "student": template_student(analysis, _lang),
            "research": template_research(analysis, _lang),
        }

    return results
