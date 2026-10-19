"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useLang } from "@/lib/language-context";
import type { Lang } from "@/lib/translations";
import KnowledgeCard, { KnowledgeCardData } from "@/components/KnowledgeCard";
import { BookOpen, Search } from "lucide-react";


// ── 知识卡片数据（key 由 t() 翻译）────────────────────
function getCards(t: (key: string) => string): KnowledgeCardData[] {
  return [
    {
      id: "alpha", category: "brainwaves", icon: "α", iconColor: "#3b82f6",
      title: t("guideAlphaTitle"),
      frequency: t("guideAlphaFrequency"),
      description: t("guideAlphaDesc"),
      details: {
        what: t("guideAlphaWhat"),
        why: t("guideAlphaWhy"),
        ranges: t("guideAlphaRanges"),
        pattern: t("guideAlphaPattern"),
        cannotTell: t("guideAlphaCannotTell"),
      }
    },
    {
      id: "beta", category: "brainwaves", icon: "β", iconColor: "#22c55e",
      title: t("guideBetaTitle"),
      frequency: t("guideBetaFrequency"),
      description: t("guideBetaDesc"),
      details: {
        what: t("guideBetaWhat"),
        why: t("guideBetaWhy"),
        ranges: t("guideBetaRanges"),
        cannotTell: t("guideBetaCannotTell"),
      }
    },
    {
      id: "delta", category: "brainwaves", icon: "δ", iconColor: "#ef4444",
      title: t("guideDeltaTitle"),
      frequency: t("guideDeltaFrequency"),
      description: t("guideDeltaDesc"),
      details: {
        what: t("guideDeltaWhat"),
        why: t("guideDeltaWhy"),
        ranges: t("guideDeltaRanges"),
        cannotTell: t("guideDeltaCannotTell"),
      }
    },
    {
      id: "theta", category: "brainwaves", icon: "θ", iconColor: "#facc15",
      title: t("guideThetaTitle"),
      frequency: t("guideThetaFrequency"),
      description: t("guideThetaDesc"),
      details: {
        what: t("guideThetaWhat"),
        why: t("guideThetaWhy"),
        ranges: t("guideThetaRanges"),
        cannotTell: t("guideThetaCannotTell"),
      }
    },
    {
      id: "gamma", category: "brainwaves", icon: "γ", iconColor: "#a855f7",
      title: t("guideGammaTitle"),
      frequency: t("guideGammaFrequency"),
      description: t("guideGammaDesc"),
      details: {
        what: t("guideGammaWhat"),
        why: t("guideGammaWhy"),
        ranges: t("guideGammaRanges"),
        cannotTell: t("guideGammaCannotTell"),
      }
    },
    {
      id: "artifacts", category: "artifacts", icon: "⚡", iconColor: "#d97706",
      title: t("guideArtifactsTitle"),
      description: t("guideArtifactsDesc"),
      details: {
        what: t("guideArtifactsWhat"),
        why: t("guideArtifactsWhy"),
        cannotTell: t("guideArtifactsCannotTell"),
      }
    },
    {
      id: "channels", category: "technical", icon: "🔢", iconColor: "#0891b2",
      title: t("guideChannelsTitle"),
      description: t("guideChannelsDesc"),
      details: {
        what: t("guideChannelsWhat"),
        why: t("guideChannelsWhy"),
        ranges: t("guideChannelsRanges"),
        cannotTell: t("guideChannelsCannotTell"),
      }
    },
    {
      id: "sampling", category: "technical", icon: "⏱", iconColor: "#6366f1",
      title: t("guideSamplingTitle"),
      description: t("guideSamplingDesc"),
      details: {
        what: t("guideSamplingWhat"),
        why: t("guideSamplingWhy"),
        ranges: t("guideSamplingRanges"),
        cannotTell: t("guideSamplingCannotTell"),
      }
    },
    {
      id: "noise", category: "technical", icon: "📊", iconColor: "#f59e0b",
      title: t("guideNoiseTitle"),
      description: t("guideNoiseDesc"),
      details: {
        what: t("guideNoiseWhat"),
        why: t("guideNoiseWhy"),
        cannotTell: t("guideNoiseCannotTell"),
      }
    },
    {
      id: "psd", category: "technical", icon: "📈", iconColor: "#8b5cf6",
      title: t("guidePsdTitle"),
      description: t("guidePsdDesc"),
      details: {
        what: t("guidePsdWhat"),
        why: t("guidePsdWhy"),
        ranges: t("guidePsdRanges"),
        cannotTell: t("guidePsdCannotTell"),
      }
    },
    {
      id: "bandpower", category: "technical", icon: "📶", iconColor: "#0ea5e9",
      title: t("guideBandpowerTitle"),
      description: t("guideBandpowerDesc"),
      details: {
        what: t("guideBandpowerWhat"),
        why: t("guideBandpowerWhy"),
        ranges: t("guideBandpowerRanges"),
        cannotTell: t("guideBandpowerCannotTell"),
      }
    },
    // ── 特殊波形（颜色与五种基本频段区分，不与 blue/green/red/yellow/purple 相同）──
    {
      id: "spikes", category: "special", icon: "⚡", iconColor: "#f472b6",
      title: t("guideSpikesTitle"),
      frequency: t("guideSpikesFrequency"),
      description: t("guideSpikesDesc"),
      details: {
        what: t("guideSpikesWhat"),
        why: t("guideSpikesWhy"),
        pattern: t("guideSpikesPattern"),
        cannotTell: t("guideSpikesCannotTell"),
      }
    },
    {
      id: "sleep_spindles", category: "special", icon: "🌙", iconColor: "#14b8a6",
      title: t("guideSpindlesTitle"),
      frequency: t("guideSpindlesFrequency"),
      description: t("guideSpindlesDesc"),
      details: {
        what: t("guideSpindlesWhat"),
        why: t("guideSpindlesWhy"),
        pattern: t("guideSpindlesPattern"),
        cannotTell: t("guideSpindlesCannotTell"),
      }
    },
    {
      id: "slow_waves", category: "special", icon: "🌊", iconColor: "#84cc16",
      title: t("guideSlowWavesTitle"),
      frequency: t("guideSlowWavesFrequency"),
      description: t("guideSlowWavesDesc"),
      details: {
        what: t("guideSlowWavesWhat"),
        why: t("guideSlowWavesWhy"),
        pattern: t("guideSlowWavesPattern"),
        cannotTell: t("guideSlowWavesCannotTell"),
      }
    },
    {
      id: "k_complexes", category: "special", icon: "💤", iconColor: "#f97316",
      title: t("guideKComplexesTitle"),
      frequency: t("guideKComplexesFrequency"),
      description: t("guideKComplexesDesc"),
      details: {
        what: t("guideKComplexesWhat"),
        why: t("guideKComplexesWhy"),
        pattern: t("guideKComplexesPattern"),
        cannotTell: t("guideKComplexesCannotTell"),
      }
    },
    {
      id: "mu_rhythm", category: "special", icon: "μ", iconColor: "#06b6d4",
      title: t("guideMuRhythmTitle"),
      frequency: t("guideMuRhythmFrequency"),
      description: t("guideMuRhythmDesc"),
      details: {
        what: t("guideMuRhythmWhat"),
        why: t("guideMuRhythmWhy"),
        pattern: t("guideMuRhythmPattern"),
        cannotTell: t("guideMuRhythmCannotTell"),
      }
    },
    {
      id: "smr", category: "special", icon: "🏃", iconColor: "#64748b",
      title: t("guideSmrTitle"),
      frequency: t("guideSmrFrequency"),
      description: t("guideSmrDesc"),
      details: {
        what: t("guideSmrWhat"),
        why: t("guideSmrWhy"),
        pattern: t("guideSmrPattern"),
        cannotTell: t("guideSmrCannotTell"),
      }
    },
    {
      id: "triphasic", category: "special", icon: "≡", iconColor: "#d946ef",
      title: t("guideTriphasicTitle"),
      frequency: t("guideTriphasicFrequency"),
      description: t("guideTriphasicDesc"),
      details: {
        what: t("guideTriphasicWhat"),
        why: t("guideTriphasicWhy"),
        pattern: t("guideTriphasicPattern"),
        cannotTell: t("guideTriphasicCannotTell"),
      }
    },
    {
      id: "periodic", category: "special", icon: "🔁", iconColor: "#a16207",
      title: t("guidePeriodicTitle"),
      frequency: t("guidePeriodicFrequency"),
      description: t("guidePeriodicDesc"),
      details: {
        what: t("guidePeriodicWhat"),
        why: t("guidePeriodicWhy"),
        pattern: t("guidePeriodicPattern"),
        cannotTell: t("guidePeriodicCannotTell"),
      }
    },
  ];
}

