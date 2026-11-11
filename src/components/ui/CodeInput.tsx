"use client";

import { useRef } from "react";

/**
 * 六格验证码输入（2026-11-05 用户要求）
 * · 每格独立，输入一位后自动跳到下一格；
 * · 支持整段粘贴（从剪贴板取数字，依次填入并停到最后一格）；
 * · Backspace 空格回退到上一格，方向键可左右移动。
 * 受控：value 为已输入的数字串（0~length 位），onChange 返回拼好的字符串。
 */
export default function CodeInput({
  value,
  onChange,
  length = 6,
  label,
  tone = "default",
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  label?: string;
  tone?: "default" | "subtle";
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  const focusAt = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const commit = (next: string[]) => {
    onChange(next.join("").replace(/\s/g, ""));
  };

  const handleChange = (idx: number, raw: string) => {
    const only = raw.replace(/\D/g, "");
    if (!only) {
      // 用户清空当前格
      const next = [...digits];
      next[idx] = "";
      commit(next);
      return;
    }
    // 一次输入多位的场景（移动端输入法可能整串上屏）
    const next = [...digits];
    let cursor = idx;
    for (const ch of only.slice(0, length - idx)) {
      next[cursor] = ch;
      cursor += 1;
    }
    commit(next);
    focusAt(cursor);
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[idx]) {
        next[idx] = "";
        commit(next);
      } else if (idx > 0) {
        next[idx - 1] = "";
        commit(next);
        focusAt(idx - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(idx - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(idx + 1);
    }
  };

  const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = (e.clipboardData || (window as any).clipboardData)?.getData("text") || "";
    const only = text.replace(/\D/g, "");
    if (!only) return;
    e.preventDefault();
    const next = [...digits];
    let cursor = idx;
    for (const ch of only.slice(0, length - idx)) {
      next[cursor] = ch;
      cursor += 1;
    }
    commit(next);
    focusAt(cursor);
  };

  return (
    <div
      className={`code-boxes ${tone === "subtle" ? "ff--subtle" : ""}`}
      role="group"
      aria-label={label}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={label ? `${label} ${i + 1}` : `digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </div>
  );
}
