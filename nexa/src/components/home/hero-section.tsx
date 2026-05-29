"use client";

import Link from "next/link";
import { Camera, Zap, ArrowRight, Shield, MapPin } from "lucide-react";
import { useI18n } from "@/i18n/provider";

const HIGHLIGHTS = [
  {
    icon: Camera,
    titleKey: "home.snapTitle",
    descriptionKey: "home.snapDescription",
  },
  {
    icon: Shield,
    titleKey: "home.verifyTitle",
    descriptionKey: "home.verifyDescription",
  },
  {
    icon: MapPin,
    titleKey: "home.routeTitle",
    descriptionKey: "home.routeDescription",
  },
] as const;

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

        <div className="border-t border-border px-4 py-16 lg:px-0 lg:py-20">
          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            {HIGHLIGHTS.map((item) => (
              <div key={item.titleKey} className="flex flex-col gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                  <item.icon className="size-5 text-ep-green" />
                </div>
                <h3 className="text-base font-semibold">{t(item.titleKey)}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(item.descriptionKey)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
