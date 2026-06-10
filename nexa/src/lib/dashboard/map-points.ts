import { shortenAddress } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/utils";
import type { ReportMapPoint } from "@/components/dashboard/reports-map";

/** The report fields the dashboard map needs, newest-first (as queried). */
export type MappableReportInput = {
  id: string;
  issueType: string | null;
  status: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
};

/**
 * Builds the dashboard map pins from the user's reports. Keeps only reports
 * with valid coordinates and numbers them by filing order (#1 = earliest).
 *
 * The number is computed from the CURRENT set every call, so deleting a report
 * re-sequences the rest contiguously (delete the "2" of 1·2·3·4 and the pins
 * become 1·2·3, never 1·3·4). `reports` is newest-first, so the earliest is
 * last — hence `length - index`.
 */
export function buildReportMapPoints(
  reports: MappableReportInput[],
): ReportMapPoint[] {
  const mappable = reports.filter(
    (
      report,
    ): report is MappableReportInput & {
      latitude: number;
      longitude: number;
    } =>
      typeof report.latitude === "number" &&
      Number.isFinite(report.latitude) &&
      typeof report.longitude === "number" &&
      Number.isFinite(report.longitude),
  );

  return mappable.map((report, index) => ({
    id: report.id,
    latitude: report.latitude,
    longitude: report.longitude,
    issueType: report.issueType,
    shortLocation: shortenAddress(report.address),
    status: report.status,
    relativeTime: formatRelativeTime(report.createdAt),
    order: mappable.length - index,
  }));
}
