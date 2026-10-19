"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/lib/language-context";

export interface KnowledgeCardData {
  id: string;
  category: "brainwaves" | "technical" | "artifacts" | "special";
  icon: string; // 希腊字母或字符
  iconColor: string;
  title: string;
  frequency?: string;
  description: string;
  details: {
    what: string;
    why: string;
    ranges?: string;
    pattern?: string;
    cannotTell: string;
  };
}

/** 展开/收起统一用的缓动，和站点其它动效保持一致 */
const EASE = [0.22, 0.8, 0.22, 1] as const;

export default function KnowledgeCard({ card }: { card: KnowledgeCardData }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLang();

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 ${
        expanded
          ? "border-[var(--color-primary)]/30 bg-[var(--color-surface)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/20"
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          style={{ backgroundColor: `${card.iconColor}15`, color: card.iconColor }}
        >
          {card.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[var(--color-text)]">{card.title}</h3>
          <div className="mt-0.5 flex items-center gap-2">
            {card.frequency && (
              <span className="text-[11px] font-mono text-[var(--color-text)]/60">{card.frequency}</span>
            )}
            <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text)]/70">
              {t("guideCat" + card.category.charAt(0).toUpperCase() + card.category.slice(1))}
            </span>
          </div>
        </div>
        {/* 箭头旋转 —— 2026-10-15：此前是两个图标（ChevronUp/ChevronDown）瞬间互换，
            没有任何过渡；改为单个箭头随展开状态平滑旋转。 */}
        <motion.div
          className="flex-shrink-0"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          <ChevronDown className="h-5 w-5 text-[var(--color-text)]/60" />
        </motion.div>
      </button>

      {/* 展开内容 —— 2026-10-15：此前是 `{expanded && …}` 直接条件渲染，
          一帧就切换完、毫无动效（用户反馈「展开一点动态效果都没有」）。
          改为 AnimatePresence + 高度/透明度过渡。 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-[var(--color-border)] px-5 pb-5 pt-4">
              <p className="text-sm leading-relaxed text-[var(--color-text)]/80">{card.description}</p>

              <div className="space-y-3">
                <DetailBlock label={t("whatItIs")} text={card.details.what} />
                <DetailBlock label={t("whyItMatters")} text={card.details.why} />
                {card.details.ranges && (
                  <DetailBlock label={t("commonRanges")} text={card.details.ranges} />
                )}
                {card.details.pattern && (
                  <DetailBlock label={t("typicalEegPattern")} text={card.details.pattern} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text)]/70">{label}</div>
      <p className="text-sm leading-relaxed text-[var(--color-text)]">{text}</p>
    </div>
  );
}
