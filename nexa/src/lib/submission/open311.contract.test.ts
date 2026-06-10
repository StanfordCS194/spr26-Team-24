import { describe, expect, it } from "vitest";

import { IssueType } from "@/generated/prisma/enums";

import {
  buildRequestParams,
  parseOpen311Config,
  resolveServiceCode,
  type SubmittableReport,
} from "./open311";

// ───────────────────────────────────────────────────────────────────────────
// OPT-IN Open311 contract test (issue #253)
//
// Every other submission test stubs `fetch`, so the real Open311 request shape
// is never checked against a live API. This test closes that gap by hitting the
// SeeClickFix Open311 *read* endpoints and asserting that:
//   1. the live service catalog is returned in the documented shape,
//   2. the verified Menlo Park service codes (94213 / 94210, seeded in
//      prisma/agencies.ts) still exist, and
//   3. the params `buildRequestParams` produces (service_code, location,
//      description) still match the GeoReport v2 fields a live service
//      definition expects.
//
// It is GATED behind RUN_OPEN311_CONTRACT and SKIPPED by default, so normal
// `npm test` / CI / fork PRs stay green offline and NO network call is made
// (`it.skipIf` does not invoke the body). It performs READ requests only and
// never POSTs a report.
//
// Run it explicitly against the live API with:
//   RUN_OPEN311_CONTRACT=1 npm test -- open311.contract
// ───────────────────────────────────────────────────────────────────────────

const RUN_CONTRACT = process.env.RUN_OPEN311_CONTRACT === "1";

// SeeClickFix hosts a public sandbox (`int.`) and the production API. The
// catalog + service-definition *shape* is exercised against the sandbox so an
// opt-in run never touches production data. The verified Menlo Park codes
// 94213/94210 live on the production org (the sandbox serves a different test
// catalog — confirmed 2026-06-10), so their existence is cross-checked against
// production, which is the source of truth those seed values were verified from
// (prisma/agencies.ts, issue #98/#239).
const SANDBOX_BASE = "https://int.seeclickfix.com/open311/v2";
const PRODUCTION_BASE = "https://seeclickfix.com/open311/v2";

// Menlo Park centroid — the same lat/long the seed provenance was verified with.
const MENLO_PARK_LAT = 37.453;
const MENLO_PARK_LONG = -122.1817;

// The verified Menlo Park service codes seeded in prisma/agencies.ts.
const VERIFIED_SERVICE_CODES = ["94213", "94210"] as const;

const CONTRACT_TIMEOUT_MS = 30_000;

/** One entry of an Open311 GeoReport v2 `services.json` response. */
type Open311Service = {
  service_code: number | string;
  service_name: string;
  metadata: boolean;
  type: string;
};

// An Open311 GeoReport v2 service definition (`services/{code}.json`). The
// SeeClickFix endpoint returns a bare object (the GeoReport spec also permits a
// single-element array), so the assertion below normalizes both forms.
type Open311ServiceDefinition = {
  service_code: number | string;
  attributes: Array<{ code: string | number; datatype: string }>;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  expect(res.ok, `GET ${url} returned HTTP ${res.status}`).toBe(true);
  return res.json();
}

function makeSubmittable(
  overrides: Partial<SubmittableReport> = {},
): SubmittableReport {
  return {
    issueType: IssueType.ROAD_DAMAGE,
    description: "Contract test: large pothole on the roadway",
    aiDescription: null,
    latitude: MENLO_PARK_LAT,
    longitude: MENLO_PARK_LONG,
    address: "Menlo Park, CA",
    ...overrides,
  };
}

describe("Open311 live sandbox contract (opt-in)", () => {
  it.skipIf(!RUN_CONTRACT)(
    "returns a service catalog of the documented shape from the live sandbox",
    async () => {
      // Act: read the live sandbox catalog for the Menlo Park area.
      const body = await getJson(
        `${SANDBOX_BASE}/services.json?lat=${MENLO_PARK_LAT}&long=${MENLO_PARK_LONG}`,
      );

      // Assert: a non-empty array of services, each carrying the fields the
      // client relies on to map an IssueType onto a service_code.
      expect(Array.isArray(body)).toBe(true);
      const services = body as Open311Service[];
      expect(services.length).toBeGreaterThan(0);
      for (const service of services) {
        expect(["number", "string"]).toContain(typeof service.service_code);
        expect(typeof service.service_name).toBe("string");
        expect(typeof service.metadata).toBe("boolean");
      }
    },
    CONTRACT_TIMEOUT_MS,
  );

  it.skipIf(!RUN_CONTRACT)(
    "still serves the verified Menlo Park service codes (94213 / 94210)",
    async () => {
      // Act: read the production catalog, where the seeded Menlo Park org and
      // its verified codes live (the sandbox hosts a separate test catalog).
      const body = await getJson(
        `${PRODUCTION_BASE}/services.json?lat=${MENLO_PARK_LAT}&long=${MENLO_PARK_LONG}`,
      );
      const codes = (body as Open311Service[]).map((s) =>
        String(s.service_code),
      );

      // Assert: both seeded codes are still published by the live API, so the
      // values in prisma/agencies.ts are not stale.
      for (const code of VERIFIED_SERVICE_CODES) {
        expect(
          codes,
          `service_code ${code} missing from live catalog`,
        ).toContain(code);
      }
    },
    CONTRACT_TIMEOUT_MS,
  );

  it.skipIf(!RUN_CONTRACT)(
    "produces a request body whose fields match a live service definition",
    async () => {
      // Arrange: parse the exact seeded `requiredFields.open311` block and
      // resolve the service_code the client would use for a ROAD_DAMAGE report,
      // then build the POST body via the real client (no request is sent).
      const config = parseOpen311Config({
        open311: {
          endpoint: PRODUCTION_BASE,
          serviceCodes: {
            ROAD_DAMAGE: "94213",
            ILLEGAL_DUMPING: "94210",
          },
        },
      });
      const serviceCode = resolveServiceCode(IssueType.ROAD_DAMAGE, config);
      expect(serviceCode).toBe("94213");

      const params = buildRequestParams(
        makeSubmittable(),
        serviceCode as string,
        config,
      );

      // Act: read the live service definition for that code. Its shape is the
      // contract the submission path is built against.
      const raw = await getJson(
        `${PRODUCTION_BASE}/services/${serviceCode}.json?lat=${MENLO_PARK_LAT}&long=${MENLO_PARK_LONG}`,
      );
      const definition = (
        Array.isArray(raw) ? raw[0] : raw
      ) as Open311ServiceDefinition;

      // Assert: the service definition is returned for the SAME code we send,
      // with the documented `attributes` array.
      expect(String(definition.service_code)).toBe(serviceCode);
      expect(Array.isArray(definition.attributes)).toBe(true);

      // Assert: the GeoReport v2 POST fields the client sends — service_code,
      // location (lat/long), and description — are all present and well-formed.
      // These are the standard request fields every Open311 service definition
      // expects; the per-jurisdiction `attributes` above are optional extras.
      expect(params.get("service_code")).toBe(serviceCode);
      expect(params.get("lat")).toBe(String(MENLO_PARK_LAT));
      expect(params.get("long")).toBe(String(MENLO_PARK_LONG));
      expect(params.get("description")?.length).toBeGreaterThan(0);
    },
    CONTRACT_TIMEOUT_MS,
  );
});
