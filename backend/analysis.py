"""
EEG 分析引擎 - NeuroAccess v2.0 (Fast Analyze)
支持完整的 EEG 分析：Overview + Quality + Frequency + Waveform + Literacy

v2.0 性能优化：
  - EDF only（不支持 BDF/GDF）
  - preload=False 避免全内存加载
  - 采样式分析（只读前 60s 数据做 bandpower/signal_quality）
  - 波形预览只读 8s 窗口
  - 通道限制：分析 64ch，预览 256ch
  - 文件大小上限 200MB
  - 不在分析时滤波全文件（用 scipy 对小段数据滤波）
  - 不生成 PNG waveform image（前端 Canvas 自绘）
"""
import mne
import numpy as np
import os
import re
from typing import Dict, List, Any, Optional
from scipy.signal import butter, filtfilt, welch

# ── 通道限制 ──────────────────────────────────────────────
MAX_ANALYSIS_CHANNELS = 64    # 分析最多64个EEG通道
MAX_PREVIEW_CHANNELS = 256    # 波形预览最多256个EEG通道（覆盖标准64/128/256导联帽）
MAX_FILE_SIZE_MB = 200       # 文件大小上限

# ── 频段定义 ──────────────────────────────────────────────
BANDS = {
    'delta': (0.5, 4),
    'theta': (4, 8),
    'alpha': (8, 13),
    'beta':  (13, 30),
    'gamma': (30, 45),
}


def band_limits(band_name: str, sfreq: float) -> tuple:
    """返回某个频段在该采样率下实际可计算的频率范围。

    gamma 上限受奈奎斯特频率约束：128 Hz 采样只能可靠评估到 ~63 Hz，
    250 Hz 采样到 125 Hz（>100 则仍取 100）。低采样率时 gamma 频段
    自动截断，保证报告数值可信。

    注意：上限严格低于奈奎斯特 1 Hz，避免 butter 带通滤波器的 Wn 取到
    1.0 导致「Digital filter critical frequencies must be 0 < Wn < 1」
    错误（例如 128 Hz 时 gamma 上限若取 64 Hz 会退化、整段频段波形失败）。
    """
    low, high = BANDS.get(band_name, (0.5, 100))
    nyq = sfreq / 2.0
    hi = min(high, nyq - 1.0)
    if hi <= low:
        hi = low + 1.0
    return (low, hi)

# ── 文件格式支持 ──────────────────────────────────────
# 支持 EDF / BDF / GDF 1.99（加载与单位统一由 _load_raw_any / _raw_to_uv 处理）
SUPPORTED_FORMATS = {".edf"}


def _load_raw_any(file_path: str, preload: bool = False):
    """统一文件加载器（仅 EDF）"""
    return mne.io.read_raw_edf(file_path, preload=preload, verbose=False)


def _raw_to_uv(raw, picks=None, start=0, stop=None):
    """转到 μV"""
    data = raw.get_data(picks=picks, start=start, stop=stop)
    return data * 1e6


# ── EEG 通道关键字（覆盖 10-20 / 10-10 / 64ch / 128ch 标准）──
EEG_KEYWORDS = [
    # 前额区 (Frontopolar)
    "fp", "fpa",
    # 额区 (Frontal)
    "af", "f", "fc", "ft",
    # 中央区 (Central)
    "c",
    # 中央-顶区 (Centroparietal)
    "cp",
    # 顶区 (Parietal)
    "p", "tp", "po", "t",
    # 枕区 (Occipital)
    "o",
    # 中线 (Midline) - 完整列表
    "cz", "fz", "pz", "oz", "fcz", "cpz", "poz", "fpz",
    # 左侧电极 (Left hemisphere - exact match for short names)
    "c3", "c5", "c1",
    "p3", "p5", "p7", "p1", "p9",
    "o1", "po3", "po7", "po9",
    "f3", "f5", "f7", "f9", "f1",
    "fc3", "fc5", "fc7", "fc1",
    "cp3", "cp5", "cp1",
    "af3", "af7", "af5", "af1",
    "tp7", "tp9",
    "ft7", "ft9",
    "fp1", "fp2",
    # 右侧电极 (Right hemisphere)
    "c4", "c6", "c2",
    "p4", "p6", "p8", "p2", "p10",
    "o2", "po4", "po8", "po10",
    "f4", "f6", "f8", "f10", "f2",
    "fc4", "fc6", "fc8", "fc2",
    "cp4", "cp6", "cp2",
    "af4", "af8", "af6", "af2",
    "tp8", "tp10",
    "ft8", "ft10",
]
EXCLUDE_KEYWORDS = {"eog", "ecg", "emg", "status", "stim", "trigger", "marker"}


def _is_eeg_channel(name: str) -> bool:
    """判断通道名是否为 EEG（支持标准 + 通用正则）"""
    import re
    low = name.lower().strip()
    # 先排除非EEG通道
    for ex in EXCLUDE_KEYWORDS:
        if ex in low:
            return False
    # 清洗前缀
    clean = re.sub(r'^(eeg\s*[:\-]?\s*|ch\s*[:\-]?\s*)', '', low, flags=re.I).strip()
    clean = clean.replace(".", "").strip()
    # 精确或前缀匹配关键字表
    if any(k == clean or clean.startswith(k) for k in EEG_KEYWORDS):
        return True
    # 通用正则：字母+数字 或 字母+数字+字母（覆盖 FP1, CZ, PZ-REF 等）
    if re.search(r'[a-z]{1,4}\d{1,3}', clean):
        return True
    if re.search(r'[a-z]+\d+[a-z]?', clean):
        return True
    # MNE 风格：EEG 001, EEG Fp1 等
    if clean.startswith('eeg') and len(clean) >= 4:
        return True
    # 编号式 EEG：清洗前缀后剩纯数字，如 "EEG 001" → "001"
    if clean.isdigit():
        return True
    return False


