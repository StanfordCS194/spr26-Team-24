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
    // ─── East Palo Alto — Public Works (issue #195) ──────────────────────────
    // VERIFIED per the issue #23 agency-research comment ("East Palo Alto hole
    // RESOLVED", source-verified 2026-06-09). Before this row the EPA polygon
    // (boundaries.json: jurisdictionId='city-east-palo-alto') routed reports but
    // had ZERO seeded agencies, so every East Palo Alto report resolved to
    // no_agency and could not be submitted (issue #195).
    //
    // Verified facts:
    //   - EPA Public Works handles ROAD_DAMAGE.
    //   - Intake is the city contact web form (cityofepa.org/contact) with a
    //     verified staff email fallback (maintenance@cityofepa.org; the research
    //     also lists engineering@cityofepa.org). We model the web form as the
    //     primary intake (intakeMethod=WEB_FORM) and carry the verified email in
    //     intakeEmail as the fallback channel.
    //   - EPA exposes NO machine API — the research explicitly CORRECTS an
    //     earlier "EPA uses SeeClickFix" claim (SeeClickFix is Menlo Park's
    //     provider, not EPA's), so this stays WEB_FORM, never API.
    //
    // The exact form-path / per-field validation was NOT deep-verified, so
    // requiredFields stays minimal (only the fields any city contact form needs)
    // — we do not invent field-level constraints.
    name: "East Palo Alto Public Works",
    jurisdiction: "city-east-palo-alto",
    issueTypes: ["ROAD_DAMAGE"],
    intakeMethod: "WEB_FORM",
    intakeUrl: "https://www.cityofepa.org/contact",
    intakeEmail: "maintenance@cityofepa.org",
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      contact_email: { type: "string", required: false },
    },
  },
  {
    // ─── East Palo Alto — Clean City (issue #195) ────────────────────────────
    // VERIFIED per the issue #23 agency-research comment (source-verified
    // 2026-06-09): EPA Clean City handles ILLEGAL_DUMPING. The verified intake
    // channels are the Clean City email (cleancity@cityofepa.org) and the city
    // phone line (650) 853-3100 — the research lists NO web form for this
    // program, so intakeMethod=EMAIL (the published address) and the verified
    // hotline is carried in requiredFields.contact_phone.value so the readiness
    // harness and prefill copy-over surface it as a fallback channel.
    name: "East Palo Alto Clean City",
    jurisdiction: "city-east-palo-alto",
    issueTypes: ["ILLEGAL_DUMPING"],
    intakeMethod: "EMAIL",
    intakeUrl: null,
    intakeEmail: "cleancity@cityofepa.org",
    requiredFields: {
      // Verified East Palo Alto Clean City hotline (issue #23 research).
      contact_phone: { type: "string", value: "(650) 853-3100" },
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      contact_email: { type: "string", required: false },
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
  // ─── SeeClickFix Open311 cities (O2.KR2 expansion) ─────────────────────────
  // Each row mirrors the existing "Menlo Park SeeClickFix (Open311)" shape: an
  // `open311` block with { endpoint, serviceCodes } that parseOpen311Config()
  // consumes, plus the base endpoint mirrored into intakeUrl.
  //
  // VERIFIED LIVE 2026-06-10 against the SeeClickFix Open311 production API
  // (`GET https://seeclickfix.com/open311/v2/services.json?lat=<lat>&long=<lng>`,
  // each HTTP 200 returning the city's own `organization`, and every chosen
  // service_code re-confirmed via `GET /open311/v2/services/<code>.json`
  // HTTP 200). No value below was invented — each service_code is the exact
  // integer the live catalog returns for that city.
  //
  // CAVEAT (same as the Menlo Park row, UNVERIFIED): no live POST was performed
  // and the per-jurisdiction POST `jurisdiction_id` token was not confirmed, so
  // we omit jurisdictionId. Several of these services also declare service-
  // specific `required` attributes (e.g. Milpitas pothole "direction",
  // streetlight "pole number"); those are NOT modelled here (the existing
  // Open311Config shape carries only serviceCodes), so confirm against the
  // SeeClickFix sandbox before relying on the production write path.
  {
    // City of Milpitas — verified service_codes:
    //   ROAD_DAMAGE        26652 (Pothole/Roadway Repairs)
    //   ILLEGAL_DUMPING    26647 (Debris / Illegal Dumping)
    //   STREETLIGHT_OUTAGE 26659 (Street Lights)
    name: "Milpitas SeeClickFix (Open311)",
    jurisdiction: "city-milpitas",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "26652",
          ILLEGAL_DUMPING: "26647",
          STREETLIGHT_OUTAGE: "26659",
        },
      },
    },
  },
  {
    // City of Morgan Hill — verified service_codes:
    //   ROAD_DAMAGE        38109 (STREET - Pothole In Street)
    //   ILLEGAL_DUMPING    38127 (STREET - Illegal Dump/Debris)
    //   STREETLIGHT_OUTAGE 38111 (TRAFFIC - Street Light Outage)
    name: "Morgan Hill SeeClickFix (Open311)",
    jurisdiction: "city-morgan-hill",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "38109",
          ILLEGAL_DUMPING: "38127",
          STREETLIGHT_OUTAGE: "38111",
        },
      },
    },
  },
  {
    // City of Gilroy — verified service_codes (org "Maintenance Requests"):
    //   ROAD_DAMAGE        57749 (Streets)
    //   ILLEGAL_DUMPING    62727 (Garbage - On Public Right-of-Way)
    //   STREETLIGHT_OUTAGE 57748 (Streetlights)
    name: "Gilroy SeeClickFix (Open311)",
    jurisdiction: "city-gilroy",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "57749",
          ILLEGAL_DUMPING: "62727",
          STREETLIGHT_OUTAGE: "57748",
        },
      },
    },
  },
  {
    // City of Watsonville (org "Watsonville, CA") — verified service_codes:
    //   ROAD_DAMAGE        50064 (Pothole)
    //   ILLEGAL_DUMPING    53301 (Illegal Dumping)
    //   STREETLIGHT_OUTAGE 50067 (Street Light)
    name: "Watsonville SeeClickFix (Open311)",
    jurisdiction: "city-watsonville",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "50064",
          ILLEGAL_DUMPING: "53301",
          STREETLIGHT_OUTAGE: "50067",
        },
      },
    },
  },
  {
    // City of Vallejo (org "City of Vallejo") — verified service_codes:
    //   ROAD_DAMAGE        3376 (Pothole)
    //   ILLEGAL_DUMPING    3613 (Illegal Dumping (on public property only))
    //   STREETLIGHT_OUTAGE 3378 (Street Light)
    name: "Vallejo SeeClickFix (Open311)",
    jurisdiction: "city-vallejo",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "3376",
          ILLEGAL_DUMPING: "3613",
          STREETLIGHT_OUTAGE: "3378",
        },
      },
    },
  },
  {
    // City of San Leandro (org "San Leandro, CA") — verified service_codes:
    //   ROAD_DAMAGE        53596 (Roads)
    //   ILLEGAL_DUMPING    53329 (Illegal Dumping – Public Right of Way)
    //   STREETLIGHT_OUTAGE 53607 (Street lights)
    name: "San Leandro SeeClickFix (Open311)",
    jurisdiction: "city-san-leandro",
    issueTypes: ["ROAD_DAMAGE", "ILLEGAL_DUMPING", "STREETLIGHT_OUTAGE"],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        serviceCodes: {
          ROAD_DAMAGE: "53596",
          ILLEGAL_DUMPING: "53329",
          STREETLIGHT_OUTAGE: "53607",
        },
      },
    },
  },
];
