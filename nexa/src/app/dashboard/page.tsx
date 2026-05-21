import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, ClipboardList } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ISSUE_TYPE_LABELS, shortenAddress } from "@/lib/constants";
import { formatFullDateTime, formatRelativeTime } from "@/lib/utils";
import { ReportCard } from "@/components/dashboard/report-card";
import {
  ReportsMap,
  type ReportMapPoint,
} from "@/components/dashboard/reports-map";

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
      address: true,
      imageUrl: true,
      latitude: true,
      longitude: true,
      createdAt: true,
    },
  });

  const totalReports = reports.length;
  const confirmedReports = reports.filter(
    (report) => report.status === "CONFIRMED",
  ).length;
  const latestReport = reports[0];

  const mapPoints: ReportMapPoint[] = reports
    .filter(
      (
        report,
      ): report is typeof report & { latitude: number; longitude: number } =>
        typeof report.latitude === "number" &&
        Number.isFinite(report.latitude) &&
        typeof report.longitude === "number" &&
        Number.isFinite(report.longitude),
    )
    .map((report) => ({
      id: report.id,
      latitude: report.latitude,
      longitude: report.longitude,
      issueLabel:
        ISSUE_TYPE_LABELS[report.issueType ?? ""] ||
        report.issueType ||
        "Uncategorized",
      shortLocation: shortenAddress(report.address),
      status: report.status,
      relativeTime: formatRelativeTime(report.createdAt),
    }));

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

      {mapPoints.length > 0 && (
        <div className="mt-8">
          <ReportsMap points={mapPoints} />
        </div>
      )}

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
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
