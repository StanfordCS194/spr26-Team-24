import { describe, expect, it, vi } from "vitest";

import { IssueType, ReportStatus } from "@/generated/prisma/enums";
import { open311Config, open311Responses } from "@/test/fixtures/open311";
import { TimeoutError } from "@/lib/http";

import {
  buildRequestParams,
  canAutoFileOpen311,
  fetchOpen311Status,
  mapOpen311Status,
  parseOpen311Config,
  resolveServiceCode,
  STATUS_RANK,
  submitToOpen311,
  type Open311Config,
  type SubmittableReport,
} from "./open311";

// A report with every field present; tests override only what they exercise.
function makeSubmittable(
  overrides: Partial<SubmittableReport> = {},
): SubmittableReport {
  return {
    issueType: IssueType.ROAD_DAMAGE,
    description: "Big pothole on Main St",
    aiDescription: "AI: large pothole",
    latitude: 37.44,
    longitude: -122.14,
    address: "123 Main St",
    ...overrides,
  };
}

describe("resolveServiceCode", () => {
  it("returns the built-in default code for a known issue type", () => {
    // Arrange / Act
    const code = resolveServiceCode(IssueType.ROAD_DAMAGE, undefined);

    // Assert
    expect(code).toBe("POTHOLES");
  });

  it("prefers the agency config override over the default", () => {
    // Arrange
    const config: Open311Config = {
      serviceCodes: { [IssueType.ROAD_DAMAGE]: "CITY-POTHOLE-001" },
    };

    // Act
    const code = resolveServiceCode(IssueType.ROAD_DAMAGE, config);

    // Assert
    expect(code).toBe("CITY-POTHOLE-001");
  });

  it("falls back to the default when the config has no override for the type", () => {
    // Arrange: override exists for a different issue type only.
    const config: Open311Config = {
      serviceCodes: { [IssueType.OTHER]: "MISC" },
    };

    // Act
    const code = resolveServiceCode(IssueType.STREETLIGHT_OUTAGE, config);

    // Assert
    expect(code).toBe("STREETLIGHTS");
  });

  it("returns null for a null issue type", () => {
    // Arrange / Act
    const code = resolveServiceCode(null, open311Config);

    // Assert
    expect(code).toBeNull();
  });

  it("returns null for an undefined issue type", () => {
    // Arrange / Act
    const code = resolveServiceCode(undefined, undefined);

    // Assert
    expect(code).toBeNull();
  });
});

