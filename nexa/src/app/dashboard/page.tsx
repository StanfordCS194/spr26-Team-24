import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ClipboardList,
  ImageIcon,
} from "lucide-react";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";
import { DeleteReportButton } from "@/components/dashboard/delete-report-button";

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent("/dashboard")}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true },
  });

  const reports = await prisma.report.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      issueType: true,
      status: true,
      description: true,
      aiDescription: true,
      imageUrl: true,
      address: true,
      createdAt: true,
    },
  });

  const totalReports = reports.length;
  const confirmedReports = reports.filter(
    (report) => report.status === "CONFIRMED",
  ).length;
  const latestReport = reports[0];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="section-label">/ Dashboard</span>
          <h1 className="mt-3 text-3xl font-normal tracking-tight">
            My reports
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tracking reports for {user?.name || user?.email || session.email}
          </p>
        </div>
        <Link href="/report" className="btn-cta btn-cta-purple">
          Report Issue
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClipboardList className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Total Reports
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold">{totalReports}</p>
        </div>

        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Confirmed
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold">{confirmedReports}</p>
        </div>

        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Most Recent
            </p>
          </div>
          <p className="mt-3 text-sm font-medium">
            {latestReport ? (
              <time
                dateTime={latestReport.createdAt.toISOString()}
                title={formatFullDateTime(latestReport.createdAt)}
              >
                {formatRelativeTime(latestReport.createdAt)}
              </time>
            ) : (
              "—"
            )}
          </p>
        </div>
      </div>

      <div className="mt-8">
        {reports.length === 0 ? (
          <div className="ep-card p-8 text-center">
            <p className="text-lg">No reports yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your submitted issues will appear here once you file one.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {reports.map((report) => (
              <details
                key={report.id}
                className="group ep-card p-6 transition-colors hover:bg-muted/20"
              >
                <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {ISSUE_TYPE_LABELS[report.issueType ?? ""] ||
                        report.issueType ||
                        "Uncategorized"}
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider ${statusPillClass(report.status)}`}
                      >
                        {formatStatus(report.status)}
                      </span>
                      <DeleteReportButton reportId={report.id} />
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </div>
                  </div>

                  <div className="mt-4 flex gap-4">
                    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                      {report.imageUrl ? (
                        <Image
                          src={report.imageUrl}
                          alt="Submitted issue preview"
                          width={80}
                          height={80}
                          unoptimized
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="size-6 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-medium leading-snug">
                        {report.address || "No location provided"}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <time
                          dateTime={report.createdAt.toISOString()}
                          title={formatFullDateTime(report.createdAt)}
                        >
                          {formatRelativeTime(report.createdAt)}
                        </time>
                      </p>

                      <p className="mt-3 text-sm leading-relaxed text-foreground">
                        {report.description ||
                          report.aiDescription ||
                          "No description"}
                      </p>
                    </div>
                  </div>
                </summary>

                <div className="mt-6 grid gap-5 border-t border-border pt-5 md:grid-cols-[180px_1fr]">
                  <div className="flex min-h-36 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                    {report.imageUrl ? (
                      <Image
                        src={report.imageUrl}
                        alt="Submitted issue"
                        width={180}
                        height={224}
                        unoptimized
                        className="max-h-56 w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="size-8 text-muted-foreground/50" />
                    )}
                  </div>

                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Classification
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {ISSUE_TYPE_LABELS[report.issueType ?? ""] ||
                            report.issueType ||
                            "Uncategorized"}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Status
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {formatStatus(report.status)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Submitted Text
                      </p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {report.description || "No submitted text"}
                      </p>
                    </div>

                    <div>
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Timeline
                      </p>
                      <ol className="mt-3 space-y-3 text-sm">
                        <li className="flex gap-3">
                          <span className="mt-1 size-2 rounded-full bg-ep-green" />
                          <span>Report submitted and saved to your history.</span>
                        </li>
                        <li className="flex gap-3 text-muted-foreground">
                          <span className="mt-1 size-2 rounded-full bg-muted-foreground/40" />
                          <span>Agency review updates will appear here.</span>
                        </li>
                      </ol>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
