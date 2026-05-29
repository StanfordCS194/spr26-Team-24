import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

interface ConfirmedReport {
  id: string;
  issueType: string | null;
  aiDescription: string | null;
  createdAt: string;
}

interface ConfirmedStepProps {
  report: ConfirmedReport;
  onReportAnother: () => void;
}

export function ConfirmedStep({ report, onReportAnother }: ConfirmedStepProps) {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-col items-center gap-10 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-ep-green-light">
        <CheckCircle2 className="size-10 text-ep-green" />
      </div>

      <div>
        <h2 className="text-3xl font-normal tracking-tight">
          {t("report.submitted")}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {t("report.submittedText")}
        </p>
      </div>

      <div className="ep-card w-full max-w-md p-8 text-left">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t("report.reportId")}
            </span>
            <span className="font-mono text-sm">{report.id}</span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t("report.issueType")}
            </span>
            <span className="text-sm font-medium">
              {report.issueType
                ? t(`issue.${report.issueType}`)
                : t("common.unknown")}
            </span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t("report.submittedLabel")}
            </span>
            <time
              dateTime={new Date(report.createdAt).toISOString()}
              title={formatFullDateTime(report.createdAt)}
              className="text-sm"
            >
              {formatRelativeTime(report.createdAt, locale, t("time.justNow"))}
            </time>
          </div>
          {report.aiDescription && (
            <>
              <div className="h-px bg-border" />
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {t("report.aiSummary")}
                </span>
                <p className="mt-2 text-sm leading-relaxed text-foreground">
                  {report.aiDescription}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className="btn-cta btn-cta-outline">
          {t("report.viewDashboard")}
        </Link>
        <button className="btn-cta btn-cta-purple" onClick={onReportAnother}>
          {t("report.reportAnother")}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
