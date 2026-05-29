"use client";

import { Zap, Globe, LayoutDashboard, FileX2 } from "lucide-react";
import { useI18n } from "@/i18n/provider";

const FEATURES = [
  {
    icon: Zap,
    titleKey: "home.featureAi",
    descriptionKey: "home.featureAiText",
  },
  {
    icon: Globe,
    titleKey: "home.featureEverywhere",
    descriptionKey: "home.featureEverywhereText",
  },
  {
    icon: LayoutDashboard,
    titleKey: "home.featureTracking",
    descriptionKey: "home.featureTrackingText",
  },
  {
    icon: FileX2,
    titleKey: "home.featureForms",
    descriptionKey: "home.featureFormsText",
  },
] as const;

export function FeaturesSection() {
  const { t } = useI18n();

  return (
    <section id="features" className="w-full px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16 grid gap-6 lg:grid-cols-2">
          <div>
            <span className="section-label">{t("home.whyLabel")}</span>
            <h2 className="mt-4 max-w-md text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              {t("home.whyTitle")}
            </h2>
          </div>
          <div className="flex items-end">
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground lg:ml-auto">
              {t("home.whyText")}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.titleKey} className="ep-card p-8">
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                <feature.icon className="size-5 text-ep-green" />
              </div>
              <h3 className="text-base font-semibold">
                {t(feature.titleKey)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(feature.descriptionKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
