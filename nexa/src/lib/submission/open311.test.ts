import { describe, expect, it } from "vitest";

import { IssueType, ReportStatus } from "@/generated/prisma/enums";
import { open311Config } from "@/test/fixtures/open311";

import {
  buildRequestParams,
  mapOpen311Status,
  parseOpen311Config,
  resolveServiceCode,
  STATUS_RANK,
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

describe("mapOpen311Status", () => {
  it("maps open to ACKNOWLEDGED", () => {
    expect(mapOpen311Status("open")).toBe(ReportStatus.ACKNOWLEDGED);
  });

  it("maps closed to RESOLVED", () => {
    expect(mapOpen311Status("closed")).toBe(ReportStatus.RESOLVED);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    // Arrange / Act / Assert
    expect(mapOpen311Status("  OPEN  ")).toBe(ReportStatus.ACKNOWLEDGED);
    expect(mapOpen311Status("Closed")).toBe(ReportStatus.RESOLVED);
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