// ── 页面组件 ─────────────────────────────────────────
export default function GuidePage() {
  const { lang, t } = useLang();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  const cards = useMemo(() => getCards(t), [t]);

  const categories = [
    { key: "all", label: t("all") },
    { key: "brainwaves", label: t("guideCatBrainwaves") },
    { key: "special", label: t("guideCatSpecial") },
    { key: "technical", label: t("guideCatTechnical") },
    { key: "artifacts", label: t("guideCatArtifacts") },
  ];

  const filtered = useMemo(() => {
    return cards.filter((card) => {
      const matchCategory = category === "all" || card.category === category;
      const q = search.toLowerCase();
      const matchSearch = !q ||
        card.title.toLowerCase().includes(q) ||
        card.description.toLowerCase().includes(q) ||
        card.id.includes(q) ||
        (card.frequency && card.frequency.toLowerCase().includes(q));
      return matchCategory && matchSearch;
    });
  }, [cards, category, search]);

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 sm:space-y-8 px-4 sm:px-6 py-4 sm:py-8 pb-[env(safe-area-inset-bottom,16px)]"
    >
      {/* 标题区 */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/30">
          <BookOpen className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{t("guideTitle")}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t("guidePageSubtitle")}</p>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("guideSearchPlaceholder")}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/50 focus:border-[var(--color-primary)]/30 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/10"
          />
        </div>
        <div className="flex gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`rounded-xl px-4 py-2.5 text-xs font-medium transition-all ${
                category === cat.key
                  ? "bg-blue-600 text-white dark:bg-blue-500 shadow-sm dark:bg-blue-600 dark:text-white"
                  : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* 卡片列表 */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{t("guideEmptyState")}</div>
        ) : (
          filtered.map((card, i) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.035, 0.25), duration: 0.35, ease: [0.22, 0.8, 0.22, 1] }}
            >
              <KnowledgeCard card={card} />
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