describe("buildRequestParams", () => {
  it("always sets the service_code param", () => {
    // Arrange / Act
    const params = buildRequestParams(makeSubmittable(), "POTHOLES", undefined);

    // Assert
    expect(params.get("service_code")).toBe("POTHOLES");
  });

  it("prefers the citizen description over the AI description", () => {
    // Arrange
    const report = makeSubmittable({
      description: "  citizen words  ",
      aiDescription: "ai summary",
    });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert: trimmed citizen text wins.
    expect(params.get("description")).toBe("citizen words");
  });

  it("falls back to the AI description when the citizen description is blank", () => {
    // Arrange
    const report = makeSubmittable({
      description: "   ",
      aiDescription: "  ai summary  ",
    });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.get("description")).toBe("ai summary");
  });

  it("omits description when both citizen and AI text are empty", () => {
    // Arrange
    const report = makeSubmittable({ description: null, aiDescription: null });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.has("description")).toBe(false);
  });

  it("sets lat and long when both coordinates are finite numbers", () => {
    // Arrange
    const report = makeSubmittable({ latitude: 37.44, longitude: -122.14 });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.get("lat")).toBe("37.44");
    expect(params.get("long")).toBe("-122.14");
  });

  it("omits lat/long when only one coordinate is present", () => {
    // Arrange: latitude present, longitude missing.
    const report = makeSubmittable({ latitude: 37.44, longitude: null });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.has("lat")).toBe(false);
    expect(params.has("long")).toBe(false);
  });

  it("sets a trimmed address_string when an address is present", () => {
    // Arrange
    const report = makeSubmittable({ address: "  123 Main St  " });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.get("address_string")).toBe("123 Main St");
  });

  it("omits address_string when the address is whitespace only", () => {
    // Arrange
    const report = makeSubmittable({ address: "   " });

    // Act
    const params = buildRequestParams(report, "POTHOLES", undefined);

    // Assert
    expect(params.has("address_string")).toBe(false);
  });

  it("includes api_key and jurisdiction_id from the config", () => {
    // Arrange
    const config: Open311Config = {
      apiKey: "secret-key",
      jurisdictionId: "city-palo-alto",
    };

    // Act
    const params = buildRequestParams(makeSubmittable(), "POTHOLES", config);

    // Assert
    expect(params.get("api_key")).toBe("secret-key");
    expect(params.get("jurisdiction_id")).toBe("city-palo-alto");
  });

  it("omits api_key and jurisdiction_id when the config is undefined", () => {
    // Arrange / Act
    const params = buildRequestParams(makeSubmittable(), "POTHOLES", undefined);

    // Assert
    expect(params.has("api_key")).toBe(false);
    expect(params.has("jurisdiction_id")).toBe(false);
  });

  it("carries a seeded jurisdiction_id/api_key end-to-end so a SeeClickFix POST is accepted (#239)", () => {
    // Arrange: parse the exact `requiredFields.open311` shape an API agency is
    // seeded with (see prisma/agencies.ts). SeeClickFix keys submissions on
    // jurisdiction_id — a POST without it 404s ("Invalid Jurisdiction ID") — so
    // the seeded value must survive parse and land in the POST body verbatim.
    const config = parseOpen311Config({
      open311: {
        endpoint: "https://seeclickfix.com/open311/v2",
        apiKey: "scf-key",
        jurisdictionId: "76196",
        serviceCodes: { ROAD_DAMAGE: "94213" },
      },
    });

    // Act
    const serviceCode = resolveServiceCode(IssueType.ROAD_DAMAGE, config);
    const params = buildRequestParams(
      makeSubmittable({ issueType: IssueType.ROAD_DAMAGE }),
      serviceCode as string,
      config,
    );

    // Assert: the parsed jurisdiction_id (+ api_key) reach the form body.
    expect(serviceCode).toBe("94213");
    expect(params.get("jurisdiction_id")).toBe("76196");
    expect(params.get("api_key")).toBe("scf-key");
  });

  it("serializes to an x-www-form-urlencoded string", () => {
    // Arrange
    const report = makeSubmittable({
      description: "a b",
      latitude: null,
      longitude: null,
      address: null,
    });

    // Act
    const serialized = buildRequestParams(
      report,
      "POTHOLES",
      undefined,
    ).toString();

    // Assert: URLSearchParams percent-encodes the space.
    expect(serialized).toBe("service_code=POTHOLES&description=a+b");
  });
});

describe("parseOpen311Config", () => {
  it("returns undefined when requiredFields is not an object", () => {
    // Arrange / Act / Assert
    expect(parseOpen311Config(null)).toBeUndefined();
    expect(parseOpen311Config("nope")).toBeUndefined();
    expect(parseOpen311Config(42)).toBeUndefined();
  });

  it("returns undefined when the open311 block is missing or not an object", () => {
    // Arrange / Act / Assert
    expect(parseOpen311Config({})).toBeUndefined();
    expect(parseOpen311Config({ open311: "x" })).toBeUndefined();
    expect(parseOpen311Config({ open311: null })).toBeUndefined();
  });

  it("extracts endpoint, apiKey and jurisdictionId string fields", () => {
    // Arrange
    const requiredFields = {
      open311: {
        endpoint: "https://example.test/v2",
        apiKey: "key-1",
        jurisdictionId: "city-palo-alto",
      },
    };

    // Act
    const config = parseOpen311Config(requiredFields);

    // Assert
    expect(config).toEqual({
      endpoint: "https://example.test/v2",
      apiKey: "key-1",
      jurisdictionId: "city-palo-alto",
    });
  });

  it("ignores non-string scalar fields (bad requiredFields types)", () => {
    // Arrange: numeric/boolean values for fields that must be strings.
    const requiredFields = {
      open311: { endpoint: 123, apiKey: true, jurisdictionId: {} },
    };

    // Act
    const config = parseOpen311Config(requiredFields);

    // Assert: nothing extracted, but a config object is still returned.
    expect(config).toEqual({});
  });

  it("keeps only valid IssueType/string pairs in serviceCodes", () => {
    // Arrange
    const requiredFields = {
      open311: {
        serviceCodes: {
          ROAD_DAMAGE: "POTHOLES",
          NOT_A_TYPE: "IGNORED",
          OTHER: 999,
        },
      },
    };

    // Act
    const config = parseOpen311Config(requiredFields);

    // Assert: unknown key and non-string value are dropped.
    expect(config?.serviceCodes).toEqual({ ROAD_DAMAGE: "POTHOLES" });
  });

  it("leaves serviceCodes undefined when it is not an object", () => {
    // Arrange
    const requiredFields = { open311: { serviceCodes: "nope" } };

    // Act
    const config = parseOpen311Config(requiredFields);

    // Assert
    expect(config?.serviceCodes).toBeUndefined();
  });
});

