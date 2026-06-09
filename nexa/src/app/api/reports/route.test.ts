import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

import { POST } from "./route";

// Integration test (node project) with the Prisma singleton deep-mocked. This
// exercises the prisma-mock helper end-to-end through a real route handler.
describe("POST /api/reports", () => {
  it("creates a report and returns 201 with the row", async () => {
    // Arrange
    const created = makeReport({
      id: "report_created",
      issueType: "ROAD_DAMAGE",
    });
    // Routing/dedupe helpers query prisma too — stub them so the route runs.
    prismaMock.agency.findFirst.mockResolvedValue(null);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.issueGroup.create.mockResolvedValue({ id: "group_1" } as any);
    prismaMock.report.create.mockResolvedValue(created);

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({
        description: "Pothole on University Ave",
        issueType: "ROAD_DAMAGE",
        latitude: 37.4419,
        longitude: -122.143,
      }),
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(body.id).toBe("report_created");
    expect(prismaMock.report.create).toHaveBeenCalledOnce();
  });

  it("returns 500 when the database write throws", async () => {
    // Arrange
    prismaMock.agency.findFirst.mockResolvedValue(null);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.create.mockRejectedValue(new Error("db down"));

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ description: "x", issueType: "OTHER" }),
    });

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(500);
  });
});
