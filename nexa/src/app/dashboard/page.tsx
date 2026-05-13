"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  Trash2,
} from "lucide-react";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import {
  getReports,
  seedDemoReports,
  clearReports,
  type StoredReport,
} from "@/lib/reports-store";

const STATUS_CONFIG: Record<
  StoredReport["status"],
  { label: string; color: string; icon: React.ElementType }
> = {
  SUBMITTED: {
    label: "Submitted",
    color: "bg-blue-50 text-blue-600",
    icon: FileText,
  },
  ACKNOWLEDGED: {
    label: "Acknowledged",
    color: "bg-yellow-50 text-yellow-600",
    icon: Clock,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-orange-50 text-orange-600",
    icon: Loader2,
  },
  RESOLVED: {
    label: "Resolved",
    color: "bg-ep-green-light text-ep-green",
    icon: CheckCircle2,
  },
};

const SEVERITY_BADGE: Record<string, string> = {
  low: "bg-ep-green-light text-ep-green",
  medium: "bg-yellow-50 text-yellow-600",
  high: "bg-red-50 text-red-600",
};

function ReportCard({ report }: { report: StoredReport }) {
  const status = STATUS_CONFIG[report.status];
  const StatusIcon = status.icon;

  return (
    <div className="ep-card p-6 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wider ${status.color}`}
            >
              <StatusIcon className="size-3" />
              {status.label}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-medium uppercase tracking-wider ${SEVERITY_BADGE[report.severity] || ""}`}
            >
              {report.severity}
            </span>
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {ISSUE_TYPE_LABELS[report.issueType] || report.issueType}
          </h3>

          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {report.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {report.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                <span className="max-w-[200px] truncate">{report.address}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {new Date(report.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>

          {report.agency && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Routed to: {report.agency}
            </p>
          )}
        </div>

        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {report.id}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setReports(getReports());
    setMounted(true);
  }, []);

  function handleSeed() {
    seedDemoReports();
    setReports(getReports());
  }

  function handleClear() {
    clearReports();
    setReports([]);
  }

  if (!mounted) return null;

  const submitted = reports.filter((r) => r.status === "SUBMITTED").length;
  const inProgress = reports.filter(
    (r) => r.status === "ACKNOWLEDGED" || r.status === "IN_PROGRESS",
  ).length;
  const resolved = reports.filter((r) => r.status === "RESOLVED").length;

  return (
    <main className="flex min-h-screen flex-col">
      <div className="border-b border-border bg-background px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-start justify-between">
            <div>
              <span className="section-label">/ Dashboard</span>
              <h1 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
                Your Reports
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Track the status of issues you&apos;ve reported.
              </p>
            </div>
            <Link href="/report" className="btn-cta btn-cta-purple shrink-0">
              New Report
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {reports.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="ep-card p-4 text-center">
                <p className="text-2xl font-semibold text-foreground">
                  {submitted}
                </p>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Submitted
                </p>
              </div>
              <div className="ep-card p-4 text-center">
                <p className="text-2xl font-semibold text-foreground">
                  {inProgress}
                </p>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  In Progress
                </p>
              </div>
              <div className="ep-card p-4 text-center">
                <p className="text-2xl font-semibold text-foreground">
                  {resolved}
                </p>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Resolved
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {reports.length === 0 ? (
          <div className="flex flex-col items-center gap-6 py-20 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <AlertTriangle className="size-8 text-muted-foreground/40" />
            </div>
            <div>
              <h2 className="text-lg font-medium">No reports yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                File your first civic report or load demo data to see how
                tracking works.
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/report" className="btn-cta btn-cta-purple">
                Report an Issue
                <ArrowRight className="size-4" />
              </Link>
              <button className="btn-cta btn-cta-outline" onClick={handleSeed}>
                Load Demo Data
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              {reports.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>

            <div className="mt-8 flex justify-between border-t border-border pt-6">
              <button className="btn-cta btn-cta-outline" onClick={handleSeed}>
                Load Demo Data
              </button>
              <button
                className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-red-500"
                onClick={handleClear}
              >
                <Trash2 className="size-3.5" />
                Clear All
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