describe("canAutoFileOpen311", () => {
  it("is false for a multi-tenant SeeClickFix endpoint without a jurisdictionId", () => {
    // The seeded SeeClickFix agencies omit jurisdictionId (issue #239), so a
    // POST would 404 — they cannot auto-file.
    expect(
      canAutoFileOpen311(
        { endpoint: "https://seeclickfix.com/open311/v2" },
        "https://seeclickfix.com/open311/v2",
      ),
    ).toBe(false);
  });

  it("falls back to the agency intakeUrl to detect the SeeClickFix host", () => {
    // No config endpoint, but the agency intakeUrl is the multi-tenant host.
    expect(
      canAutoFileOpen311(undefined, "https://seeclickfix.com/open311/v2"),
    ).toBe(false);
    // Trailing slash still resolves to the same host.
    expect(
      canAutoFileOpen311(undefined, "https://int.seeclickfix.com/open311/v2/"),
    ).toBe(false);
  });

  it("is true for a SeeClickFix endpoint that has been given a jurisdictionId", () => {
    expect(
      canAutoFileOpen311(
        {
          endpoint: "https://seeclickfix.com/open311/v2",
          jurisdictionId: "org-12345",
        },
        "https://seeclickfix.com/open311/v2",
      ),
    ).toBe(true);
  });

  it("is true for a single-tenant endpoint without a jurisdictionId", () => {
    // A city's own GeoReport server doesn't multiplex jurisdictions, so it can
    // auto-file without a jurisdiction_id.
    expect(
      canAutoFileOpen311(
        { endpoint: "https://sandbox.open311.org/v2" },
        "https://sandbox.open311.org/v2",
      ),
    ).toBe(true);
  });

  it("is false when no endpoint resolves at all", () => {
    expect(canAutoFileOpen311(undefined, null)).toBe(false);
    expect(canAutoFileOpen311({}, undefined)).toBe(false);
  });
});

describe("mapOpen311Status", () => {
  it("maps open to ACKNOWLEDGED", () => {
    expect(mapOpen311Status("open")).toBe(ReportStatus.ACKNOWLEDGED);
  });

  it("maps closed to RESOLVED", () => {
    expect(mapOpen311Status("closed")).toBe(ReportStatus.RESOLVED);
  });

  it("maps acknowledged and received to ACKNOWLEDGED", () => {
    expect(mapOpen311Status("acknowledged")).toBe(ReportStatus.ACKNOWLEDGED);
    expect(mapOpen311Status("received")).toBe(ReportStatus.ACKNOWLEDGED);
  });

  it("maps in_progress / in progress / started to IN_PROGRESS", () => {
    expect(mapOpen311Status("in_progress")).toBe(ReportStatus.IN_PROGRESS);
    expect(mapOpen311Status("in progress")).toBe(ReportStatus.IN_PROGRESS);
    expect(mapOpen311Status("started")).toBe(ReportStatus.IN_PROGRESS);
  });

  it("maps resolved (a SeeClickFix synonym for closed) to RESOLVED", () => {
    expect(mapOpen311Status("resolved")).toBe(ReportStatus.RESOLVED);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    // Arrange / Act / Assert
    expect(mapOpen311Status("  OPEN  ")).toBe(ReportStatus.ACKNOWLEDGED);
    expect(mapOpen311Status("Closed")).toBe(ReportStatus.RESOLVED);
    expect(mapOpen311Status("  In_Progress ")).toBe(ReportStatus.IN_PROGRESS);
    expect(mapOpen311Status("ACKNOWLEDGED")).toBe(ReportStatus.ACKNOWLEDGED);
  });

  it("returns the new mappings in monotonically non-decreasing rank order", () => {
    // The poller only applies a mapped status through the STATUS_RANK /
    // isForwardTransition guard; these mappings must sit in the right order so a
    // later vendor state never ranks below an earlier one.
    expect(STATUS_RANK[mapOpen311Status("acknowledged")!]).toBeLessThan(
      STATUS_RANK[mapOpen311Status("in_progress")!],
    );
    expect(STATUS_RANK[mapOpen311Status("in_progress")!]).toBeLessThan(
      STATUS_RANK[mapOpen311Status("resolved")!],
    );
  });

  it("returns null for an unrecognized status", () => {
    expect(mapOpen311Status("pending")).toBeNull();
  });
});

