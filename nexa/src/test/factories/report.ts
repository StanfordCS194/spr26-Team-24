import type { Report } from "@/generated/prisma/client";
import { IssueType, ReportStatus } from "@/generated/prisma/enums";

let seq = 0;

/**
 * Build a fully-populated `Report` row. Defaults describe a confirmed
 * road-damage report near Stanford/Palo Alto. Override any field as needed.
 */
export function makeReport(overrides: Partial<Report> = {}): Report {
  seq += 1;
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: `report_${seq}`,
    userId: `user_${seq}`,
    imageUrl: "https://example.com/photo.jpg",
    description: "Large pothole on the corner of University Ave.",
    aiDescription: "A deep pothole in the roadway posing a hazard to cyclists.",
    issueType: IssueType.ROAD_DAMAGE,
    latitude: 37.4419,
    longitude: -122.143,
    address: "University Ave, Palo Alto, CA",
    status: ReportStatus.CONFIRMED,
    agencyId: null,
    externalTrackingId: null,
    userResolved: null,
    userResolvedAt: null,
    issueGroupId: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}
