"use client";

import type { ReactNode } from "react";

/**
 * 浮动标签输入框（2026-11-05 用户要求：表单一律用浮动标签，不用占位符）。
 * 样式在 globals.css 的 `.ff` 段；placeholder 固定为一个空格，供 CSS
 * `:not(:placeholder-shown)` 判断「是否有值」。
 */
export default function FloatingField({
  id,
  label,
  value,
  onChange,
  type = "text",
  right,
  className = "",
  required,
  autoComplete,
  inputMode,
  minLength,
  maxLength,
  disabled,
  name,
  tone = "default",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  right?: ReactNode;
  className?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric" | "tel" | "decimal";
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  name?: string;
  /** default: 卡片外的输入框（surface 底）；subtle: 卡片内的输入框（bg 底） */
  tone?: "default" | "subtle";
}) {
  return (
    <div className={`ff ${right ? "ff--right" : ""} ${tone === "subtle" ? "ff--subtle" : ""} ${className}`.trim()}>
      <input
        id={id}
        name={name || id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        minLength={minLength}
        maxLength={maxLength}
        disabled={disabled}
      />
      <label htmlFor={id}>{label}</label>
      {right ? <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{right}</div> : null}
    </div>
  );
}
