import { afterEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { GET } from "./route";

// Integration test (node project) for the health route with the Prisma
// singleton deep-mocked. The route now probes the DB with `SELECT 1`, so these
// tests stub `$queryRaw` to simulate a reachable / unreachable database.
describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responds 200 with status ok when the DB probe succeeds", async () => {
    // Arrange: SELECT 1 resolves.
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    // Act
    const response = await GET();

    // Assert
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "ok",
    });
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
      status: "error",
      database: "unreachable",
    });
  });
});
