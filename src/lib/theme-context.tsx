"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 惰性初始化：客户端直接读 localStorage，避免首帧用错主题造成闪色。
  // 默认深色 —— 对齐 BCI World「深空科技蓝」的第一印象。
  // 用户显式选过 light/dark/system 就完全尊重其选择，只有「从未设置过」才落到 dark。
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const saved = localStorage.getItem("theme") as Theme | null;
      if (saved === "light" || saved === "dark" || saved === "system") return saved;
      return "dark";
    } catch {
      return "dark";
    }
  });

  // 同步 document.documentElement.class
  useEffect(() => {
    const root = document.documentElement;

    function applyTheme(t: Theme) {
      if (t === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        root.classList.toggle("dark", isDark);
      } else {
        root.classList.toggle("dark", t === "dark");
      }
    }

    applyTheme(theme);
    try { localStorage.setItem("theme", theme); } catch {}

    // 监听系统主题变化（仅 system 模式需要）
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      function handler(e: MediaQueryListEvent) {
        root.classList.toggle("dark", e.matches);
      }
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx)
    throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
