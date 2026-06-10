"use client";

import { useI18n } from "@/i18n/provider";

const STATS = [
  { value: "30s", labelKey: "home.statAverage" },
  { value: "100%", labelKey: "home.statAccuracy" },
  { value: "18", labelKey: "home.statIssueTypes" },
] as const;

const NARRATIVE = [
  {
    labelKey: "home.challenge",
    textKey: "home.challengeText",
  },
  {
    labelKey: "home.solution",
    textKey: "home.solutionText",
  },
  {
    labelKey: "home.result",
    textKey: "home.resultText",
  },
] as const;

export function StatsSection() {
  const { t } = useI18n();

  return (
    <section
      id="stats"
      className="w-full border-y border-border bg-muted/30 px-6 py-20 lg:py-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16">
          <span className="section-label">{t("home.statsLabel")}</span>
          <h2 className="mt-4 max-w-lg text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            {t("home.statsTitle")}
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="ep-card p-8 lg:p-10">
            <div className="grid grid-cols-3 gap-6">
              {STATS.map((stat) => (
                <div key={stat.labelKey}>
                  <div className="text-3xl font-normal text-ep-green lg:text-4xl">
                    {stat.value}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t(stat.labelKey)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ep-card flex flex-col gap-6 p-8 lg:p-10">
            {NARRATIVE.map((item, i) => (
              <div key={item.labelKey}>
                {i > 0 && <div className="mb-6 h-px bg-border" />}
                <span className="section-label">{t(item.labelKey)}</span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(item.textKey)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
