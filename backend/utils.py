"""
NeuroAccess Backend — 工具函数
safe_float / to_jsonable / safe_name / normalize_language
"""
import os
from typing import Any, Optional

import numpy as np


def safe_float(value: Any, default: float = 0.0) -> float:
    """安全转换为 float，处理 list / ndarray / None / np.generic"""
    try:
        if value is None:
            return default
        if isinstance(value, (list, tuple, np.ndarray)):
            if len(value) == 0:
                return default
            arr = np.array(value, dtype=float)
            return float(np.nanmean(arr))
        return float(value)
    except Exception:
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """安全转换为 int"""
    try:
        return int(safe_float(value, float(default)))
    except Exception:
        return default


def to_jsonable(obj: Any) -> Any:
    """递归把 numpy 类型转成 Python 原生类型，确保 JSON 可序列化"""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.float32, np.float64)):
        return float(obj)
    if isinstance(obj, (np.int32, np.int64)):
        return int(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_jsonable(v) for v in obj]
    return obj


def normalize_language(language: Optional[str]) -> str:
    if not language:
        return "zh"
    lang = language.lower().split("-")[0].split("_")[0]
    # 2026-11-09（用户要求）：网站仅保留 中文/英文/德语/日语；
    # 旧的 es/fr/ko 偏好回落到英文（这三种语言的读者本身更可能读英文）。
    SUPPORTED = {"zh", "en", "de", "ja"}
    if lang in SUPPORTED:
        return lang
    if lang in {"es", "fr", "ko"}:
        return "en"
    return "zh"


def safe_name(filename: str) -> str:
    return os.path.basename(filename or "eeg_file.edf").replace(" ", "_")
