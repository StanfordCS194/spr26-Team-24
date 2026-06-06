"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/provider";

export function BottomCTA() {
  const { t } = useI18n();

  return (
    <section className="w-full px-6 py-12">
      <div className="mx-auto max-w-[1440px]">
        <div className="rounded-2xl bg-[var(--ep-cta-bg)] px-8 py-20 text-center lg:px-16">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-white/40">
            {t("home.getStarted")}
          </span>
          <h2 className="mt-4 text-3xl font-normal leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("home.ctaTitle1")}
            <br />
            {t("home.ctaTitle2")}
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-white/60">
            {t("home.ctaText")}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/report" className="btn-cta btn-cta-purple">
              {t("home.reportAnIssue")}
              <ArrowRight className="size-4" />
            </Link>
            <a href="#how-it-works" className="btn-cta btn-cta-white-outline">
              {t("home.learnMore")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
