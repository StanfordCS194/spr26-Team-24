import type { Prisma } from "../src/generated/prisma/client";

/**
 * The seeded Agency records, extracted to a standalone module so that the same
 * single source of truth feeds both:
 *   - `prisma/seed.ts` (writes them to the database), and
 *   - `eval/readiness.ts` (the OFFLINE submission-readiness harness, which
 *     drives the real `resolveAgencyId` against an in-memory Prisma stub backed
 *     by this array — never a live DB).
 *
 * Keeping it as plain data (no DB import) means the readiness harness can run in
 * CI with no DATABASE_URL and no network. The required-fields schema below is
 * the contract the harness validates each synthetic report against.
 */
export type AgencySeed = {
  name: string;
  jurisdiction: string;
  issueTypes: Array<
    | "ROAD_DAMAGE"
    | "STREETLIGHT_OUTAGE"
    | "ILLEGAL_DUMPING"
    | "VEHICLE_EMISSIONS"
    | "OTHER"
  >;
  intakeMethod: "API" | "WEB_FORM" | "EMAIL" | "PHONE";
  intakeUrl: string | null;
  intakeEmail: string | null;
  requiredFields: Prisma.InputJsonValue;
};

export const AGENCIES: AgencySeed[] = [
  {
    name: "Palo Alto 311",
    jurisdiction: "city-palo-alto",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      latitude: { type: "number", required: false },
      longitude: { type: "number", required: false },
      photo: { type: "file", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    // CORRECTION (verified per issue #23 agency-research comment, 2026-06-09):
    // the smoking-vehicle complaint authority is the California Air Resources
    // Board (CARB), NOT the Bureau of Automotive Repair (BAR). The live program
    // is the CARB "Smoking Vehicle Complaint", phone (800) 242-4450.
    // The source comment did not provide an exact CARB web-form URL, so we keep
    // intakeUrl null (unverified) rather than invent one; the verified phone
    // hotline is the authoritative contact channel, so intakeMethod is PHONE
    // (issue #193 — this is the only working modality for VEHICLE_EMISSIONS).
    // The number itself lives in requiredFields.contact_phone.value so the
    // prefill copy-over guide surfaces it alongside the other fields.
    name: "CARB Smoking Vehicle Complaint",
    jurisdiction: "city-palo-alto",
    issueTypes: ["VEHICLE_EMISSIONS"],
    intakeMethod: "PHONE",
    intakeUrl: null,
    intakeEmail: null,
    requiredFields: {
      // Verified CARB Smoking Vehicle Complaint hotline (issue #23).
      contact_phone: { type: "string", value: "(800) 242-4450" },
      license_plate: { type: "string", required: true },
      vehicle_make: { type: "string", required: true },
      vehicle_model: { type: "string", required: false },
      vehicle_color: { type: "string", required: false },
      observation_location: { type: "string", required: true },
      observation_datetime: { type: "datetime", required: true },
    },
  },
  {
    name: "Menlo Park ACT",
    jurisdiction: "city-menlo-park",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl: "https://www.menlopark.gov/Services/ACT-Menlo-Park",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      photo: { type: "file", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    // Verified Menlo Park SeeClickFix Open311 endpoint (issue #98 comment
    // "Verified Open311 API options", source-verified 2026-06-09). Distinct
    // `name` from the existing "Menlo Park ACT" WEB_FORM row so the
    // @@unique([jurisdiction, name]) key does not collide.
    //
    // Verified facts (all confirmed via services.json HTTP 200, org "Menlo Park"):
    //   - base endpoint     https://seeclickfix.com/open311/v2
    //   - sandbox endpoint  https://int.seeclickfix.com/open311/v2
    //   - no auth required  (a valid User-Agent is required for public POST)
    //   - service_code ROAD_DAMAGE    = 94213 (Potholes)
    //   - service_code ILLEGAL_DUMPING = 94210 (Dumping)
    //
    // CAVEAT (UNVERIFIED): the exact `jurisdiction_id` token required by
    // POST /requests.json was NOT confirmed — numeric 76196 and the slug both
    // 404 on per-jurisdiction GET, and no live POST was performed. We therefore
    // do NOT seed a jurisdictionId (omitting it is correct for single-tenant
    // posting; confirm with SeeClickFix support and test against the sandbox
    // before relying on the production write path).
    //
    // The `open311` block below matches the shape consumed by
    // parseOpen311Config()/Open311Config in src/lib/submission/open311.ts:
    // { endpoint, serviceCodes: Partial<Record<IssueType, string>> }. The base
    // endpoint is also mirrored in `intakeUrl` (the client falls back to it).
    name: "Menlo Park SeeClickFix (Open311)",
    jurisdiction: "city-menlo-park",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        // Sandbox endpoint for safe testing (not consumed by the client yet;
        // kept here as verified provenance per the #98 caveat).
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "94213",
          ILLEGAL_DUMPING: "94210",
        },
      },
    },
  },
  {
    name: "Mountain View Public Works",
    jurisdiction: "city-mountain-view",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl: "https://www.mountainview.gov/our-city/departments/public-works",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      contact_name: { type: "string", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    name: "Santa Clara County Public Works",
    jurisdiction: "county-santa-clara-unincorporated",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://publicworks.sccgov.org/services/road-maintenance/report-problem",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      latitude: { type: "number", required: false },
      longitude: { type: "number", required: false },
    },
  },
];
