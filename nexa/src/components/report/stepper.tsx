"use client";

import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/messages";

export type ReportStep = "describe" | "review" | "confirmed";

const STEPS: { key: ReportStep; labelKey: MessageKey; number: string }[] = [
  { key: "describe", labelKey: "report.stepDescribe", number: "1" },
  { key: "review", labelKey: "report.stepReview", number: "2" },
  { key: "confirmed", labelKey: "report.stepDone", number: "3" },
];

export function Stepper({ current }: { current: ReportStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-center gap-3">
      {STEPS.map((step, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;

        return (
          <div key={step.key} className="flex items-center gap-3">
            {i > 0 && (
              <div
                className={`h-px w-8 sm:w-12 ${isDone ? "bg-ep-green" : "bg-border"}`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-medium ${
                  isDone
                    ? "bg-ep-green text-white"
                    : isActive
                      ? "bg-foreground text-background"
                      : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {isDone ? <CheckCircle2 className="size-3.5" /> : step.number}
              </div>
              <span
                className={`hidden font-mono text-xs uppercase tracking-wider sm:block ${
                  isActive
                    ? "text-foreground"
                    : isDone
                      ? "text-ep-green"
                      : "text-muted-foreground"
                }`}
              >
                {t(step.labelKey)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
