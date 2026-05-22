import Link from "next/link";
import Image from "next/image";
import { redirect, notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Clock3,
  AlertTriangle,
  FileText,
  Sparkles,
  Navigation,
  Calendar,
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
      return "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
    case "SUBMITTED":
    case "IN_PROGRESS":
      return "bg-ep-purple-light text-ep-purple";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent("/dashboard")}`);
  }

  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
  });

  if (!report) {
    notFound();
  }

  // Only allow the owner to view their own report
  if (report.userId !== session.userId) {
    notFound();
  }

  const issueLabel =
    ISSUE_TYPE_LABELS[report.issueType ?? ""] ||
    report.issueType ||
    "Uncategorized";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to Dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
            {report.address || "Report Details"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <time
              dateTime={report.createdAt.toISOString()}
              title={formatFullDateTime(report.createdAt)}
            >
              Reported {formatRelativeTime(report.createdAt)}
            </time>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider ${statusPillClass(report.status)}`}
          >
            {formatStatus(report.status)}
          </span>
          <DeleteReportButton reportId={report.id} />
        </div>
      </div>

      {/* Photo */}
      {report.imageUrl && (
        <div className="mt-8">
          <span className="section-label">/ Photo</span>
          <div className="ep-card mt-3 overflow-hidden">
            <div className="relative aspect-video w-full">
              <Image
                src={report.imageUrl}
                alt={`Photo for ${issueLabel} report`}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 768px"
              />
            </div>
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* Issue Type */}
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Issue Type
            </p>
          </div>
          <p className="mt-3 text-lg font-medium">{issueLabel}</p>
        </div>

        {/* Status */}
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">Status</p>
          </div>
          <div className="mt-3">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider ${statusPillClass(report.status)}`}
            >
              {formatStatus(report.status)}
            </span>
          </div>
        </div>

        {/* Address */}
        {report.address && (
          <div className="ep-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4" />
              <p className="font-mono text-xs uppercase tracking-wider">
                Address
              </p>
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed">
              {report.address}
            </p>
          </div>
        )}

        {/* Coordinates */}
        {report.latitude != null && report.longitude != null && (
          <div className="ep-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Navigation className="size-4" />
              <p className="font-mono text-xs uppercase tracking-wider">
                Coordinates
              </p>
            </div>
            <p className="mt-3 font-mono text-sm">
              {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
            </p>
          </div>
        )}

        {/* Created */}
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Created
            </p>
          </div>
          <p className="mt-3 text-sm">
            <time
              dateTime={report.createdAt.toISOString()}
              title={formatRelativeTime(report.createdAt)}
            >
              {formatFullDateTime(report.createdAt)}
            </time>
          </p>
        </div>

        {/* Last Updated */}
        <div className="ep-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock3 className="size-4" />
            <p className="font-mono text-xs uppercase tracking-wider">
              Last Updated
            </p>
          </div>
          <p className="mt-3 text-sm">
            <time
              dateTime={report.updatedAt.toISOString()}
              title={formatRelativeTime(report.updatedAt)}
            >
              {formatFullDateTime(report.updatedAt)}
            </time>
          </p>
        </div>
      </div>

      {/* Description */}
      {report.description && (
        <div className="mt-8">
          <span className="section-label">
            <FileText className="mb-0.5 mr-1.5 inline size-3.5" />
            Your Description
          </span>
          <div className="ep-card mt-3 p-6">
            <p className="text-sm leading-relaxed text-foreground">
              {report.description}
            </p>
          </div>
        </div>
      )}

      {/* AI Description */}
      {report.aiDescription && (
        <div className="mt-8">
          <span className="section-label">
            <Sparkles className="mb-0.5 mr-1.5 inline size-3.5" />
            AI Analysis
          </span>
          <div className="ep-card mt-3 border-ep-purple/20 bg-ep-purple-light/30 p-6">
            <p className="text-sm leading-relaxed text-foreground">
              {report.aiDescription}
            </p>
          </div>
        </div>
      )}

      {/* External Tracking */}
      {report.externalTrackingId && (
        <div className="mt-8">
          <span className="section-label">/ External Tracking</span>
          <div className="ep-card mt-3 p-5">
            <p className="font-mono text-sm">{report.externalTrackingId}</p>
          </div>
        </div>
      )}
    </main>
  );
}
