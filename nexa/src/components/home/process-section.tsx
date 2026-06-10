"use client";

import Link from "next/link";
import { Camera, Zap, CheckCircle2, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n/provider";

const STEPS = [
  {
    number: "01",
    icon: Camera,
    titleKey: "home.step1Title",
    descriptionKey: "home.step1Description",
  },
  {
    number: "02",
    icon: Zap,
    titleKey: "home.step2Title",
    descriptionKey: "home.step2Description",
  },
  {
    number: "03",
    icon: CheckCircle2,
    titleKey: "home.step3Title",
    descriptionKey: "home.step3Description",
  },
] as const;

export function ProcessSection() {
  const { t } = useI18n();

  return (
    <section id="how-it-works" className="w-full px-6 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-16">
          <span className="section-label">{t("home.howItWorksLabel")}</span>
          <h2 className="mt-4 max-w-lg text-3xl font-normal leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            {t("home.processTitle")}
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div
              key={step.titleKey}
              className="ep-card flex flex-col gap-5 p-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-ep-green-light">
                  <step.icon className="size-5 text-ep-green" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {step.number}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold">{t(step.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(step.descriptionKey)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <video
            data-testid="demo-video"
            className="w-full rounded-xl border border-border shadow-sm"
            src="/demo-workflow.mp4"
            poster="/demo-workflow-poster.jpg"
            controls
            loop
            muted
            autoPlay
            playsInline
          />
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {t("home.demoCaption")}
          </p>
        </div>

        <div className="mt-10">
          <Link href="/report" className="btn-cta btn-cta-purple w-fit">
            {t("home.tryNow")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
