"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 头像编辑器（2026-11-05 用户要求：上传的头像图片可以编辑）
 * · 选图后先进这里：拖动调整位置、滑块缩放，确认后再上传；
 * · 预览是圆形裁切，导出 512×512 PNG（与圆形显示一致）。
 */
export default function AvatarEditor({
  file,
  onCancel,
  onConfirm,
  busy,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  busy?: boolean;
}) {
  const PREVIEW = 240;      // 预览框边长
  const OUTPUT = 512;       // 导出边长
  const [src, setSrc] = useState("");
  // 2026-11-05（用户要求）：默认 1 倍（1× = 图片刚好铺满圆形）。
  const BASE_ZOOM = 1;
  const [scale, setScale] = useState(BASE_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [base, setBase] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 按 cover 计算图片基础显示尺寸
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    imgRef.current = el;
    const s = Math.max(PREVIEW / el.naturalWidth, PREVIEW / el.naturalHeight);
    setBase({ w: el.naturalWidth * s, h: el.naturalHeight * s });
  };

  // 2026-11-05（用户要求）：编辑只能在照片范围内 —— 位移夹紧到「图片始终盖满圆形预览」，
  // 拖动/缩放都不会露出底色。
  const clampOffset = (x: number, y: number, sc = scale) => {
    const maxX = Math.max(0, (base.w * sc - PREVIEW) / 2);
    const maxY = Math.max(0, (base.h * sc - PREVIEW) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const startDrag = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setOffset(clampOffset(
      dragRef.current.ox + (e.clientX - dragRef.current.startX),
      dragRef.current.oy + (e.clientY - dragRef.current.startY),
    ));
  };
  const endDrag = () => { dragRef.current = null; };

  const changeScale = (next: number) => {
    setScale(next);
    setOffset((o) => clampOffset(o.x, o.y, next));
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const k = OUTPUT / PREVIEW;
    const w = base.w * scale * k;
    const h = base.h * scale * k;
    const c = document.createElement("canvas");
    c.width = OUTPUT;
    c.height = OUTPUT;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    // 2026-11-06：透明 PNG 会让头像露出页面底色（浅色主题下发白）⇒ 先铺一层深色底
    ctx.fillStyle = "#0b111c";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.drawImage(img, (OUTPUT - w) / 2 + offset.x * k, (OUTPUT - h) / 2 + offset.y * k, w, h);
    c.toBlob((blob) => { if (blob) onConfirm(blob); }, "image/png", 0.95);
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">编辑头像</h3>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">滑块放大后可拖动调整位置</p>

        <div
          className="relative mx-auto rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: PREVIEW, height: PREVIEW }}
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="preview"
              onLoad={onImgLoad}
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: base.w * scale || undefined,
                height: base.h * scale || undefined,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          {/* 圆形遮罩引导 */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/25" />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-secondary)]">缩放</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={scale}
            onChange={(e) => changeScale(Number(e.target.value))}
            className="flex-1 accent-[var(--color-primary)]"
            aria-label="缩放"
          />
          <button
            type="button"
            onClick={() => { setScale(BASE_ZOOM); setOffset({ x: 0, y: 0 }); }}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
          >
            重置
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="flex-1 min-h-[44px] rounded-xl bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-bg)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy ? "上传中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
