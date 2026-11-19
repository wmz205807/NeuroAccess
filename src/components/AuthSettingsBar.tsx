"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Settings } from "lucide-react";
import { useLang } from "@/lib/language-context";
import { translations } from "@/lib/translations";

const SettingsPanel = dynamic(() => import("@/components/SettingsPanel"), { ssr: false, loading: () => null });

export default function AuthPageActions() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { lang } = useLang();

  const tf = (key: string, fallback: string) => {
    const val = translations[lang]?.[key as keyof typeof translations[typeof lang]];
    return (val as string) || fallback;
  };

  return (
    <>
      <div className="flex items-center justify-center gap-3 pt-4 mt-4 border-t border-[var(--color-border)]">
        <button onClick={() => setSettingsOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--color-text)] hover:text-[var(--color-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <Settings size={18} />
          <span>{tf("settings", "Settings")}</span>
        </button>
      </div>

      {settingsOpen && <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
