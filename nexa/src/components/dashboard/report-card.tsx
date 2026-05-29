"use client";

import { useState } from "react";
import { ChevronDown, ImageOff, MapPin } from "lucide-react";
import { shortenAddress } from "@/lib/constants";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";
import { DeleteReportButton } from "@/components/dashboard/delete-report-button";
import { ResolutionPrompt } from "@/components/dashboard/resolution-prompt";
import { useI18n } from "@/i18n/provider";

const RESOLUTION_PROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const STATUSES_HIDING_PROMPT = new Set([
  "DRAFT",
  "CLASSIFYING",
  "RESOLVED",
  "CLOSED",
]);

export interface DashboardReport {
  id: string;
  issueType: string | null;
  status: string;
  description: string | null;
  aiDescription: string | null;
  address: string | null;
  imageUrl: string | null;
  createdAt: Date;
  externalTrackingId?: string | null;
  userResolved?: boolean | null;
}

function shouldShowResolutionPrompt(report: DashboardReport): boolean {
  if (report.externalTrackingId) return false;
  if (report.userResolved !== null && report.userResolved !== undefined)
    return false;
  if (STATUSES_HIDING_PROMPT.has(report.status)) return false;
  return Date.now() - report.createdAt.getTime() >= RESOLUTION_PROMPT_AFTER_MS;
}

interface ReportCardProps {
  report: DashboardReport;
}

function statusPillClass(status: string): string {
  switch (status) {
    case "CONFIRMED":
      return "bg-ep-green-light text-ep-green";
    case "RESOLVED":
    case "CLOSED":
      return "bg-blue-50 text-blue-700";
    case "SUBMITTED":
    case "IN_PROGRESS":
      return "bg-ep-purple-light text-ep-purple";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function ReportCard({ report }: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { t, locale } = useI18n();

  const issueLabel = report.issueType
    ? t(`issue.${report.issueType}`)
    : t("dashboard.uncategorized");
  const shortLocation = shortenAddress(report.address);
  const summary =
    report.aiDescription?.trim() ||
    report.description?.trim() ||
    t("dashboard.noDescription");

  return (
    <article className="ep-card overflow-hidden transition-colors hover:bg-muted/20">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        aria-expanded={expanded}
        aria-controls={`report-${report.id}-details`}
        className="block w-full cursor-pointer p-6 text-left"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {issueLabel}
            </span>
            <h2 className="mt-2 text-lg font-medium leading-snug">
              {shortLocation || t("dashboard.locationUnavailable")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              <time
                dateTime={report.createdAt.toISOString()}
                title={formatFullDateTime(report.createdAt, locale)}
              >
                {formatRelativeTime(
                  report.createdAt,
                  locale,
                  t("time.justNow"),
                )}
              </time>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider ${statusPillClass(report.status)}`}
            >
              {t(`status.${report.status}`)}
            </span>
            <span onClick={(event) => event.stopPropagation()}>
              <DeleteReportButton reportId={report.id} />
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </div>
        </div>

        {!expanded && (
          <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-foreground">
            {summary}
          </p>
        )}

        {shouldShowResolutionPrompt(report) && (
          <ResolutionPrompt reportId={report.id} />
        )}
      </div>

      {expanded && (
        <div
          id={`report-${report.id}-details`}
          className="border-t border-border px-6 pb-6 pt-5"
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {t("dashboard.photo")}
              </span>
              <div className="mt-2 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
                {report.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={report.imageUrl}
                    alt={t("dashboard.photoAlt", { issue: issueLabel })}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageOff className="size-6" aria-hidden="true" />
                    <p className="text-xs">{t("dashboard.noPhoto")}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {report.description?.trim() ? (
                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.yourDescription")}
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-foreground">
                    {report.description}
                  </p>
                </div>
              ) : null}

              {report.aiDescription?.trim() ? (
                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.aiSummary")}
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-foreground">
                    {report.aiDescription}
                  </p>
                </div>
              ) : null}

              {!report.description?.trim() && !report.aiDescription?.trim() && (
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.noDescriptionProvided")}
                </p>
              )}

              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {t("report.location")}
                </span>
                {report.address ? (
                  <div className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-foreground">
                    <MapPin
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>{report.address}</span>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("dashboard.noLocation")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