def _pick_eeg_channels(raw, max_channels: int = MAX_ANALYSIS_CHANNELS) -> List[int]:
    """选出 EEG 通道索引，最多 max_channels 个"""
    ch_names = raw.ch_names
    total = len(ch_names)
    
    # 第一遍：用关键字表精确匹配
    picks = [i for i, ch in enumerate(ch_names) if _is_eeg_channel(ch)]
    
    # 如果匹配太少（< 通道数一半），尝试 MNE 类型标记
    if len(picks) < max(4, total // 2):
        try:
            mne_picks = list(mne.pick_types(raw.info, eeg=True, eog=False, ecg=False,
                                        emg=False, stim=False, misc=False))
            if len(mne_picks) > len(picks):
                picks = mne_picks
        except Exception:
            pass
    
    # 如果还是太少，用宽松规则：排除已知非EEG关键字，其余全收
    if len(picks) < max(4, total // 2) and total <= max_channels * 2:
        picks = [i for i, ch in enumerate(ch_names)
                 if not any(k in ch.lower() for k in EXCLUDE_KEYWORDS)]
    
    # 安全上限
    return picks[:max_channels]


# =====================================================================
# Fast-load 替代 preload=True
# =====================================================================

def fast_load_metadata(file_path: str) -> Dict[str, Any]:
    """只读元数据（通道名、采样率、时长），不加载信号数据

    Returns: {channel_count, sampling_rate, duration_seconds, channel_names, n_times}
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported format: {ext}. Supported: {SUPPORTED_FORMATS}")

    raw = _load_raw_any(file_path, preload=False)
    info = raw.info
    duration = raw.n_times / info['sfreq'] if info['sfreq'] > 0 else 0

    return {
        "channel_count": len(info['ch_names']),
        "sampling_rate": float(info['sfreq']),
        "duration_seconds": float(duration),
        "channel_names": info['ch_names'],
        "n_times": raw.n_times,
    }


def fast_load_segment(file_path: str, duration_sec: float = 60.0,
                      eeg_only: bool = True,
                      max_channels: int = MAX_PREVIEW_CHANNELS) -> tuple:
    """快速加载前 N 秒的 EEG 数据

    Args:
        file_path: EDF 文件路径
        duration_sec: 要加载的秒数（默认60s用于分析）
        eeg_only: 是否只保留 EEG 通道
        max_channels: EEG 通道数量上限（分析默认64，预览可设为256）

    Returns:
        (data_uv, ch_names, sfreq, times)
        data_uv: (n_ch, n_samples) in microvolts
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported format: {ext}. Supported: {SUPPORTED_FORMATS}")

    raw = _load_raw_any(file_path, preload=False)
    sfreq = float(raw.info['sfreq'])

    # 只读前 duration_sec 的数据
    n_samples = min(int(duration_sec * sfreq), raw.n_times)

    if eeg_only:
        picks = _pick_eeg_channels(raw, max_channels=max_channels)
    else:
        picks = list(range(len(raw.ch_names)))

    raw.pick(picks)
    ch_names = [raw.ch_names[i] for i in range(len(raw.ch_names))]

    # 加载数据（统一转 μV）
    data_uv = _raw_to_uv(raw, start=0, stop=n_samples)
    times = raw.times[:n_samples]
    
    return data_uv, ch_names, sfreq, times


def fast_preview_window(file_path: str, duration_sec: float = 8.0,
                         max_channels: int = MAX_PREVIEW_CHANNELS) -> Dict[str, Any]:
    """快速提取波形预览窗口（原始μV数据，无偏移无归一化）
    
    Returns:
        times: 时间轴列表
        channels: {通道名: [μV值]} — 仅去直流偏置，保留真实振幅
        sampling_rate, duration_seconds, channel_names
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported format: {ext}. Supported: {SUPPORTED_FORMATS}")

    raw = _load_raw_any(file_path, preload=False)
    sfreq = float(raw.info['sfreq'])

    picks = _pick_eeg_channels(raw, max_channels=max_channels)[:max_channels]
    raw.pick(picks)
    ch_names = [raw.ch_names[i] for i in range(len(raw.ch_names))]
    n_ch = len(ch_names)

    # 取前8秒数据（统一转 μV）
    total_n = min(int(duration_sec * sfreq), raw.n_times)
    data_uv = _raw_to_uv(raw, start=0, stop=total_n)
    times = raw.times[:total_n]
    
    # 下采样点数随时长增加：保留足够采样率以显示真实高频细节（避免波形过于平滑、像假的）
    target_points = min(20000, max(2000, int(round(duration_sec * 80))))
    step = max(1, len(times) // target_points)
    if len(times) // step < 500:
        step = max(1, len(times) // 500)
    
    times_plot = times[::step]
    channels_data = {}
    
    for i in range(n_ch):
        x = data_uv[i].copy().astype(np.float64)
        # 仅去直流偏置（减中位数），保留真实振幅
        x = x - np.nanmedian(x)
        channels_data[ch_names[i]] = x[::step].astype(float).tolist()
    
    return {
        "times": times_plot.astype(float).tolist(),
        "channels": channels_data,
        "sampling_rate": sfreq,
        "duration_seconds": float(times_plot[-1]) if len(times_plot) > 0 else 0.0,
        "channel_names": ch_names,
    }


def quick_bandpower(data_uv: np.ndarray, sfreq: float) -> Dict[str, Any]:
    """快速计算频段功率（只取前30s数据，快速Welch）
    
    Args:
        data_uv: (n_ch, n_times) in microvolts
        sfreq: 采样率
        
    Returns:
        {bandpower, average_bandpower, bandpower_percent, dominant_frequency,
         frequency_distribution, relative_bandpower}
    """
    # 限制数据长度：最多用60s，最少用10s
    max_samples = min(int(60 * sfreq), data_uv.shape[1])
    min_samples = int(10 * sfreq)
    if data_uv.shape[1] < min_samples:
        data = data_uv  # 使用全部数据
    else:
        data = data_uv[:, :max_samples]
    
    n_ch, n_samples = data.shape
    
    # Welch 参数：3s窗口，50%重叠（更快计算）
    nperseg = min(int(3.0 * sfreq), 1024, n_samples)
    if nperseg < 16:
        nperseg = max(16, n_samples // 4)
    noverlap = nperseg // 2
    
    # 如果通道数 > 8，对通道平均后再做 Welch（大幅提升速度，对频段分布影响小）
    if n_ch > 8:
        avg_data = np.mean(data, axis=0)  # (n_samples,)
        freqs, psd = welch(avg_data, fs=sfreq, nperseg=nperseg,
                           noverlap=noverlap, window='hann',
                           detrend='constant', scaling='density')
        all_psds = psd.reshape(1, -1)  # (1, n_freq)
        n_psd = 1
    else:
        all_psds_list = []
        freqs = None
        for ch_data in data:
            f, p = welch(ch_data, fs=sfreq, nperseg=nperseg,
                         noverlap=noverlap, window='hann',
                         detrend='constant', scaling='density')
            if freqs is None: freqs = f
            all_psds_list.append(p)
        all_psds = np.array(all_psds_list)  # (n_ch, n_freq)
        n_psd = n_ch
    
    df = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
    
    bandpower = {}
    average_bandpower = {}
    relative_bandpower = {}
    
    total_power_per_ch = np.sum(all_psds, axis=1) * df
    
    for band_name, (fmin, fmax) in BANDS.items():
        # gamma 上限按采样率截断（奈奎斯特约束），低频段不受影响
        lo, hi = band_limits(band_name, sfreq)
        band_mask = (freqs >= lo) & (freqs <= hi)
        # NumPy 2.x removed np.trapz → use np.trapezoid with fallback
        _trapz = getattr(np, 'trapezoid', getattr(np, 'trapz', None))
        if _trapz is None:
            # 最终回退：矩形积分求和
            band_power = np.array([float(np.sum(psd[band_mask]) * df) for psd in all_psds])
        else:
            band_power = np.array([float(_trapz(psd[band_mask], dx=df)) for psd in all_psds])
        bandpower[band_name] = band_power.tolist()
        avg = float(np.mean(band_power))
        average_bandpower[band_name] = avg
        rel = float(avg / (np.mean(total_power_per_ch) + 1e-20) * 100)
        relative_bandpower[band_name] = rel
    
    # 主频率
    avg_psd = np.mean(all_psds, axis=0)
    peak_mask = (freqs >= 1.5) & (freqs <= 40.0)
    masked = avg_psd[peak_mask]
    if len(masked) > 0:
        peak_idx = np.argmax(masked)
        dominant_frequency = float(freqs[peak_mask][peak_idx])
    else:
        dominant_frequency = 10.0
    
    # 频率分布（用于图表，覆盖全频段至 100Hz，降采样至<=200点，确保足够细节）
    freq_dist = []
    display_hi = min(100.0, np.max(freqs))
    display_mask = (freqs >= 1.5) & (freqs <= display_hi)
    display_freqs = freqs[display_mask]
    display_psd = avg_psd[display_mask]
    # 至少保留 64 个点，最多 200 个点
    target_n = max(64, min(200, len(display_freqs)))
    step = max(1, len(display_freqs) // target_n)
    for i in range(0, len(display_freqs), step):
        freq_dist.append({
            "frequency": float(display_freqs[i]),
            "power": float(display_psd[i])
        })
    
    # bandpower_percent for enhanced output
    bp_total = sum(average_bandpower.values())
    bandpower_percent = {k: f"{v/bp_total*100:.1f}%" for k, v in average_bandpower.items()} if bp_total > 0 else {k: "0%" for k in average_bandpower}
    
    return {
        "bandpower": average_bandpower,
        "average_bandpower": average_bandpower,
        "bandpower_percent": bandpower_percent,
        "dominant_frequency": dominant_frequency,
        "frequency_distribution": freq_dist,
        "frequency_distribution_array": freq_dist,
        "relative_bandpower": relative_bandpower,
    }


def quick_signal_quality(data_uv: np.ndarray, ch_names: List[str], lang: str = "zh", sfreq: float = 250.0) -> Dict[str, Any]:
    """多维度信号质量评估 — 七项相加 = 满分 100（无 × 系数）

    评分体系（七项直接相加，每项已计算为目标满分）：
      SNR 信噪比        : 0~15 分（EEG 频段功率 vs 高频噪声）
      通道一致性        : 0~10 分（相邻通道空间相关性）
      频谱特征质量      : 0~15 分（alpha 峰 + 1/f 衰减 + 频谱熵）
      基础分            : 0 或 25 分（二元：虚假文件/平坦→0；真实脑电→25）
      伪影水平          : 0~10 扣分（峰度/异常值/尖峰/高频污染）
      数据完整性        : 0~15 扣分（缺失/削波/平坦通道）
      基线稳定性        : 0~10 扣分（慢漂移）

    总分 = SNR + 一致性 + 频谱 + 基础 − 伪影 − 完整性 − 漂移，clamp 0~100。
    """
    import i18n

    n_ch, n_samples = data_uv.shape

    if n_samples < 100:
        return {
            "signal_quality_score": 0.0,
            "noisy_channels": [],
            "possible_artifacts": [i18n.get_artifact_text(lang, "short_recording")],
            "missing_data": False,
            "clipping_detected": False,
            "high_frequency_noise": False,
            "quality_details": {"average_variance": 0, "max_variance": 0, "outlier_percentage": 0,
                                "snr_component": 0.0, "consistency_component": 0.0,
                                "spectral_component": 0.0, "base_score": 0.0,
                                "artifact_penalty": 0.0, "integrity_penalty": 0.0, "drift_penalty": 0.0},
        }

    # ── 预计算 ──────────────────────────────────────
    variances = np.var(data_uv, axis=1)
    var_mean = float(np.mean(variances))
    var_std = float(np.std(variances))
    stds = np.std(data_uv, axis=1, keepdims=True)
    means = np.mean(data_uv, axis=1, keepdims=True)

    # ── 平坦 / 无信号（死电极、断连、全零）→ 视为无效记录，直接 0 分 ──
    # 真实 EEG 必有来自神经活动的方差（通常 std ≫ 0.1 µV，方差 ≫ 1e-2），
    # 不会触发此分支。仅当整段信号几乎无起伏时才判为"零分假文件"。
    if var_mean <= 1e-3:
        return {
            "signal_quality_score": 0.0,
            "noisy_channels": list(ch_names),
            "possible_artifacts": [i18n.get_artifact_text(lang, "flat_no_signal")],
            "missing_data": True,
            "clipping_detected": False,
            "high_frequency_noise": False,
            "quality_details": {
                "average_variance": round(var_mean, 6),
                "max_variance": round(float(np.max(variances)), 6),
                "outlier_percentage": 0.0,
                "snr_component": 0.0, "consistency_component": 0.0,
                "spectral_component": 0.0, "base_score": 0.0,
                "artifact_penalty": 0.0, "integrity_penalty": 0.0, "drift_penalty": 0.0,
            },
        }

    # ── 组件 1: SNR 信噪比 (0~15分) ─────────────────
    # Welch PSD 每通道
    nperseg = min(int(4.0 * min(sfreq, n_samples // 30)), 1024, n_samples)
    nperseg = max(nperseg, 16)
    noverlap = nperseg // 2

    snr_scores = []
    for ch_data in data_uv:
        try:
            freqs, psd = welch(ch_data, fs=min(sfreq, n_samples // 4 if n_samples >= sfreq else sfreq),
                               nperseg=nperseg, noverlap=noverlap, window='hann',
                               detrend='constant', scaling='density')
            df = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
            _trapz = getattr(np, 'trapezoid', getattr(np, 'trapz', None))

            # EEG 频段功率 (1-40 Hz)
            eeg_mask = (freqs >= 1) & (freqs <= 40)
            if _trapz is not None:
                eeg_power = float(_trapz(psd[eeg_mask], dx=df))
            else:
                eeg_power = float(np.sum(psd[eeg_mask]) * df)

            # 高频噪声功率 (50-125 Hz, 或 Nyquist 以下)
            # 注意: scipy.signal.welch 返回的 freqs[-1] 已经是 fs/2 (Nyquist)
            fmax = freqs[-1] if len(freqs) > 1 else 62.5
            noise_hi = max(50, min(125, fmax * 0.9))
            noise_lo = max(50, noise_hi * 0.4)
            noise_mask = (freqs >= noise_lo) & (freqs <= noise_hi)
            if np.any(noise_mask) and _trapz is not None:
                noise_power = float(_trapz(psd[noise_mask], dx=df))
            else:
                noise_power = float(np.sum(psd[freqs > max(50, len(freqs) // 4)]) * df) if len(freqs) > 50 else 1e-10

            # 用安全下限避免 0/0：平坦/无信号(eeg≈0)时 snr_db≈0，而非误判为"极干净"
            snr_db = 10 * np.log10(max(eeg_power, 1e-12) / max(noise_power, 1e-12))
            if eeg_power < 1e-6:
                snr_db = -40.0  # 实质上无 EEG 频段能量（平坦/断连）→ 视为最差，避免误给保底分

            # 映射到 0~15 分（直接是目标满分，无需 × 系数）
            # 典型 EEG 10~20dB 会落在 7~15/15 之间，而非全部满分。
            if snr_db >= 25:
                s = 15.0
            elif snr_db >= 0:
                s = 6.0 + snr_db * 0.45          # 0→6, 20→15
            elif snr_db >= -10:
                s = max(0.0, 6.0 + snr_db * 0.6)  # -10→0, 0→6
            else:
                s = 0.0
            snr_scores.append(s)
        except Exception:
            snr_scores.append(12.0)  # 中等默认值

    component_snr = float(np.mean(snr_scores)) if snr_scores else 20.0

    # ── 组件 2: 通道一致性 (0~10分) ───────────────────
    # 计算相邻通道间的 Pearson 相关系数（取所有通道对的均值）
    if var_mean <= 1e-6:
        # 全平坦/无信号：通道间无任何有意义的差异，一致性视为 0
        avg_correlation = 0.0
    elif n_ch >= 2:
        # 为效率只取前 5000 个样本点做相关
        corr_n = min(5000, n_samples)
        corr_data = data_uv[:, :corr_n]
        # 去直流
        corr_data = corr_data - np.mean(corr_data, axis=1, keepdims=True)
        # 标准化
        corr_norms = np.linalg.norm(corr_data, axis=1, keepdims=True)
        corr_norms = np.where(corr_norms > 1e-10, corr_norms, 1.0)
        corr_normalized = corr_data / corr_norms
        # 取前 min(16, n_ch) 个通道计算平均相关性
        n_corr_ch = min(16, n_ch)
        corr_matrix = np.corrcoef(corr_normalized[:n_corr_ch])
        # 取上三角（不含对角）
        triu_idx = np.triu_indices(n_corr_ch, k=1)
        if len(triu_idx[0]) > 0:
            avg_correlation = float(np.mean(corr_matrix[triu_idx]))
        else:
            avg_correlation = 0.5
    else:
        avg_correlation = 0.5

    # 相关性映射：指数逼近曲线，直接输出 0~10 分（目标满分）
    # 0→1.0, 0.01→1.85, 0.05→4.55, 0.10→6.7, 0.20→8.8, 0.50→10.0
    component_consistency = max(0.0, min(10.0, 1.0 + 9.0 * (1.0 - np.exp(-abs(avg_correlation) / 0.10))))

    # ── 组件 3: 伪影检测 (0 ~ -10分扣分) ──────────────
    # 3a. 峰度异常
    data_centered = data_uv - means
    m2 = np.mean(data_centered ** 2, axis=1)
    m4 = np.mean(data_centered ** 4, axis=1)
    kurt = np.where(m2 > 0, m4 / (m2 ** 2), 0)

    # 3b. 幅度异常值比例 (>±150μV 或 >±4倍标准差)
    safe_stds = np.where(stds > 0, stds, 1.0)
    large_amp_mask = np.abs(data_uv - means) > 4 * safe_stds
    extreme_amp_mask = np.abs(data_uv) > 150  # μV
    outlier_total = int(np.sum(large_amp_mask)) + int(np.sum(extreme_amp_mask))
    outlier_pct = outlier_total / max(1, n_ch * n_samples)

    # 3c. 高频噪声梯度
    diffs = np.diff(data_uv, axis=1)
    grad_stds = np.std(diffs, axis=1)
    mean_grad = float(np.mean(grad_stds))

    # 伪影扣分（所有指标连续评分，无二值门槛）
    artifact_penalty = 0.0
    noisy_channels_list = []

    # 逐通道连续噪声严重度——每个维度输出连续值 0~1，不设"通不通关"门槛
    ch_noise_scores = []
    for i in range(n_ch):
        score = 0.0
        # 峰度偏离正常值 (3.0)：偏离越大贡献越多，3.0→0, 10→0.2, 50→0.5
        kurt_val = kurt[i]
        if kurt_val > 0:
            score += min(0.5, abs(kurt_val - 3.0) / 60)
        # 方差偏离整体均值比：比值 1→0, 0.1 或 10→0.3
        if var_mean > 1e-12:
            var_ratio = variances[i] / var_mean
            ratio_dev = abs(np.log10(max(var_ratio, 1e-6)))
            score += min(0.3, ratio_dev / 2.0)
        # 梯度偏离均值比：同上
        if mean_grad > 1e-12:
            grad_ratio = grad_stds[i] / mean_grad
            grad_dev = abs(np.log10(max(grad_ratio, 1e-6)))
            score += min(0.3, grad_dev / 2.0)
        # 峰度接近 0 表示平坦信号
        if 0 < kurt_val < 0.5:
            score += min(0.2, (0.5 - kurt_val) * 0.5)

        ch_noise_scores.append(score)
        if score > 0.2:
            noisy_channels_list.append(ch_names[i])

    # 连续噪声总分（所有通道加和），映射到惩罚分
    total_noise = sum(ch_noise_scores)
    artifact_penalty += min(total_noise * 4, 10)        # 连续得分 → 0~10 分

    # 异常值比例（已是连续）
    artifact_penalty += min(outlier_pct * 300, 5)      # 异常值比例: 0~5 分

    # 尖峰检测（连续映射：150μV→0.5, 250μV→2, 600μV→5, >1000μV→8）
    max_amp = float(np.max(np.abs(data_uv)))
    if max_amp > 150:
        spike_score = min(5, (max_amp - 150) / 100)
        artifact_penalty += spike_score

    # ── 瞬态尖峰样活动检测（客观指标，供 AI 解释描述信号特征）────
    # 定义：单个样本相对所在通道基线偏移 > 3×通道标准差（尖峰样快速偏转）。
    # 指标 = 各通道"活跃通道占比"的中位数 + 活跃通道数，只做统计描述，不做疾病推断。
    transient_ratio = 0.0
    transient_channels = 0
    if n_samples > 50 and n_ch > 0:
        _safe_std = np.where(stds > 0, stds, 1.0)
        _trans_abs = np.abs(data_uv - means) > 3 * _safe_std
        per_ch_ratio = np.mean(_trans_abs, axis=1)
        transient_ratio = float(np.median(per_ch_ratio))
        # 活跃通道：该通道瞬态样本占比 > 0.5%
        transient_channels = int(np.sum(per_ch_ratio > 0.005))
    # 级别判定：以"活跃通道覆盖比例"为主（尖峰样活动通常广泛分布），ratio 为辅
    ch_cover = (transient_channels / n_ch) if n_ch else 0.0
    transient_activity_level = "none"
    if ch_cover >= 0.5 or (ch_cover >= 0.3 and transient_ratio > 0.008):
        transient_activity_level = "high"
    elif ch_cover >= 0.35 or (ch_cover >= 0.2 and transient_ratio > 0.006):
        transient_activity_level = "moderate"
    elif ch_cover > 0.15 and transient_ratio > 0.002:
        transient_activity_level = "mild"

    artifact_penalty = min(artifact_penalty, 10)

    # ── 组件 4: 频谱特征质量 (0~15分，直接目标满分) ─────
    spectral_score = 0.0
    try:
        # 取一个代表性通道（方差最接近中位数的）
        median_var_idx = int(np.argpartition(np.abs(variances - np.median(variances)), 0)[0])
        rep_data = data_uv[median_var_idx]
        r_freqs, r_psd = welch(rep_data, fs=sfreq, nperseg=nperseg, noverlap=noverlap,
                                window='hann', detrend='constant', scaling='density')
        r_df = r_freqs[1] - r_freqs[0] if len(r_freqs) > 1 else 1.0
        _trapz = getattr(np, 'trapezoid', getattr(np, 'trapz', None))

        # Alpha 带 (8-13Hz) 峰值：连续评分，ratio 1.0→0, 1.3→3.5（极宽松）
        alpha_mask = (r_freqs >= 8) & (r_freqs <= 13)
        alpha_psd = r_psd[alpha_mask] if np.any(alpha_mask) else np.array([0])
        if len(alpha_psd) > 2:
            alpha_max_ratio = float(np.max(alpha_psd)) / (float(np.mean(alpha_psd)) + 1e-12)
            spectral_score += min(5.0, max(0.0, (alpha_max_ratio - 1.0) / 0.3 * 5.0))

        # 频谱斜率（低频应比高频强 — 1/f 特征）：连续评分，ratio_db 0→0, 3→4（极宽松）
        low_mask = (r_freqs >= 2) & (r_freqs <= 10)
        high_mask = (r_freqs >= 30) & (r_freqs <= 60)
        if _trapz is not None and np.any(low_mask) and np.any(high_mask):
            low_pow = _trapz(r_psd[low_mask], dx=r_df)
            high_pow = _trapz(r_psd[high_mask], dx=r_df)
            if high_pow > 1e-12:
                ratio_db = 10 * np.log10(max(low_pow, 1e-12) / high_pow)
                spectral_score += min(6.0, max(0.0, ratio_db / 3.0 * 6.0))

        # 频谱熵：低熵 = 谱结构清晰（如 alpha 峰），高熵 = 平坦/噪声。连续评分 0~3.5
        if len(r_psd) > 10:
            psd_norm = r_psd / (np.sum(r_psd) + 1e-12)
            spectral_entropy = -np.sum(psd_norm * np.log2(psd_norm + 1e-12))
            max_entropy = np.log2(len(r_psd))
            entropy_norm = min(1.0, max(0.0, spectral_entropy / max_entropy))
            spectral_score += min(5.0, max(0.0, (1.0 - entropy_norm) * 5.0))

        # 高频污染检测（肌电/工频噪声）：30–100Hz 功率相对 1–30Hz 过高 → 伪影
        hf_mask = (r_freqs >= 30) & (r_freqs <= 100)
        band_mask = (r_freqs >= 1) & (r_freqs <= 30)
        if _trapz is not None and np.any(hf_mask) and np.any(band_mask):
            hf_pow = _trapz(r_psd[hf_mask], dx=r_df)
            band_pow = _trapz(r_psd[band_mask], dx=r_df)
            if band_pow > 1e-12:
                hf_ratio = hf_pow / band_pow
                # 正常脑电 hf_ratio < 0.10；肌电伪影可达 0.3~1.0
                artifact_penalty += min(max(0.0, hf_ratio - 0.08) * 25, 5)
    except Exception:
        spectral_score = 6.0  # 默认中等

    spectral_score = min(15, max(0, spectral_score))

    # ── 组件 5: 数据完整性 (0 ~ -15分扣分) ─────────────
    integrity_penalty = 0.0
    n_flat = 0
    flat_channels = []

    # 5a. 缺失数据
    has_missing = bool(np.any(~np.isfinite(data_uv)))
    if has_missing:
        integrity_penalty += 5

    # 5b. 削波检测（连续评分：接近削波边界的样本比例越大扣分越多）
    # 1% 以下的自然信号峰值不视为削波，超过 1% 后 clip_ratio × 200 连续递增
    clipping_detected = False
    clip_scores = []
    for i in range(n_ch):
        max_abs = float(np.max(np.abs(data_uv[i])))
        if max_abs > 0:
            near_max_count = int(np.sum(np.abs(data_uv[i]) > 0.99 * max_abs))
            clip_ratio = near_max_count / n_samples
            if clip_ratio > 0.01:
                clipping_detected = True
                clip_scores.append(min(6, clip_ratio * 200))
    if clip_scores:
        integrity_penalty += float(np.mean(clip_scores))

    # 5c. 平坦通道（方差极低，可能是断连）
    if var_mean > 0:
        flat_threshold = var_mean * 0.0005
        n_flat = int(np.sum(variances < flat_threshold))
        if n_flat > 0:
            integrity_penalty += min(n_flat * 3, 8)
            flat_channels = [ch_names[i] for i in range(n_ch) if variances[i] < flat_threshold]

    integrity_penalty = min(integrity_penalty, 15)

    # ── 组件 6: 基线稳定性 (0 ~ -10分扣分) ─────────────
    # 慢漂移检测：逐通道计算绝对漂移量（μV），避免比值法被大幅信号掩盖
    drift_penalty = 0.0
    if n_samples > 500:
        seg_size = n_samples // 4
        ch_drifts = []
        for i in range(n_ch):
            ch_data = data_uv[i]
            ch_seg_means = [float(np.mean(ch_data[j*seg_size:(j+1)*seg_size])) for j in range(4)]
            ch_drift = max(ch_seg_means) - min(ch_seg_means)  # 绝对漂移量 μV
            ch_drifts.append(ch_drift)
        if ch_drifts:
            mean_drift = float(np.mean(ch_drifts))  # 所有通道平均漂移 μV
            # 连续映射：0μV→0, 20μV→8（满分）。无门槛，微弱漂移也扣分。
            drift_penalty = max(0.0, min(10.0, mean_drift / 20.0 * 10.0))

    # ── 合成/伪造 EEG 检测 ─────────────────────────────────
    # (已禁用 - 用户要求回滚)
    possible_artifacts = []

    # ── 基础分 (0~8) — 真实可用脑电活动的连续质量评估 ──────────
    # 旧逻辑把正常文件直接顶到 8 分（再 ×3.125 变成 25/25），只给完全不可用文件 0 分，
    # ── 基础分 (0 或 25) — 二元：要么虚假文件零分，要么满分 ──────
    # 不再做连续惩罚。判定"是脑电"则满分 25，否则 0。
    n_seriously_noisy = sum(1 for s in ch_noise_scores if s > 0.4)
    median_var = float(np.median(variances))
    is_effectively_flat = (var_mean <= 1e-6) and (n_flat > n_ch * 0.5)
    # 二元判定：是真实脑电 → 25 分；否则 → 0 分
    if is_effectively_flat or var_mean <= 1e-3 or median_var < 0.001:
        base_score = 0.0
    else:
        base_score = 25.0

    # ── 最终评分组装（无 × factor 系数，直接各分量按目标满分相加）──────────
    # SNR(0~15) + 一致性(0~10) + 频谱(0~15) + 基础(0/25) + 伪影(10→0) + 完整性(15→0) + 漂移(10→0)
    quality_score = (
        component_snr                     # 0~15（已直接计算为目标值）
        + component_consistency           # 0~10
        + spectral_score                  # 0~15
        + base_score                      # 0 或 25
        + (10.0 - artifact_penalty)        # 10 → 0
        + (15.0 - integrity_penalty)       # 15 → 0
        + (10.0 - drift_penalty)           # 10 → 0
    )

    # 七项全加 = 满分 100。clamp 到 0~100。
    quality_score = max(0.0, min(100.0, quality_score))

    # ── 伪影描述文本 ──────────────────────────────────
    # possible_artifacts 已在前面的合成检测中初始化
    if len(noisy_channels_list) > n_ch * 0.15:
        possible_artifacts.append(i18n.get_artifact_text(lang, "many_noisy_channels"))
    if np.any(np.abs(data_uv) > 250):
        possible_artifacts.append(i18n.get_artifact_text(lang, "large_values"))
    if outlier_pct > 0.02:
        possible_artifacts.append(i18n.get_artifact_text(lang, "many_outliers"))
    if transient_activity_level != "none":
        # 客观信号特征描述（不涉及疾病判断）
        _tlv = i18n.get_artifact_text(lang, "transient_level_" + transient_activity_level)
        possible_artifacts.append(
            i18n.get_artifact_text(lang, "transient_spikes", _tlv,
                                   f"{transient_ratio * 100:.1f}", transient_channels, n_ch)
        )
    if clipping_detected:
        possible_artifacts.append(i18n.get_artifact_text(lang, "clipping"))
    if drift_penalty >= 3:
        possible_artifacts.append(i18n.get_artifact_text(lang, "baseline_drift"))
    if flat_channels:
        possible_artifacts.append(i18n.get_artifact_text(lang, "flat_channels", len(flat_channels)))

    print(f"[QualityScore] score={quality_score:.1f}  snr={component_snr:.1f}  consistency={component_consistency:.1f}  spectral={spectral_score:.1f}  base={base_score:.1f}  artifact_pen={artifact_penalty:.1f}  integrity_pen={integrity_penalty:.1f}  drift_pen={drift_penalty:.1f}")
    return {
        "signal_quality_score": quality_score,
        "noisy_channels": noisy_channels_list,
        "possible_artifacts": possible_artifacts,
        "missing_data": has_missing,
        "clipping_detected": clipping_detected,
        "high_frequency_noise": mean_grad > var_mean * 5 if var_mean > 0 else False,
        "quality_details": {
            "average_variance": round(var_mean, 4),
            "max_variance": round(float(np.max(variances)), 4),
            "outlier_percentage": round(outlier_pct * 100, 3),
            "snr_component": round(component_snr, 2),
            "consistency_component": round(component_consistency, 2),
            "spectral_component": round(spectral_score, 2),
            "artifact_penalty": round(artifact_penalty, 2),
            "integrity_penalty": round(integrity_penalty, 2),
            "drift_penalty": round(drift_penalty, 2),
            "base_score": round(base_score, 2),
            "transient_activity": {
                "level": transient_activity_level,
                "ratio_pct": round(transient_ratio * 100, 2),
                "channels": transient_channels,
                "max_amplitude_uv": round(max_amp, 1),
            },
        },
    }


def quick_literacy_scores(quality: Dict, overview: Dict) -> Dict[str, float]:
    """快速计算可读性评分 —— 每项使用不同因子，确保分数差异化"""
    score = quality.get("signal_quality_score", 50.0)
    qd = quality.get("quality_details", {})
    noisy_count = len(quality.get("noisy_channels", []))
    artifact_count = len(quality.get("possible_artifacts", []))
    clipping = quality.get("clipping_detected", False)
    ch_count = overview.get("channel_count", 16)
    duration = overview.get("duration_seconds", 60)

    # ── 细粒度组件（用于差异化）──
    snr_c = float(qd.get("snr_component", 20))
    cons_c = float(qd.get("consistency_component", 15))
    spec_c = float(qd.get("spectral_component", 8))
    art_p = float(qd.get("artifact_penalty", 2))
    int_p = float(qd.get("integrity_penalty", 1))
    drf_p = float(qd.get("drift_penalty", 1))

    # ① 可靠性评估：侧重数据完整性和通道一致性 + 基础质量
    # 高分条件：数据完整、无缺失、通道间一致、基础分高
    reliability_base = min(100, max(0, cons_c * 3.5))       # 一致性放大到 ~70 满量程
    integrity_deduction = int_p * 4 + drf_p * 3              # 完整性+漂移扣分
    learning_readability = min(100, max(5, reliability_base - integrity_deduction + 10))

    # ② 信号清晰度：侧重 SNR 和伪影水平（与可靠性完全不同的因子组合）
    clarity_base = min(100, max(5, snr_c * 3.8))             # SNR 放大为主因子
    art_deduction = art_p * 4                                 # 伪影重扣
    clip_penalty = 12 if clipping else 0
    signal_clarity = min(100, max(5, clarity_base - art_deduction - clip_penalty + 5))

    # ③ 入口友好度：综合难度——通道数适中(8-32)、时长足够(>30s)、噪声少
    ch_ideal = 8 <= ch_count <= 32                            # 适中通道数加分
    dur_ok = duration >= 30                                   # 时长够用
    ch_factor = 25 if ch_ideal else (10 if 4 <= ch_count <= 64 else 0)
    dur_factor = 15 if dur_ok else max(0, int(duration / 60 * 7))
    noise_factor = max(0, 18 - (noisy_count * 5 + artifact_count * 6))
    beginner_friendliness = min(100, max(5, ch_factor + dur_factor + noise_factor + 22))

    # ④ 研究可用性：需要多通道 + 长时长 + 高 SNR + 频谱丰富
    ch_research = min(35, max(0, ch_count * 1.2))            # 多通道加分
    dur_research = min(30, max(0, int(duration / 120)))      # 长记录加分
    snr_research = min(25, max(0, snr_c * 1.0))
    spec_research = min(10, max(0, spec_c * 1.1))
    research_usefulness = min(100, max(5, ch_research + dur_research + snr_research + spec_research))

    # ⑤ 噪声复杂度：越高表示越难处理
    complexity = min(100, max(0,
        noisy_count * 5 + artifact_count * 8 + (18 if clipping else 0)
        + round(art_p * 1.5) + round(drf_p * 2.0)
    ))

    return {
        "learning_readability_score": round(learning_readability, 1),
        "signal_clarity_score": round(signal_clarity, 1),
        "beginner_friendliness_score": round(beginner_friendliness, 1),
        "research_usefulness_score": round(research_usefulness, 1),
        "noise_complexity_score": round(complexity, 1),
    }


def quick_band_waveforms_from_data(data_uv: np.ndarray, sfreq: float, times: np.ndarray) -> Dict[str, Any]:
    """计算频段波形（Delta/Theta/Alpha/Beta/Gamma）—— 使用已加载数据，无需重复读文件
    
    返回 {times, delta, theta, alpha, beta, gamma}
    """
    try:
        n_samples = data_uv.shape[1]
        times_list = times.tolist()
        nyq = sfreq / 2
        result: Dict[str, Any] = {"times": times_list}
        
        for band_name, (low, high) in BANDS.items():
            try:
                lo, hi = band_limits(band_name, sfreq)
                # gamma 在低采样率下若可用带宽过窄则跳过（避免滤波器退化）
                if hi - lo < 2.0:
                    result[band_name] = []
                    continue
                b, a = butter(4, [lo / nyq, hi / nyq], btype="band")
                filtered = filtfilt(b, a, data_uv, axis=1)
                avg = np.nanmean(filtered, axis=0)
                result[band_name] = avg.tolist()
            except Exception as e:
                print(f"[WARN] band waveform {band_name} failed: {e}")
                result[band_name] = []
        
        return result
    except Exception as e:
        print(f"[WARN] quick_band_waveforms_from_data failed: {e}")
        return {"times": [], "delta": [], "theta": [], "alpha": [], "beta": [], "gamma": []}


def quick_band_waveforms(file_path: str, duration_seconds: float = 10.0) -> Dict[str, Any]:
    """计算频段波形（Delta/Theta/Alpha/Beta/Gamma）—— 只读前10s，scipy滤波（独立使用场景）
    
    返回 {times, delta, theta, alpha, beta, gamma}
    """
    try:
        data_uv, ch_names, sfreq, times = fast_load_segment(
            file_path, duration_sec=duration_seconds, eeg_only=True
        )
    except Exception as e:
        print(f"[WARN] quick_band_waveforms: {e}")
        return {"times": [], "delta": [], "theta": [], "alpha": [], "beta": [], "gamma": []}
    
    try:
        n_samples = data_uv.shape[1]
        times_list = times.tolist()
        nyq = sfreq / 2
        result: Dict[str, Any] = {"times": times_list}
        
        for band_name, (low, high) in BANDS.items():
            try:
                lo, hi = band_limits(band_name, sfreq)
                if hi - lo < 2.0:
                    result[band_name] = []
                    continue
                b, a = butter(4, [lo / nyq, hi / nyq], btype="band")
                filtered = filtfilt(b, a, data_uv, axis=1)
                avg = np.nanmean(filtered, axis=0)
                result[band_name] = avg.tolist()
            except Exception as e:
                print(f"[WARN] band waveform {band_name} failed: {e}")
                result[band_name] = []
        
        return result
    except Exception as e:
        print(f"[WARN] quick_band_waveforms filter failed: {e}")
        return {"times": [], "delta": [], "theta": [], "alpha": [], "beta": [], "gamma": []}


# =====================================================================
# 特殊波形检测（尖波/锐波、睡眠纺锤、慢波、K复合波、mu节律、SMR、
# 三相波、周期性放电）——检测到才返回 present=True，报告只显示有的。
# =====================================================================

def _bandpass_uv(data: np.ndarray, lo: float, hi: float, sfreq: float) -> Optional[np.ndarray]:
    nyq = sfreq / 2.0
    hi = min(hi, nyq - 1.0)
    if hi <= lo:
        return None
    b, a = butter(4, [lo / nyq, hi / nyq], btype="band")
    return filtfilt(b, a, data, axis=1)


def _rms_envelope(x: np.ndarray, win: int) -> np.ndarray:
    """逐通道滑动 RMS 包络（每通道一条曲线），win 为窗口采样点数。"""
    kernel = np.ones(win) / win
    out = np.sqrt(np.apply_along_axis(lambda v: np.convolve(v * v, kernel, mode="same"), 1, x))
    return out


def _contiguous_over(over: np.ndarray, gap: int) -> List[np.ndarray]:
    """把过阈值索引按 gap 间隔切分成若干连通段（每个段视为一个事件）。"""
    idx = np.where(over)[0]
    if len(idx) == 0:
        return []
    split_at = np.where(np.diff(idx) > gap)[0] + 1
    return [g for g in np.split(idx, split_at) if len(g) > 0]


def _rel_high_thr(x: np.ndarray, mult: float, floor_uv: float) -> float:
    """相对高阈值：中位数 + max(mult×MAD, floor_uv)。自适应通道波动尺度，避免振幅异常通道失控。"""
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med))) * 1.4826
    return med + max(mult * mad, floor_uv)


def _detect_spikes(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """尖波/锐波（癫痫样放电）：高通 1-40Hz 后检测 <150ms 的相对高幅瞬态尖峰。"""
    try:
        hp = _bandpass_uv(data_uv, 1.0, 40.0, sfreq)
        if hp is None:
            return {"present": False, "count": 0}
        total = 0
        amp_max = 0.0
        hit_chs: List[str] = []
        for i in range(hp.shape[0]):
            x = hp[i]
            thr = _rel_high_thr(x, 10.0, 50.0)
            segs = _contiguous_over(x > thr, int(sfreq * 0.15))
            for g in segs:
                if g[-1] - g[0] <= int(sfreq * 0.15):  # 事件持续 <150ms
                    total += 1
                    peak = float(np.max(x[g[0]:g[-1] + 1]))
                    if peak > amp_max:
                        amp_max = peak
                    if ch_names[i] not in hit_chs:
                        hit_chs.append(ch_names[i])
        if total >= 2:
            return {"present": True, "count": min(total, 200), "channels": hit_chs[:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_spindles(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """睡眠纺锤：11-16Hz 带通，包络连续 >0.5s 的相对超阈值段记为一次纺锤。"""
    try:
        b = _bandpass_uv(data_uv, 11.0, 16.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        env = _rms_envelope(b, int(sfreq * 0.3))
        total = 0
        amp_max = 0.0
        hit_chs: List[str] = []
        for i in range(env.shape[0]):
            e = env[i]
            thr = _rel_high_thr(e, 3.0, 10.0)
            segs = _contiguous_over(e > thr, int(sfreq * 0.5))
            n = sum(1 for g in segs if len(g) >= int(sfreq * 0.5))
            if n:
                total += n
                hit_chs.append(ch_names[i])
                for g in segs:
                    pk = float(np.max(e[g[0]:g[-1] + 1]))
                    if pk > amp_max:
                        amp_max = pk
        if total >= 1:
            return {"present": True, "count": min(total, 100), "channels": hit_chs[:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_slow_waves(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """慢波（0.5-2Hz，深睡）：带通后找相对高幅（8×MAD 且 ≥80µV）的显著慢半波。"""
    from scipy.signal import find_peaks
    try:
        b = _bandpass_uv(data_uv, 0.5, 2.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        total = 0
        amp_max = 0.0
        hit_chs: List[str] = []
        min_dist = int(sfreq * 0.3)
        for i in range(b.shape[0]):
            x = b[i]
            thr = _rel_high_thr(x, 8.0, 80.0)
            prom = max(2.0 * (float(np.median(np.abs(x - np.median(x)))) * 1.4826), 40.0)
            pos_p, _ = find_peaks(x, distance=min_dist, prominence=prom)
            neg_p, _ = find_peaks(-x, distance=min_dist, prominence=prom)
            n = 0
            for p in pos_p:
                if x[p] > thr:
                    n += 1
                    if x[p] > amp_max:
                        amp_max = x[p]
            for p in neg_p:
                if -x[p] > thr:
                    n += 1
            if n >= 2:
                total += n // 2  # 一个慢波 ≈ 一个正半波 + 一个负半波
                hit_chs.append(ch_names[i])
        if total >= 2:
            return {"present": True, "count": min(total, 200), "channels": hit_chs[:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_k_complexes(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """K复合波：0.5-2Hz 的相对极大负向波（10×MAD 且 ≥120µV），睡眠特征。"""
    from scipy.signal import find_peaks
    try:
        b = _bandpass_uv(data_uv, 0.5, 2.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        total = 0
        amp_max = 0.0
        hit_chs: List[str] = []
        min_dist = int(sfreq * 0.4)
        for i in range(b.shape[0]):
            x = b[i]
            med = float(np.median(x))
            mad = float(np.median(np.abs(x - med))) * 1.4826
            thr_neg = med - max(10.0 * mad, 120.0)  # 大负波阈值
            prom = max(3.0 * mad, 50.0)
            neg_p, _ = find_peaks(-x, distance=min_dist, prominence=prom)
            det = [p for p in neg_p if x[p] < thr_neg]
            n = len(det)
            if n:
                total += n
                hit_chs.append(ch_names[i])
                for p in det:
                    dip = float(med - x[p])  # 偏离中值的负向深度
                    if dip > amp_max:
                        amp_max = dip
        if total >= 1:
            return {"present": True, "count": min(total, 100), "channels": hit_chs[:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_mu_rhythm(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """Mu 节律（8-13Hz，中央区）：优先看中央区通道（C3/C4/Cz/CP 等）的 alpha 包络强度。"""
    try:
        def _is_central(nm: str) -> bool:
            up = re.sub(r"[^A-Z0-9]", "", nm.upper())  # "EEG C4" -> "EEGC4"
            if "C" not in up:
                return False
            if re.search(r"[FPTO]", up.replace("C", "")):  # 去掉 C 后仍含 F/P/T/O → 非纯中央
                return False
            return True
        central = [i for i, nm in enumerate(ch_names) if _is_central(nm)]
        if not central:
            return {"present": False, "count": 0}
        sub = data_uv[central]
        b = _bandpass_uv(sub, 8.0, 13.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        env = _rms_envelope(b, int(sfreq * 0.4))
        med = float(np.median(env))
        mad = float(np.median(np.abs(env - med))) * 1.4826
        thr = med + max(3.0 * mad, 10.0)
        frac = float(np.mean(env > thr))
        if frac > 0.15:  # 超阈值时间占比 >15%
            amp_max = float(np.max(env[env > thr])) if np.any(env > thr) else 0.0
            return {"present": True, "count": int(round(frac * env.shape[1] / sfreq)),
                    "channels": [ch_names[i] for i in central][:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_smr(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """SMR 感觉运动节律（12-15Hz）：全通道平均包络强度。"""
    try:
        b = _bandpass_uv(data_uv, 12.0, 15.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        env = _rms_envelope(b, int(sfreq * 0.4))
        med = float(np.median(env))
        mad = float(np.median(np.abs(env - med))) * 1.4826
        thr = med + max(3.0 * mad, 8.0)
        frac = float(np.mean(env > thr))
        if frac > 0.15:
            amp_max = float(np.max(env[env > thr])) if np.any(env > thr) else 0.0
            return {"present": True, "count": int(round(frac * env.shape[1] / sfreq)),
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_triphasic(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """三相波（1-3Hz，负-正-负，代谢性脑病）：检测单个周期内至少 3 次极性交替的高幅波。"""
    from scipy.signal import find_peaks
    try:
        b = _bandpass_uv(data_uv, 1.0, 3.0, sfreq)
        if b is None:
            return {"present": False, "count": 0}
        total = 0
        amp_max = 0.0
        hit_chs: List[str] = []
        for i in range(b.shape[0]):
            x = b[i]
            mad = float(np.median(np.abs(x - np.median(x)))) * 1.4826
            prom = max(3.0 * mad, 30.0)
            pos_p, _ = find_peaks(x, distance=int(sfreq * 0.15), prominence=prom)
            neg_p, _ = find_peaks(-x, distance=int(sfreq * 0.15), prominence=prom)
            # 组合交替序列长度
            events = sorted([(p, 1) for p in pos_p] + [(p, -1) for p in neg_p])
            alt = 0
            prev_sign = 0
            for _, s in events:
                if s != prev_sign:
                    alt += 1
                    prev_sign = s
            n_tri = alt // 3  # 每 3 次交替 ≈ 一个三相波
            if n_tri >= 2:
                total += n_tri
                hit_chs.append(ch_names[i])
                for p, s in events:
                    pk = float(x[p]) if s > 0 else -float(x[p])
                    if pk > amp_max:
                        amp_max = pk
        if total >= 1:
            return {"present": True, "count": total, "channels": hit_chs[:6],
                    "amplitude_uv": round(amp_max, 1)}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def _detect_periodic(data_uv: np.ndarray, ch_names: List[str], sfreq: float) -> Dict[str, Any]:
    """周期性放电（如 PLEDs）：基于尖峰事件时间间隔的规律性判断。"""
    try:
        hp = _bandpass_uv(data_uv, 1.0, 40.0, sfreq)
        if hp is None:
            return {"present": False, "count": 0}
        best = 0
        amp_max = 0.0
        for i in range(hp.shape[0]):
            x = hp[i]
            med = float(np.median(x))
            mad = float(np.median(np.abs(x - med))) * 1.4826
            thr = med + max(6.0 * mad, 45.0)
            segs = _contiguous_over(x > thr, int(sfreq * 0.2))
            times = [(g[0] + g[-1]) / 2.0 / sfreq for g in segs if g[-1] - g[0] <= int(sfreq * 0.2)]
            # 记录这些规律尖峰段的最大峰值
            for g in segs:
                if g[-1] - g[0] <= int(sfreq * 0.2):
                    pk = float(np.max(x[g[0]:g[-1] + 1]))
                    if pk > amp_max:
                        amp_max = pk
            if len(times) >= 4:
                diffs = np.diff(times)
                if len(diffs) >= 3:
                    cv = float(np.std(diffs) / (np.mean(diffs) + 1e-9))
                    if cv < 0.3:  # 间隔高度规律
                        best = max(best, len(times))
        if best >= 4:
            return {"present": True, "count": best,
                    "amplitude_uv": round(amp_max, 1) if amp_max > 0 else 0.0}
        return {"present": False, "count": 0}
    except Exception:
        return {"present": False, "count": 0}


def detect_special_waveforms(data_uv: Optional[np.ndarray], ch_names: List[str],
                             sfreq: float) -> Dict[str, Any]:
    """检测 8 种特殊波形。data_uv 为 (n_ch, n_samples) 的 µV 数据。

    返回 {key: {present, count, channels?, amplitude_uv?}}——报告只显示 present=True 的。
    """
    if data_uv is None or data_uv.ndim != 2 or data_uv.shape[1] < int(sfreq * 2):
        return {}
    return {
        "spikes": _detect_spikes(data_uv, ch_names, sfreq),  # 尖波/锐波（癫痫样放电）
        "sleep_spindles": _detect_spindles(data_uv, ch_names, sfreq),
        "slow_waves": _detect_slow_waves(data_uv, ch_names, sfreq),
        "k_complexes": _detect_k_complexes(data_uv, ch_names, sfreq),
        "mu_rhythm": _detect_mu_rhythm(data_uv, ch_names, sfreq),
        "smr": _detect_smr(data_uv, ch_names, sfreq),
        "triphasic_waves": _detect_triphasic(data_uv, ch_names, sfreq),
        "periodic_discharges": _detect_periodic(data_uv, ch_names, sfreq),
    }


# =====================================================================
# 主分析入口
# =====================================================================

def _pc(cb, stage: str):
    """安全地向外报告当前分析阶段。回调异常绝不允许影响分析主流程。"""
    if cb is None:
        return
    try:
        cb(stage)
    except Exception:
        pass


def analyze_edf(file_path: str, lang: str = "zh", progress_cb=None) -> Dict[str, Any]:
    """快速分析 EDF 文件（v2.0 — 只做基础分析，不含 AI/Picture/PDF）
    
    流程：
    1. 验证文件类型和大小
    2. 读取元数据（preload=False）
    3. 加载前60s数据做信号质量和频段分析
    4. 快速波形预览（8s窗口）
    5. 组装结果返回
    
    progress_cb(stage: str) — 可选。在各真实阶段边界回调，用于前端展示
    分步进度（app.py 的 /api/analyze 会把 stage 写入进度表供轮询）。
    可能的值：metadata / signal / waveform / bands / features / assembling。
    算法本身不因该参数而改变。

    不在本函数中：Ollama AI解释、PDF生成、PNG波形图
    """
    # ── 格式验证 ──────────────────────────────────────
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported file format: {ext}. Supported: {SUPPORTED_FORMATS}")
    
    # ── 文件大小检查 ──────────────────────────────────
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        raise ValueError(
            f"File too large for analysis ({file_size_mb:.1f}MB). "
            f"Maximum supported file size is {MAX_FILE_SIZE_MB}MB."
        )
    
    # ── 1. 元数据（preload=False，瞬间返回）─────────────
    _pc(progress_cb, "metadata")
    meta = fast_load_metadata(file_path)
    filename = os.path.basename(file_path)
    minutes = int(meta["duration_seconds"] // 60)
    seconds = int(meta["duration_seconds"] % 60)
    # 时长字符串：< 60s 直接 "X 秒"（避免 "0分20秒" 这种怪格式）；>= 60s 才用 "X分Y秒"
    duration_str = f"{seconds} 秒" if minutes == 0 else f"{minutes} 分 {seconds} 秒"

    overview = {
        "filename": filename,
        "channel_count": meta["channel_count"],
        "sampling_rate": meta["sampling_rate"],
        "duration": duration_str,
        "channel_names": meta["channel_names"],
        "recording_duration_seconds": meta["duration_seconds"],
    }
    
    # ── 2. 快速信号质量和频段分析（只用前60s数据）─────
    _pc(progress_cb, "signal")
    seg_data_uv = None
    seg_ch_names = None
    seg_sfreq = None
    try:
        seg_data_uv, seg_ch_names, seg_sfreq, _ = fast_load_segment(
            file_path, duration_sec=15.0, eeg_only=True, max_channels=MAX_PREVIEW_CHANNELS
        )
        
        quality = quick_signal_quality(seg_data_uv, seg_ch_names, lang, seg_sfreq)
        freq = quick_bandpower(seg_data_uv, seg_sfreq)
        literacy = quick_literacy_scores(quality, overview)
    except Exception as e:
        print(f"[WARN] fast_load_segment failed: {e}, using fallback")
        raw = _load_raw_any(file_path, preload=True)
        all_picks = _pick_eeg_channels(raw, max_channels=MAX_PREVIEW_CHANNELS)
        n_samples = min(int(30 * raw.info['sfreq']), raw.n_times)
        seg_data_uv = _raw_to_uv(raw, picks=all_picks, start=0, stop=n_samples)
        seg_ch_names = [raw.ch_names[i] for i in all_picks]
        seg_sfreq = float(raw.info['sfreq'])
        quality = quick_signal_quality(seg_data_uv, seg_ch_names, lang, seg_sfreq)
        freq = quick_bandpower(seg_data_uv, seg_sfreq)
        literacy = quick_literacy_scores(quality, overview)
    
    # ── 3. 波形预览（按文件完整时长显示，下采样到 ~1200 点）────
    _pc(progress_cb, "waveform")
    # 用户要求：文件时长有多久就显示多久。直接读取完整时长，
    # 输出经 1200 点下采样，波形体积恒定；长文件仅读取耗时略增。
    waveform_preview = fast_preview_window(file_path, duration_sec=meta["duration_seconds"], max_channels=MAX_PREVIEW_CHANNELS)
    
    # ── 4. 频段波形（从已加载数据提取，避免重复读取文件）────
    _pc(progress_cb, "bands")
    # 用前10s数据做频段滤波
    bw_n = min(int(10.0 * seg_sfreq), seg_data_uv.shape[1]) if seg_data_uv is not None else 0
    if bw_n > 100 and seg_sfreq > 0:
        bw_data = seg_data_uv[:, :bw_n]
        bw_times = np.arange(bw_n) / seg_sfreq
        band_waveforms = quick_band_waveforms_from_data(bw_data, seg_sfreq, bw_times)
    else:
        band_waveforms = quick_band_waveforms(file_path, duration_seconds=10.0)
    
    # ── 4.5 特殊波形检测（尖波/纺锤/慢波/K复合波/mu/SMR/三相波/周期放电）────
    _pc(progress_cb, "features")
    special_waveforms = detect_special_waveforms(seg_data_uv, seg_ch_names, seg_sfreq)
    
    # ── 5. 组合结果 ─────────────────────────────────────
    _pc(progress_cb, "assembling")
    def _safe(v):
        if isinstance(v, (np.integer, np.int32, np.int64)):
            return int(v)
        if isinstance(v, (np.floating, np.float32, np.float64)):
            return float(v)
        if isinstance(v, np.ndarray):
            return v.tolist()
        if isinstance(v, dict):
            return {k: _safe(v) for k, v in v.items()}
        if isinstance(v, list):
            return [_safe(item) for item in v]
        return v
    
    # 频道名称统一用 fast_load 获取的（取前 MAX_ANALYSIS_CHANNELS 个）
    # waveform_preview 已经有自己的 channel_names
    
    return _safe({
        "overview": overview,
        "signal_quality": quality,
        "frequency_analysis": {
            "bandpower": freq.get("bandpower", {}),
            "dominant_frequency": freq.get("dominant_frequency", 10.0),
            "frequency_distribution": freq.get("frequency_distribution", []),
            "average_bandpower": freq.get("average_bandpower", {}),
            "relative_bandpower": freq.get("relative_bandpower", {}),
            "bandpower_percent": freq.get("bandpower_percent", {}),
            "frequency_distribution_array": freq.get("frequency_distribution_array", []),
        },
        "waveform_preview": waveform_preview,
        "band_waveforms": band_waveforms,
        "special_waveforms": special_waveforms,
        "literacy_scores": literacy,
        "what_this_data_cannot_tell": [
            "智商", "性格", "心理健康", "疾病", "情绪", "ADHD", "抑郁症"
        ],
        "file_size_mb": round(file_size_mb, 2),
    })
