import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";

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
  return (
    <div className="flex flex-col items-center gap-10 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-ep-green-light">
        <CheckCircle2 className="size-10 text-ep-green" />
      </div>

      <div>
        <h2 className="text-3xl font-normal tracking-tight">
          Report submitted!
        </h2>
        <p className="mt-2 text-muted-foreground">
          Your civic report has been filed successfully.
        </p>
      </div>

      <div className="ep-card w-full max-w-md p-8 text-left">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Report ID
            </span>
            <span className="font-mono text-sm">{report.id}</span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Issue Type
            </span>
            <span className="text-sm font-medium">
              {ISSUE_TYPE_LABELS[report.issueType ?? ""] ||
                report.issueType ||
                "Unknown"}
            </span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Submitted
            </span>
            <time
              dateTime={new Date(report.createdAt).toISOString()}
              title={formatFullDateTime(report.createdAt)}
              className="text-sm"
            >
              {formatRelativeTime(report.createdAt)}
            </time>
          </div>
          {report.aiDescription && (
            <>
              <div className="h-px bg-border" />
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  AI Summary
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
          View Dashboard
        </Link>
        <button className="btn-cta btn-cta-purple" onClick={onReportAnother}>
          Report Another Issue
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
