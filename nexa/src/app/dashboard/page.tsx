import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, ClipboardList } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildReportMapPoints } from "@/lib/dashboard/map-points";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";
import { ReportCard } from "@/components/dashboard/report-card";
import {
  ReportsMap,
  type ReportMapPoint,
} from "@/components/dashboard/reports-map";
import { T } from "@/components/i18n-text";
import { PushOptIn } from "@/components/push-opt-in";

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
      latitude: true,
      longitude: true,
      createdAt: true,
      updatedAt: true,
      externalTrackingId: true,
      userResolved: true,
    },
  });

  const totalReports = reports.length;
  const confirmedReports = reports.filter(
    (report) => report.status === "CONFIRMED",
  ).length;
  const latestReport = reports[0];

  // Pins are numbered by filing order (#1 = earliest), recomputed from the
  // current reports, so deleting one re-sequences the rest contiguously.
  const mapPoints: ReportMapPoint[] = buildReportMapPoints(reports);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="section-label">
            <T k="dashboard.label" />
          </span>
          <h1 className="mt-3 text-3xl font-normal tracking-tight">
            <T k="dashboard.myReports" />
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <T
              k="dashboard.tracking"
              params={{ user: user?.name || user?.email || session.email }}
            />
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href="/report" className="btn-cta btn-cta-purple">
            <T k="nav.reportIssue" />
            <ArrowRight className="size-4" />
          </Link>
          <PushOptIn />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClipboardList className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              <T k="dashboard.totalReports" />
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold">{totalReports}</p>
        </div>

        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              <T k="dashboard.confirmed" />
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold">{confirmedReports}</p>
        </div>

        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              <T k="dashboard.mostRecent" />
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

      {mapPoints.length > 0 && (
        <div className="mt-8">
          <ReportsMap points={mapPoints} />
        </div>
      )}

      <div className="mt-8">
        {reports.length === 0 ? (
          <div className="ep-card p-8 text-center">
            <p className="text-lg">
              <T k="dashboard.noReports" />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              <T k="dashboard.noReportsHint" />
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
