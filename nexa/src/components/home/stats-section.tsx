"use client";

import { useI18n } from "@/i18n/provider";

// Municipalities Nexa currently routes reports for. Mirrors the verified
// jurisdictions seeded in prisma/agencies.ts (kept in sync by hand — there are
// only a handful and they change rarely). The count drives the stat below.
const SERVICED_MUNICIPALITIES = [
  "Palo Alto",
  "Menlo Park",
  "East Palo Alto",
  "Mountain View",
  "Santa Clara County",
  "Milpitas",
  "Morgan Hill",
  "Gilroy",
  "Watsonville",
  "Vallejo",
  "San Leandro",
] as const;

const STATS = [
  { value: "30s", labelKey: "home.statAverage" },
  {
    value: String(SERVICED_MUNICIPALITIES.length),
    labelKey: "home.statMunicipalities",
  },
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

        {/* Small-font roll of the municipalities we actually route reports for. */}
        <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
          <span className="font-mono uppercase tracking-wider">
            {t("home.servicedLabel")}
          </span>{" "}
          <span className="text-foreground">
            {SERVICED_MUNICIPALITIES.join(" · ")}
          </span>
        </p>
      </div>
    </section>
  );
}
