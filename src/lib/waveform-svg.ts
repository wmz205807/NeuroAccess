// 前端波形 SVG 生成器（与后端 gen_waveform_svg 相同逻辑）
// 用途：当报告未同步到服务器（/api/waveform-image 返回 Report not found）时，
// 直接用本地 analysis 数据渲染波形图，保证波形图始终可见。
//
// 展示方式：每个通道一条原始波形曲线，所有通道统一颜色。

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 渲染通道波形（waveform_preview），所有通道统一颜色。
 *  分页渲染（对齐 EDFbrowser/MNE 标准）：固定 10 秒/屏 + 固定时间尺度，page 指定第几页（0-based）。
 */
export function buildWaveformSvg(analysis: any, page = 0): string {
  const wp = analysis?.waveform_preview;
  const chs0 = wp?.channels || {};
  // 清理 EDF 填充的尾随空白/点（Fc5. → Fc5），并与后端一致重建通道 dict
  const cleanKey = (k: string) => k.trim().replace(/\.+$/, "").trim() || k;
  const chs: Record<string, number[]> = {};
  for (const k of Object.keys(chs0)) chs[cleanKey(k)] = chs0[k];
  const chNames = Object.keys(chs);
  if (chNames.length === 0) return "";
  const nch = chNames.length;
  const rawNpts = chs[chNames[0]]?.length || 0;
  if (rawNpts < 2) return "";

  const timesAll: number[] = wp?.times || [];
  let fs = parseFloat(wp?.sampling_rate || 128) || 128;
  if (timesAll.length > 1) {
    const dt = timesAll[1] - timesAll[0];
    if (dt > 0 && dt < 1) fs = 1 / dt;
  }

  // ── 分页：每屏秒数自适应（短文件≤30s 整段显示，横向更长不挤；长文件每屏 10s 翻页）──
  const PAGE_SECONDS = 10;
  const PX_PER_SEC = 100;
  const t0Total = timesAll.length > 1 ? timesAll[0] : 0;
  // 总时长优先用 waveform_preview.duration_seconds（真实全时长，本地存储可删 times 节省体积），
  // 回退用 times 轴或 样本数/采样率 估算。
  const durFromWp = parseFloat(wp?.duration_seconds || 0) || 0;
  const durTotal = durFromWp > 0
    ? durFromWp
    : (timesAll.length > 1 ? Math.max(timesAll[timesAll.length - 1] - t0Total, 1e-9) : Math.max(rawNpts / fs, 1e-9));
  const pageSeconds = durTotal <= 30 ? durTotal : PAGE_SECONDS;
  const totalPages = Math.max(1, Math.ceil(durTotal / pageSeconds));
  const curPage = Math.max(0, Math.min(Math.floor(page), totalPages - 1));
  const tStart = t0Total + curPage * pageSeconds;
  const tEnd = Math.min(t0Total + durTotal, tStart + pageSeconds);
  const winDur = Math.max(tEnd - tStart, 1e-9);

  // 裁剪当前窗口的数据：有 times 轴按时间索引；无 times（本地精简存储，channels 已降采样、
  // 点数与采样率不匹配）按"总点数 / 总页数"均分，避免按秒×采样率算出超界的空窗口
  let iStart: number, iEnd: number;
  if (timesAll.length > 1) {
    iStart = _findIdx(timesAll, tStart);
    iEnd = Math.min(rawNpts, _findIdx(timesAll, tEnd) + 1);
  } else {
    const pageSamples = Math.max(1, Math.ceil(rawNpts / totalPages));
    iStart = Math.min(rawNpts, curPage * pageSamples);
    iEnd = Math.min(rawNpts, iStart + pageSamples);
  }
  const winTimes = timesAll.slice(iStart, Math.max(iStart + 1, iEnd));
  const winChs: Record<string, number[]> = {};
  for (const nm of chNames) winChs[nm] = chs[nm].slice(iStart, Math.max(iStart + 1, iEnd));

  // 不做低通平滑：保留原始高频成分，波形有真实 EEG 的噪声底和复杂形态
  // 去基线漂移窗口：2 秒（移动平均），只去除极慢的基线摆动，保留真实低频（慢波/θ 等）
  const detK = Math.max(2, Math.round(fs * 2));
  // 去漂移：减去 0.5 秒移动平均（保持各通道基线稳定在中心）
  if (detK > 1 && winChs[chNames[0]]?.length > detK + 2) {
    for (const nm of chNames) {
      const v = winChs[nm];
      if (!v || v.length <= detK + 2) continue;
      const out = new Array(v.length);
      const half = Math.floor(detK / 2);
      for (let i = 0; i < v.length; i++) {
        let s = 0, n = 0;
        for (let k = -half; k <= half; k++) {
          const j = i + k;
          if (j >= 0 && j < v.length) { s += v[j]; n++; }
        }
        out[i] = v[i] - (n ? s / n : 0);
      }
      winChs[nm] = out;
    }
  }

  // 不降采样：像素列粒度渲染直接用窗口原始数据（每列取 min/max）

  const LW = 65;
  const t0 = winTimes.length > 1 ? winTimes[0] : tStart;
  const dur = winTimes.length > 1 ? Math.max(winTimes[winTimes.length - 1] - t0, 1e-9) : winDur;
  // 统一绘图宽度：所有时长文件波形一致铺满显示区域。
  // 以前 PLOT_W = min(1400, pageSeconds*100) 会让 8 秒文件只有 800px 宽，
  // 波形偏窄、占不满区域；统一固定宽度后，短文件波形自动横向拉伸铺满。
  const PLOT_W = 1300;
  const W = LW + PLOT_W + 15;
  // laneH 只决定相邻通道"基线的行距"，不再限制波形自身的上下幅度。
  // 2026-10-18：通道多时适度压缩行距 —— 63 通道 × 34px ≈ 2200px，滚动太长；
  // 只压行距（振幅会按同一比例跟着缩），波形"可超出本行"的策略不变。
  const laneH = nch > 48 ? 22 : nch > 24 ? 27 : 34;
  const svg: string[] = [];

  // 朴素直接渲染：每个横向像素列取列内偏离最大的样本（仅性能降采样，忠实反映数据）
  const LINE_COLOR = "#38bdf8";
  const renderValsFor = (nm: string): number[] => winChs[nm] as number[];
  const nvRef = renderValsFor(chNames[0]).length;
  if (nvRef < 2) return "";
  // 列数不能超过当前窗口实际数据点数，否则大量列重复同一点 → 水平线/大斜线
  const COLS = Math.max(2, Math.min(Math.min(PLOT_W, 1200), nvRef));

  // ── 第一遍：逐通道按列抽点，先拿到"实际会被画出来的点" ──
  // 每列取"偏离列内中点最远"的样本（保留尖峰方向与幅度），按时间顺序连成真实波形线
  // （不画 min/max 竖直包络，避免假"填充块"观感）。
  const drawn: { xs: number[]; ys: number[] }[] = [];
  for (const nm of chNames) {
    const vals = renderValsFor(nm);
    if (!vals || vals.length < 2) { drawn.push({ xs: [], ys: [] }); continue; }
    const nv = vals.length;
    const step = nv / COLS;
    const xs: number[] = [], ys: number[] = [];
    for (let j = 0; j < COLS; j++) {
      const s = Math.floor(j * step);
      const e = Math.min(Math.floor((j + 1) * step), nv);
      if (e <= s) continue;
      const base = vals[(s + e) >> 1];
      let best = s, bestAbs = -1;
      for (let k = s; k < e; k++) {
        const a = Math.abs(vals[k] - base);
        if (a > bestAbs) { bestAbs = a; best = k; }
      }
      xs.push(LW + (j + 0.5) / COLS * PLOT_W);
      ys.push(vals[best]);
    }
    drawn.push({ xs, ys });
  }

  // ── 振幅基准：**逐通道自动基准 + 全局下限**（2026-10-19 定案）──
  // 每列取的是列内最极端样本，抽样后的点本身就偏极端；按抽样点自身取 p95，触顶比例才可控。
  //
  // 历史教训（都实测过，别再走回头路）：
  //   ① 全局单基准（2026-10-18 之前）：真实 EEG 通道间振幅差可达 10 倍以上，
  //      安静通道按全局 p95 定标后只剩行距的 10~30%，行间大片空白 → 用户判「假」。
  //   ② 全局 p99（2026-10-18 试过）：真实脑电幅值长尾极重，p99 被少数大伪迹撑高，
  //      绝大多数通道被压成几乎直线 → 更假，已回退。
  //   ③ 纯逐通道归一化：一条接近静息的噪声通道会被放大成满幅"假信号"。
  // ⇒ 定案：**每通道用自己的 p95 定标，但设全局下限** ref_i = max(ch_p95, GLOBAL_p95 × 0.25)。
  //   效果：正常通道各自占满行距（EDFbrowser / MNE 的默认行为就是逐通道自动增益），
  //   真实的通道间振幅差异在 4 倍以内仍然保留，超出的（通常是伪迹通道）被压到下限档。
  //   均匀数据（如 8 通道合成 α 文件）每通道 p95 ≈ 全局 p95 ⇒ 效果与旧版完全一致。
  const GLOBAL_REF = (() => {
    const allAbs: number[] = [];
    for (const dd of drawn) for (const v of dd.ys) allAbs.push(Math.abs(v));
    if (allAbs.length < 2) return 0;
    allAbs.sort((a, b) => a - b);
    return allAbs[Math.min(Math.round(allAbs.length * 0.95), allAbs.length - 1)] || 0;
  })();
  if (!(GLOBAL_REF > 0)) return "";
  const CH_FLOOR = GLOBAL_REF * 0.25;
  // 每通道：落点取行距 ±34%（真实 EEG 高频细节密，占满行距会糊；EDFbrowser 默认观感约 ±30%）
  const chRef: number[] = drawn.map(dd => {
    const abs = dd.ys.map(v => Math.abs(v)).sort((a, b) => a - b);
    const p95 = abs[Math.min(Math.round(abs.length * 0.95), abs.length - 1)] || 0;
    return Math.max(p95, CH_FLOOR) || GLOBAL_REF;
  });
  const chScale: number[] = chRef.map(ref => (laneH * 0.34) / ref);

  // 画布上下留白：软限幅渐近线为行距 62%（见下方 tanh 注释），PAD 盖住它即可
  const PAD = Math.max(Math.round(laneH * 0.9), Math.ceil(laneH * 0.62 - laneH / 2) + 6);
  const H = laneH * nch + PAD * 2 + 30;
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#1a1a2e;font-family:monospace">`);
  // 渲染策略（2026-10-04 定案）：
  //   ① 早先每通道套一个 laneH 高的 clipPath —— 折线一旦有连续几点整体落在框外，
  //      那一段连线就整段不可见 ⇒ 波形"断口"（尖峰越宽断口越长）。
  //   ② 后来改成钳位画平顶，等于用一条假直线把尖峰盖掉，观感同样不真实。
  //   两者都不要：波形按真实幅度自由伸展，尖峰该多高就多高，需要时自然压到相邻
  //   通道上（EDFbrowser / MNE 也是这么画的），只有通道中心那条虚线作为基准线。
  for (let i = 0; i < nch; i++) {
    const ch = chNames[i];
    const y = PAD + i * laneH + laneH / 2;
    svg.push(
      `<line x1="${LW}" y1="${y}" x2="${W}" y2="${y}" stroke="#333" stroke-width="0.5" stroke-dasharray="3 3"/>`
    );
    svg.push(
      `<text x="${LW - 4}" y="${y + 3}" fill="#aab" font-size="${Math.min(11, Math.max(8, Math.round(200 / nch)))}" text-anchor="end">${esc(ch)}</text>`
    );
    const { xs, ys } = drawn[i];
    if (xs.length < 2) continue;
      // ── 软限幅（逐通道基准版）────────────────────────────────
      // 大信号被平滑压回来：① 永不越出本通道行 ② 无平顶 ③ 正常幅度保持线性。
      // 渐近线取行距的 62%：本通道 p95（= 34% 行距）落在 tanh 线性段，
      // 大伪迹被平滑压到 62% 以内，不会串到相邻通道。
      const scBase = chScale[i];
      const Lp = (laneH * 0.62) / scBase;          // 归一化空间里的限幅点
      const clip = (v: number) => Lp * Math.tanh(v / Lp) * scBase;
      let d = `M${xs[0].toFixed(1)},${(y - clip(ys[0])).toFixed(2)}`;
      for (let j = 1; j < xs.length; j++) {
        d += ` L${xs[j].toFixed(1)},${(y - clip(ys[j])).toFixed(2)}`;
      }
    svg.push(`<path d="${d}" stroke="${LINE_COLOR}" stroke-width="1.0" fill="none" opacity="0.9"/>`);
  }

  // 底部时间条背景
  svg.push(`<rect x="0" y="${H - 22}" width="${W}" height="22" fill="#14142e"/>`);
  // 时间刻度：每 2 秒一个，带浅色垂直参考线，窗口绝对时间
  const tickStep = 2;
  let k = 0;
  while (true) {
    const t = tStart + k * tickStep;
    if (t > tEnd + 1e-9) break;
    const x = LW + (k * tickStep / winDur) * PLOT_W;
    if (k > 0) svg.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H - 22}" stroke="#2a2a4e" stroke-width="0.5" stroke-dasharray="1 4" opacity="0.6"/>`);
    svg.push(`<text x="${x.toFixed(1)}" y="${H - 7}" fill="#9aa" font-size="11" text-anchor="middle">${(t - t0Total).toFixed(0)}s</text>`);
    k++;
  }
  // 2026-10-18：末尾补刻度。窗口终点通常不是 tickStep 的整数倍
  //（20s 的文件 tEnd=19.992 ⇒ 循环在 18s 就 break），
  // 于是波形一直画到 20s、坐标轴却只标到 18s，右侧一截裸奔。
  {
    const lastTickT = tStart + (k - 1) * tickStep;
    if (k > 0 && tEnd - lastTickT > tickStep * 0.35) {
      const xEnd = LW + PLOT_W;
      svg.push(`<text x="${xEnd}" y="${H - 7}" fill="#9aa" font-size="11" text-anchor="end">${(tEnd - t0Total).toFixed(0)}s</text>`);
    }
  }
  svg.push("</svg>");
  return svg.join("");
}

/** 二分查找最后一个时间 <= t 的索引 */
function _findIdx(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function svgToDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** 判断服务器返回的 SVG 是否为占位（报告未同步到服务器等） */
export function isPlaceholderSvg(svg: string): boolean {
  return (
    svg.includes("Report not found") ||
    svg.includes("No waveform data") ||
    svg.includes("Insufficient data points") ||
    svg.includes("Missing report ID") ||
    svg.includes(">Error:") ||
    svg.startsWith("<svg width=400 height=100>")
  );
}
