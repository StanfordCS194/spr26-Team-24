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
    | "GRAFFITI"
    | "SIDEWALK_DAMAGE"
    | "TREE_MAINTENANCE"
    | "TRAFFIC_SIGNAL"
    | "PUBLIC_SIGNAGE"
    | "FLOODING_DRAINAGE"
    | "WATER_SYSTEM"
    | "PARKS_PLAYGROUNDS"
    | "WEED_ABATEMENT"
    | "ABANDONED_VEHICLE"
    | "PARKING"
    | "CODE_ENFORCEMENT"
    | "STREET_SWEEPING"
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
    // Palo Alto 311 is the city's UNIFIED report-an-issue portal, so it is the
    // general-civic intake for the new taxonomy types as well (#264). It has no
    // machine API, so no service codes — the report routes to the portal for a
    // human to file. ABANDONED_VEHICLE is left to police/parking enforcement,
    // and emissions stays with CARB.
    issueTypes: [
      "ROAD_DAMAGE",
      "STREETLIGHT_OUTAGE",
      "ILLEGAL_DUMPING",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "PARKING",
      "CODE_ENFORCEMENT",
      "STREET_SWEEPING",
    ],
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
    // ACT Menlo Park is the city's general Report-a-Concern web desk, so it is
    // also a general-civic intake for the new taxonomy types (#264) — a
    // WEB_FORM sibling to the Menlo Park SeeClickFix API row. No service codes
    // (web form only). ABANDONED_VEHICLE / emissions handled elsewhere.
    issueTypes: [
      "ROAD_DAMAGE",
      "STREETLIGHT_OUTAGE",
      "ILLEGAL_DUMPING",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "PARKING",
      "CODE_ENFORCEMENT",
      "STREET_SWEEPING",
    ],
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
    // CAVEAT (issue #239, VERIFIED 2026-06-10): the `jurisdiction_id` token
    // SeeClickFix's Open311 write path keys on is an internal ORGANIZATION id,
    // NOT the public `/api/v2/places` numeric id. We confirmed this live: the
    // researched place id 76196 (Menlo Park, place_type "City", confirmed via
    //   GET https://seeclickfix.com/api/v2/places?lat=37.4530&lng=-122.1817 )
    // returns `404 "Invalid Jurisdiction ID"` from
    //   GET https://seeclickfix.com/open311/v2/services.json?jurisdiction_id=76196
    // — identical to a bogus id — and the slug / org-name forms 404 the same way.
    // (services.json?lat&long DOES return Menlo Park's catalog, which is how the
    // service_codes above were verified, but lat/long is not a POST jurisdiction
    // key.) The real organization id is not obtainable through the public no-auth
    // API, so per issue #239 we do NOT invent one: jurisdictionId stays unset and
    // a real POST gracefully degrades to manual-assist (orchestrate rolls
    // SUBMITTING->CONFIRMED on the resulting 404 — no report is ever lost). The
    // submission client already sends jurisdiction_id + api_key WHEN configured
    // (src/lib/submission/open311.ts buildRequestParams), so flipping this agency
    // to fully-verified is a one-line seed edit once SeeClickFix support supplies
    // the organization id and one sandbox POST confirms it.
    //
    // The `open311` block below matches the shape consumed by
    // parseOpen311Config()/Open311Config in src/lib/submission/open311.ts:
    // { endpoint, serviceCodes: Partial<Record<IssueType, string>> }. The base
    // endpoint is also mirrored in `intakeUrl` (the client falls back to it).
    name: "Menlo Park SeeClickFix (Open311)",
    jurisdiction: "city-menlo-park",
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WATER_SYSTEM",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "PARKING",
      "CODE_ENFORCEMENT",
      "STREET_SWEEPING",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        // Sandbox endpoint for safe testing (not consumed by the client yet;
        // kept here as verified provenance per the #98 caveat).
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // Service codes verified live against the Menlo Park SeeClickFix
        // catalog (taxonomy routing expansion, #264). The 13 new-taxonomy
        // codes below sit alongside the pre-existing ROAD_DAMAGE/
        // ILLEGAL_DUMPING codes; ABANDONED_VEHICLE has no Menlo Park service.
        serviceCodes: {
          ROAD_DAMAGE: "94213",
          ILLEGAL_DUMPING: "94210",
          GRAFFITI: "22023",
          SIDEWALK_DAMAGE: "94215",
          TREE_MAINTENANCE: "94218",
          TRAFFIC_SIGNAL: "32517",
          PUBLIC_SIGNAGE: "94214",
          FLOODING_DRAINAGE: "30942",
          WATER_SYSTEM: "94219",
          PARKS_PLAYGROUNDS: "94212",
          WEED_ABATEMENT: "94220",
          PARKING: "94209",
          CODE_ENFORCEMENT: "100710",
          STREET_SWEEPING: "22033",
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
    // EPA Public Works is the city's general infrastructure/maintenance desk,
    // so it is the general-civic intake for the new taxonomy types (#264) via
    // the same city contact web form (no machine API, so no service codes).
    // Illegal dumping stays with the dedicated EPA Clean City row.
    issueTypes: [
      "ROAD_DAMAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "PARKING",
      "CODE_ENFORCEMENT",
      "STREET_SWEEPING",
    ],
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
    // Mountain View Public Works handles general civic service requests, so it
    // is the general-civic intake for the new taxonomy types (#264) via its web
    // form (no machine API, so no service codes).
    issueTypes: [
      "ROAD_DAMAGE",
      "STREETLIGHT_OUTAGE",
      "ILLEGAL_DUMPING",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "PARKING",
      "CODE_ENFORCEMENT",
      "STREET_SWEEPING",
    ],
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
    // SCC Public Works handles roads & infrastructure in unincorporated areas,
    // so we widen it to the road-maintenance-adjacent new taxonomy types it
    // plausibly handles (#264) — sidewalk, roadside trees, traffic signals,
    // signage, drainage/flooding, roadside weed abatement, street sweeping. We
    // do NOT add parks/parking/code-enforcement, which the county runs through
    // separate departments. No machine API, so no service codes.
    issueTypes: [
      "ROAD_DAMAGE",
      "STREETLIGHT_OUTAGE",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WEED_ABATEMENT",
      "STREET_SWEEPING",
    ],
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
  // CAVEAT (same as the Menlo Park row — issue #239, VERIFIED 2026-06-10): we
  // omit jurisdictionId on every row below for the SAME confirmed reason. The
  // SeeClickFix Open311 write path keys on an internal ORGANIZATION id, not the
  // public `/api/v2/places` numeric id. We resolved each city's nearest "City"
  // place via the live places API (Milpitas 1824, Morgan Hill 1826, Gilroy 1820,
  // Watsonville 1632, Vallejo 1975, San Leandro 1696), but feeding any of those
  // numeric ids to GET /open311/v2/services.json?jurisdiction_id=<id> returns
  // `404 "Invalid Jurisdiction ID"` — so they are NOT valid POST jurisdiction_id
  // tokens. The real organization ids are not obtainable through the public
  // no-auth API, so per issue #239 we do NOT invent them: jurisdictionId stays
  // unset and a real POST degrades to manual-assist (orchestrate rolls back on
  // the 404 — no report lost). The client already sends jurisdiction_id WHEN
  // configured, so each city flips to fully-verified by adding its organization
  // id here once SeeClickFix support supplies it and one sandbox POST confirms.
  //
  // Several of these services also declare service-specific `required`
  // attributes (e.g. Milpitas pothole "direction", streetlight "pole number");
  // those are NOT modelled here (the existing Open311Config shape carries only
  // serviceCodes), so confirm against the SeeClickFix sandbox before relying on
  // the production write path.
  {
    // City of Milpitas — verified service_codes:
    //   ROAD_DAMAGE        26652 (Pothole/Roadway Repairs)
    //   ILLEGAL_DUMPING    26647 (Debris / Illegal Dumping)
    //   STREETLIGHT_OUTAGE 26659 (Street Lights)
    name: "Milpitas SeeClickFix (Open311)",
    jurisdiction: "city-milpitas",
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WATER_SYSTEM",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "ABANDONED_VEHICLE",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the Milpitas catalog (#264).
        // Milpitas has no GRAFFITI / PARKING / CODE_ENFORCEMENT /
        // STREET_SWEEPING service, so those are omitted.
        serviceCodes: {
          ROAD_DAMAGE: "26652",
          ILLEGAL_DUMPING: "26647",
          STREETLIGHT_OUTAGE: "26659",
          SIDEWALK_DAMAGE: "26656",
          TREE_MAINTENANCE: "26641",
          TRAFFIC_SIGNAL: "26661",
          PUBLIC_SIGNAGE: "26657",
          FLOODING_DRAINAGE: "26645",
          WATER_SYSTEM: "26664",
          PARKS_PLAYGROUNDS: "26651",
          WEED_ABATEMENT: "26668",
          ABANDONED_VEHICLE: "26639",
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
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WATER_SYSTEM",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "STREET_SWEEPING",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the Morgan Hill catalog
        // (#264). Morgan Hill has no ABANDONED_VEHICLE / PARKING /
        // CODE_ENFORCEMENT service, so those are omitted.
        serviceCodes: {
          ROAD_DAMAGE: "38109",
          ILLEGAL_DUMPING: "38127",
          STREETLIGHT_OUTAGE: "38111",
          GRAFFITI: "38354",
          SIDEWALK_DAMAGE: "38172",
          TREE_MAINTENANCE: "38120",
          TRAFFIC_SIGNAL: "38112",
          PUBLIC_SIGNAGE: "38093",
          FLOODING_DRAINAGE: "38126",
          WATER_SYSTEM: "47772",
          PARKS_PLAYGROUNDS: "38113",
          WEED_ABATEMENT: "47016",
          STREET_SWEEPING: "44358",
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
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WATER_SYSTEM",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "ABANDONED_VEHICLE",
      "PARKING",
      "CODE_ENFORCEMENT",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the Gilroy catalog (#264).
        // Gilroy has no STREET_SWEEPING service, so it is omitted.
        serviceCodes: {
          ROAD_DAMAGE: "57749",
          ILLEGAL_DUMPING: "62727",
          STREETLIGHT_OUTAGE: "57748",
          GRAFFITI: "64938",
          SIDEWALK_DAMAGE: "78303",
          TREE_MAINTENANCE: "82132",
          TRAFFIC_SIGNAL: "57751",
          PUBLIC_SIGNAGE: "65004",
          FLOODING_DRAINAGE: "57718",
          WATER_SYSTEM: "57758",
          PARKS_PLAYGROUNDS: "71573",
          WEED_ABATEMENT: "65071",
          ABANDONED_VEHICLE: "64741",
          PARKING: "64773",
          CODE_ENFORCEMENT: "65500",
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
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the Watsonville catalog
        // (#264). Watsonville's SeeClickFix catalog only exposes graffiti and
        // sidewalk among the new types; all other new types are omitted.
        serviceCodes: {
          ROAD_DAMAGE: "50064",
          ILLEGAL_DUMPING: "53301",
          STREETLIGHT_OUTAGE: "50067",
          GRAFFITI: "50060",
          SIDEWALK_DAMAGE: "50066",
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
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "WATER_SYSTEM",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "ABANDONED_VEHICLE",
      "PARKING",
      "CODE_ENFORCEMENT",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the Vallejo catalog (#264).
        // Vallejo has no STREET_SWEEPING service, so it is omitted. TREE_-
        // MAINTENANCE and WEED_ABATEMENT both map to Vallejo service 3729
        // (its single landscaping/vegetation request type) — verified, not a
        // typo.
        serviceCodes: {
          ROAD_DAMAGE: "3376",
          ILLEGAL_DUMPING: "3613",
          STREETLIGHT_OUTAGE: "3378",
          GRAFFITI: "3377",
          SIDEWALK_DAMAGE: "3615",
          TREE_MAINTENANCE: "3729",
          TRAFFIC_SIGNAL: "3606",
          PUBLIC_SIGNAGE: "3614",
          FLOODING_DRAINAGE: "16034",
          WATER_SYSTEM: "3743",
          PARKS_PLAYGROUNDS: "4595",
          WEED_ABATEMENT: "3729",
          ABANDONED_VEHICLE: "4064",
          PARKING: "3731",
          CODE_ENFORCEMENT: "4718",
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
    issueTypes: [
      "ROAD_DAMAGE",
      "ILLEGAL_DUMPING",
      "STREETLIGHT_OUTAGE",
      "GRAFFITI",
      "SIDEWALK_DAMAGE",
      "TREE_MAINTENANCE",
      "TRAFFIC_SIGNAL",
      "PUBLIC_SIGNAGE",
      "FLOODING_DRAINAGE",
      "PARKS_PLAYGROUNDS",
      "WEED_ABATEMENT",
      "ABANDONED_VEHICLE",
      "PARKING",
      "CODE_ENFORCEMENT",
    ],
    intakeMethod: "API",
    intakeUrl: "https://seeclickfix.com/open311/v2",
    intakeEmail: null,
    requiredFields: {
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        sandboxEndpoint: "https://int.seeclickfix.com/open311/v2",
        // New-taxonomy codes verified live against the San Leandro catalog
        // (#264). San Leandro has no WATER_SYSTEM / STREET_SWEEPING service,
        // so those are omitted.
        serviceCodes: {
          ROAD_DAMAGE: "53596",
          ILLEGAL_DUMPING: "53329",
          STREETLIGHT_OUTAGE: "53607",
          GRAFFITI: "53328",
          SIDEWALK_DAMAGE: "53602",
          TREE_MAINTENANCE: "53558",
          TRAFFIC_SIGNAL: "55102",
          PUBLIC_SIGNAGE: "53608",
          FLOODING_DRAINAGE: "53606",
          PARKS_PLAYGROUNDS: "53591",
          WEED_ABATEMENT: "20960",
          ABANDONED_VEHICLE: "23975",
          PARKING: "21267",
          CODE_ENFORCEMENT: "28488",
        },
      },
    },
  },
];
