"use client";

import type { ComponentType, SVGProps } from "react";
import { ChevronRight } from "lucide-react";

export type FlowIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type FlowStep = {
  key: string;
  label: string;
  caption: string;
  icon: FlowIcon;
};

/**
 * Compact process strip: horizontal on md+, stacked on small screens.
 * Uses only CSS variables so it adapts to light / dark automatically.
 */
export default function HowItWorksFlow({
  steps,
  ariaLabel,
}: {
  steps: FlowStep[];
  ariaLabel?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5 sm:px-6 sm:py-6"
      aria-label={ariaLabel}
    >
      {/* Horizontal (md and up) */}
      <ol className="hidden items-start md:flex">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex flex-1 items-start">
              <div className="flex min-w-0 flex-1 flex-col items-center px-1 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="mt-2 text-[11px] font-medium leading-tight text-[var(--color-text)]">
                  {step.label}
                </span>
                <span className="mt-0.5 text-[10px] leading-tight text-[var(--color-text-secondary)]">
                  {step.caption}
                </span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight
                  className="mt-3 h-4 w-4 shrink-0 text-[var(--color-text-secondary)]/50"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Stacked (below md) */}
      <ol className="flex flex-col gap-3 md:hidden">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-medium leading-tight text-[var(--color-text)]">
                  {step.label}
                </p>
                <p className="mt-0.5 text-xs leading-tight text-[var(--color-text-secondary)]">
                  {step.caption}
                </p>
              </div>
              {i < steps.length - 1 && (
                <span className="pt-2 text-xs text-[var(--color-text-secondary)]/50" aria-hidden="true">
                  ↓
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
