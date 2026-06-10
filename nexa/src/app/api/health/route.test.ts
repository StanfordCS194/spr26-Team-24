import { afterEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { GET } from "./route";

// Integration test (node project) for the health route with the Prisma
// singleton deep-mocked. The route now probes the DB with `SELECT 1`, so these
// tests stub `$queryRaw` to simulate a reachable / unreachable database, and
// assert the shared API response envelope shape.
describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responds 200 with status ok plus a secret-free features map when the DB probe succeeds", async () => {
    // Arrange: SELECT 1 resolves.
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    // Act
    const response = await GET();

    // Assert
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        status: string;
        database: string;
        features: Record<string, boolean>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.database).toBe("ok");
    // The features map reports the soft-required gates (issue #242) as booleans
    // only — it must never leak a key value.
    expect(body.data.features).toEqual({
      telemetry: expect.any(Boolean),
      emailSubmission: expect.any(Boolean),
      aiClassification: expect.any(Boolean),
      addressAutocomplete: expect.any(Boolean),
      statusPollingCron: expect.any(Boolean),
    });
    expect(JSON.stringify(body.data.features)).not.toMatch(/sk-|key|secret/i);
  });

  it("responds 503 when the DB probe throws", async () => {
    // Arrange: silence the expected error log, make the probe reject.
    vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));

    // Act
    const response = await GET();

    // Assert
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Database unreachable",
      code: "db_unreachable",
    });
  });
});
