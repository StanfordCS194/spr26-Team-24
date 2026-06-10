"use client";

import Link from "next/link";
import { Zap, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/provider";

export function HeroSection() {
  const { t } = useI18n();

  return (
    <section className="relative w-full">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="flex flex-col items-center px-4 pb-16 pt-16 text-center lg:px-8 lg:pb-20 lg:pt-20">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-ep-green/20 bg-ep-green-light px-4 py-1.5">
            <Zap className="size-3.5 text-ep-green" />
            <span className="font-mono text-xs font-medium uppercase tracking-wider text-ep-green">
              {t("home.badge")}
            </span>
          </div>

          <h1 className="max-w-3xl text-4xl font-normal leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            {t("home.titleLine1")}
            <br />
            <span className="text-muted-foreground">
              {t("home.titleLine2")}
            </span>
          </h1>

          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("home.subtitle")}
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/report" className="btn-cta btn-cta-purple">
              {t("home.reportAnIssue")}
              <ArrowRight className="size-4" />
            </Link>
            <a href="#how-it-works" className="btn-cta btn-cta-outline">
              {t("home.seeHow")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
