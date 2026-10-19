"use client";

import { useLang } from "@/lib/language-context";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { termsSections } from "@/lib/legal-content";


export default function TermsOfService() {
  const { t, lang } = useLang();


  const content = (termsSections as any)[lang] || termsSections.en;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="mb-8 inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {t("backToHome")}
      </Link>

      <h1 className="mb-2 text-3xl font-bold text-[var(--color-text)]">
        {t("termsOfService")}
      </h1>
      <p className="mb-8 text-sm text-[var(--color-text-secondary)]">
        {t("lastUpdatedDate")}
      </p>

      <div className="space-y-8">
        {content.map((section: {title: string, content: string}, i: number) => (
          <div key={i}>
            <h2 className="mb-3 text-lg font-semibold text-[var(--color-text)]">
              {i + 1}. {section.title}
            </h2>
            <p className="leading-7 text-[var(--color-text-secondary)]">
              {section.content}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-12 border-t border-[var(--color-border)] pt-8 text-center text-sm text-[var(--color-text-secondary)]">
        <p>NeuroAccess &copy; 2026. {t("allRightsReserved")}</p>
      </div>
    </div>
  );
}
