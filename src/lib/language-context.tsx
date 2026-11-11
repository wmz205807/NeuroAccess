"use client";

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { getText, Lang } from "@/lib/translations";

// 2026-11-09（用户要求）：网站仅保留 中文 / English / Deutsch / 日本語
const LANGUAGES: Lang[] = ["zh", "en", "de", "ja"];

// 支持的语言变体映射表
// 键：浏览器语言代码（含变体），值：网站支持的语言代码
const LANGUAGE_ALIASES: Record<string, Lang> = {
  // 中文变体
  "zh": "zh",
  "zh-CN": "zh",
  "zh-TW": "zh",
  "zh-HK": "zh",
  "zh-SG": "zh",
  "zh-Hans": "zh",
  "zh-Hant": "zh",
  // 英文变体
  "en": "en",
  "en-US": "en",
  "en-GB": "en",
  "en-AU": "en",
  "en-CA": "en",
  "en-NZ": "en",
  "en-IE": "en",
  "en-ZA": "en",
  "en-IN": "en",
  // 西班牙文/法文/韩文变体（2026-11-09：网站不再提供这三种语言，统一回落到英文）
  "es": "en",
  "es-ES": "en",
  "es-MX": "en",
  "es-AR": "en",
  "es-CO": "en",
  "es-CL": "en",
  "es-PE": "en",
  "es-VE": "en",
  // 法文变体
  "fr": "en",
  "fr-FR": "en",
  "fr-CA": "en",
  "fr-BE": "en",
  "fr-CH": "en",
  "fr-LU": "en",
  // 德文变体
  "de": "de",
  "de-DE": "de",
  "de-AT": "de",
  "de-CH": "de",
  "de-LU": "de",
  // 日文变体
  "ja": "ja",
  "ja-JP": "ja",
  // 韩文变体
  "ko": "en",
  "ko-KR": "en",
};

/**
 * 检测用户系统语言并匹配网站支持的语言
 * 优先使用 navigator.languages，fallback 到 navigator.language
 * 返回匹配的语言代码，如果不支持则返回 'en'
 */
function detectSystemLanguage(): Lang {
  if (typeof navigator === "undefined") return "en";

  // 收集浏览器语言列表（去重保序）
  const browserLangs: string[] = [];
  if (navigator.languages && navigator.languages.length > 0) {
    browserLangs.push(...navigator.languages);
  }
  if (navigator.language) {
    browserLangs.push(navigator.language);
  }
  const seen = new Set<string>();
  const uniqueLangs: string[] = [];
  for (const lang of browserLangs) {
    const normalized = lang.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueLangs.push(normalized);
    }
  }

  for (const lang of uniqueLangs) {
    // 1. 精确匹配（含变体如 zh-CN）
    const exactMatch = LANGUAGE_ALIASES[lang];
    if (exactMatch) return exactMatch;

    // 2. 主语言代码匹配（zh-CN → zh）
    const mainCode = lang.split("-")[0].split("_")[0].toLowerCase();
    const mainMatch = LANGUAGE_ALIASES[mainCode];
    if (mainMatch) return mainMatch;
  }

  // 无匹配，默认英文
  return "en";
}

type LangContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: string) => string;
};

const LangContext = createContext<LangContextType | undefined>(undefined);

export function LanguageProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  // SSR 和 CSR 初始值必须一致，避免 hydration mismatch
  // 优先使用服务端传入的 initialLang（来自 cookie），否则默认 "en"
  const [lang, setLangState] = useState<Lang>(initialLang || "en");
  const [isReady, setIsReady] = useState(false);

  // Mount 后应用语言偏好：用户显式保存的 localStorage 优先于 SSR 推断的 initialLang。
  // （SSR 的 initialLang 只用于首屏初始渲染，避免无 cookie 时 Accept-Language
  //   覆盖用户已保存的选择。）
  useEffect(() => {
    try {
      const saved = localStorage.getItem("neuroaccess-language");
      if (saved && LANGUAGES.includes(saved as Lang)) {
        setLangState(saved as Lang);
        setIsReady(true);
        return;
      }
      // 无保存值：检测系统语言（SSR 已按 Accept-Language 推断过，这里兜底）
      const detected = detectSystemLanguage();
      setLangState(detected);
      setIsReady(true);
    } catch {
      setIsReady(true);
    }
  }, []);

  // 语言变化时写入 localStorage + 写入 cookie (供 SSR 读取) + 更新 <html lang>
  useEffect(() => {
    try {
      localStorage.setItem("neuroaccess-language", lang);
      document.cookie = `lang=${lang}; path=/; max-age=2592000`;
      document.documentElement.lang = lang;
      document.documentElement.setAttribute("data-lang", lang);
    } catch {}
  }, [lang]);

  // 循环切换语言
  const toggleLang = () => {
    setLangState((prev) => {
      const idx = LANGUAGES.indexOf(prev);
      return LANGUAGES[(idx + 1) % LANGUAGES.length];
    });
  };

  const value = useMemo<LangContextType>(
    () => ({
      lang,
      setLang: setLangState,
      toggleLang,
      t: (key: string) => getText(lang, key),
    }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextType {
  const ctx = useContext(LangContext);
  if (!ctx) {
    return {
      lang: "en",
      setLang: () => {},
      toggleLang: () => {},
      t: (key: string) => getText("en", key),
    };
  }
  return ctx;
}