describe("STATUS_RANK", () => {
  it("strictly increases along the report lifecycle so status only advances", () => {
    // Arrange: the lifecycle order the cron poller relies on.
    const lifecycle: ReportStatus[] = [
      ReportStatus.DRAFT,
      ReportStatus.CLASSIFYING,
      ReportStatus.CONFIRMED,
      ReportStatus.SUBMITTING,
      ReportStatus.SUBMITTED,
      ReportStatus.ACKNOWLEDGED,
      ReportStatus.IN_PROGRESS,
      ReportStatus.RESOLVED,
      ReportStatus.CLOSED,
    ];

    // Act / Assert: each step ranks strictly above the previous one.
    for (let i = 1; i < lifecycle.length; i++) {
      expect(STATUS_RANK[lifecycle[i]]).toBeGreaterThan(
        STATUS_RANK[lifecycle[i - 1]],
      );
    }
  });

  it("ranks the poller-relevant states SUBMITTED < ACKNOWLEDGED < IN_PROGRESS < RESOLVED", () => {
    // Assert
    expect(STATUS_RANK[ReportStatus.SUBMITTED]).toBeLessThan(
      STATUS_RANK[ReportStatus.ACKNOWLEDGED],
    );
    expect(STATUS_RANK[ReportStatus.ACKNOWLEDGED]).toBeLessThan(
      STATUS_RANK[ReportStatus.IN_PROGRESS],
    );
    expect(STATUS_RANK[ReportStatus.IN_PROGRESS]).toBeLessThan(
      STATUS_RANK[ReportStatus.RESOLVED],
    );
  });

  it("assigns a unique rank to every ReportStatus", () => {
    // Arrange
    const ranks = Object.values(STATUS_RANK);

    // Assert: no two states share a rank.
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

// ---------------------------------------------------------------------------
// Network functions — exercised with an injected `fetchImpl` so there is no
// real network. These cover the resilience/idempotency contract from #102/#164:
// a POST must not be retried after a timeout (could file a duplicate ticket) but
// IS retried once when the connection never reached the server; a status GET
// retries transient 5xx and surfaces the failure after exhaustion.
// ---------------------------------------------------------------------------

const NETWORK_REPORT: SubmittableReport = {
  issueType: IssueType.ROAD_DAMAGE,
  description: "Big pothole on Main St",
  aiDescription: null,
  latitude: 37.44,
  longitude: -122.14,
  address: "123 Main St",
};

/** A JSON Response stub, as the global `fetch` would return. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A Node/undici-style connection error carrying a retryable `code`. */
function connectionError(code: string): Error {
  return Object.assign(new Error(`connect ${code}`), { code });
}

describe("submitToOpen311 (network)", () => {
  it("returns an error when no endpoint is configured", async () => {
    // Arrange
    const fetchImpl = vi.fn();

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: {},
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert: it never even attempts a request.
    expect(result).toEqual({
      status: "error",
      httpStatus: null,
      message: "No Open311 endpoint configured for this agency.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an error when no service code maps to the issue type", async () => {
    // Arrange
    const fetchImpl = vi.fn();

    // Act
    const result = await submitToOpen311(
      { ...NETWORK_REPORT, issueType: null },
      {
        config: open311Config,
        intakeUrl: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    // Assert
    expect(result.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs form-urlencoded to /requests.json and returns the service_request_id", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(open311Responses.createSuccess));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert: result shape + the exact request the agent made.
    expect(result).toEqual({
      status: "submitted",
      serviceRequestId: "REQ-12345",
      token: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sandbox.open311.org/v2/requests.json");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(init.body).toContain("service_code=POTHOLES");
  });

  it("returns the token for a token-based async acknowledgement", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(open311Responses.createWithToken));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "submitted",
      serviceRequestId: null,
      token: "tok_abc123",
    });
  });

  it("reads the GeoReport error description on a non-2xx response", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ code: 400, description: "Bad service_code." }], 400),
      );

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "error",
      httpStatus: 400,
      message: "Bad service_code.",
    });
  });

  it("returns an error with httpStatus null on a network throw", async () => {
    // Arrange
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "error",
      httpStatus: null,
      message: "socket hang up",
    });
  });

  it("returns an error when the success body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toMatchObject({
      status: "error",
      httpStatus: 200,
      message: "Open311 response was not valid JSON.",
    });
  });

  it("returns an error when the response carries neither id nor token", async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{}]));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toMatchObject({
      status: "error",
      httpStatus: 200,
      message: "Open311 response contained no service_request_id or token.",
    });
  });

  it("accepts a bare object response (not wrapped in an array)", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ service_request_id: "OBJ-1" }));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "submitted",
      serviceRequestId: "OBJ-1",
      token: null,
    });
  });

  // --- Idempotency: the gap #164 flagged ----------------------------------

  it("does NOT retry on a TimeoutError — no duplicate POST", async () => {
    // Arrange: a timeout could mean the ticket was already filed, so retrying
    // risks a duplicate. The agent must give up after exactly one attempt.
    const fetchImpl = vi.fn().mockRejectedValue(new TimeoutError(12_000));

    // Act
    const result = await submitToOpen311(NETWORK_REPORT, {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert: exactly one POST, terminal timeout error.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "error",
      httpStatus: null,
      message: "Open311 endpoint timed out.",
    });
  });

  it("retries once on a pre-request connection error (ECONNREFUSED), then succeeds", async () => {
    // Arrange: the connection was refused before any bytes were sent, so the
    // request provably never reached the server — safe to retry exactly once.
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(connectionError("ECONNREFUSED"))
        .mockResolvedValueOnce(jsonResponse(open311Responses.createSuccess));

      // Act: drive the withRetry backoff sleep to completion under fake timers.
      const pending = submitToOpen311(NETWORK_REPORT, {
        config: open311Config,
        intakeUrl: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      // Assert: two attempts (1 fail + 1 success), one ticket filed.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        status: "submitted",
        serviceRequestId: "REQ-12345",
        token: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchOpen311Status (network)", () => {
  it("returns an error when no endpoint is configured", async () => {
    // Arrange
    const fetchImpl = vi.fn();

    // Act
    const result = await fetchOpen311Status("REQ-1", {
      config: {},
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toMatchObject({ status: "error", httpStatus: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs with api_key and jurisdiction_id query params and maps open -> ACKNOWLEDGED", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(open311Responses.statusOpen));

    // Act
    const result = await fetchOpen311Status("REQ-12345", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert: status mapping + the exact request URL/query.
    expect(result).toEqual({
      status: "ok",
      open311Status: "open",
      reportStatus: ReportStatus.ACKNOWLEDGED,
      statusNotes: "Received and queued for inspection.",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(
      "https://sandbox.open311.org/v2/requests/REQ-12345.json",
    );
    expect(url).toContain("api_key=test-api-key");
    expect(url).toContain("jurisdiction_id=city-palo-alto");
    expect(init.method).toBe("GET");
  });

  it("maps closed -> RESOLVED and preserves status_notes", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(open311Responses.statusClosed));

    // Act
    const result = await fetchOpen311Status("REQ-12345", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "ok",
      open311Status: "closed",
      reportStatus: ReportStatus.RESOLVED,
      statusNotes: "Pothole filled.",
    });
  });

  it("maps an unrecognized status to a null reportStatus", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ status: "pending" }]));

    // Act
    const result = await fetchOpen311Status("REQ-1", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toMatchObject({
      status: "ok",
      open311Status: "pending",
      reportStatus: null,
    });
  });

  it("returns not_found on a 404", async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([], 404));

    // Act
    const result = await fetchOpen311Status("missing", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns an error when the body has no status field", async () => {
    // Arrange
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ service_request_id: "REQ-1" }]));

    // Act
    const result = await fetchOpen311Status("REQ-1", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toMatchObject({
      status: "error",
      message: "Open311 response had no status field.",
    });
  });

  it("returns an error on a network throw with httpStatus null", async () => {
    // Arrange: a non-transient throw is not retried, surfaces immediately.
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const result = await fetchOpen311Status("REQ-1", {
      config: open311Config,
      intakeUrl: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Assert
    expect(result).toEqual({
      status: "error",
      httpStatus: null,
      message: "boom",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx then succeeds once the endpoint recovers", async () => {
    // Arrange: a 500 is retryable for an idempotent GET; the second attempt OK.
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ code: 500 }], 500))
        .mockResolvedValueOnce(jsonResponse(open311Responses.statusOpen));

      // Act
      const pending = fetchOpen311Status("REQ-12345", {
        config: open311Config,
        intakeUrl: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      // Assert: two attempts, success surfaced.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        status: "ok",
        reportStatus: ReportStatus.ACKNOWLEDGED,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the 5xx error after exhausting all retry attempts", async () => {
    // Arrange: the endpoint stays down for every attempt (3 total).
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse([{ code: 503 }], 503));

      // Act
      const pending = fetchOpen311Status("REQ-12345", {
        config: open311Config,
        intakeUrl: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      // Assert: retried up to the attempt cap, then the 5xx is surfaced.
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({ status: "error", httpStatus: 503 });
    } finally {
      vi.useRealTimers();
    }
  });
});
