import type { Agency } from "@/generated/prisma/client";
import { IntakeMethod, IssueType } from "@/generated/prisma/enums";

let seq = 0;

/**
 * Build a fully-populated `Agency` row. Defaults describe a Palo Alto Open311
 * agency wired for API intake. Override any field as needed.
 */
export function makeAgency(overrides: Partial<Agency> = {}): Agency {
  seq += 1;
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: `agency_${seq}`,
    name: `Test Agency ${seq}`,
    jurisdiction: "city-palo-alto",
    issueTypes: [IssueType.ROAD_DAMAGE, IssueType.STREETLIGHT_OUTAGE],
    intakeMethod: IntakeMethod.API,
    intakeUrl: "https://sandbox.open311.org/v2",
    intakeEmail: null,
    // Open311 config lives under the `open311` key (see src/lib/submission/open311.ts).
    requiredFields: { open311: { endpoint: "https://sandbox.open311.org/v2" } },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}
