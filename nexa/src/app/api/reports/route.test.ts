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
    prismaMock.agency.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    // No prior report -> not a duplicate, so creation proceeds.
    prismaMock.report.findMany.mockResolvedValue([]);
    // findOrCreateIssueGroup selects only { id }, so a narrowed shape is correct.
    prismaMock.issueGroup.create.mockResolvedValue({
      id: "group_1",
    } as Awaited<ReturnType<typeof prismaMock.issueGroup.create>>);
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
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("report_created");
    expect(prismaMock.report.create).toHaveBeenCalledOnce();
  });

  it("returns 409 with the existing report id on a likely duplicate", async () => {
    // Arrange: an existing same-type report at the exact same location, recent.
    const existing = makeReport({
      id: "report_existing",
      issueType: "ROAD_DAMAGE",
      latitude: 37.4419,
      longitude: -122.143,
      createdAt: new Date(),
    });
    prismaMock.report.findMany.mockResolvedValue([existing]);

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

    // Assert: the second report is rejected, not persisted, and points at the
    // original report so the client can surface it.
    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe("DUPLICATE_REPORT");
    expect(body.details.duplicateOf).toBe("report_existing");
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("honors a user-selected agency that is one of the resolved candidates", async () => {
    // Arrange: an ambiguous match — two agencies cover this Menlo Park spot, so
    // resolveAgencyId returns agencyId=null with both as candidates. The user
    // disambiguated to the Open311 one (the Menlo Park unblock case).
    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-act" },
      { id: "agency-open311" },
    ] as Awaited<ReturnType<typeof prismaMock.agency.findMany>>);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.create.mockResolvedValue({
      id: "group_1",
    } as Awaited<ReturnType<typeof prismaMock.issueGroup.create>>);
    prismaMock.report.create.mockResolvedValue(
      makeReport({ id: "report_created", agencyId: "agency-open311" }),
    );

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({
        description: "Pothole",
        issueType: "ROAD_DAMAGE",
        // Menlo Park (Santa Cruz Ave area) — inside a known polygon.
        latitude: 37.4524,
        longitude: -122.1817,
        selectedAgencyId: "agency-open311",
      }),
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert: the chosen agency is persisted on the new report.
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(prismaMock.report.create).toHaveBeenCalledOnce();
    expect(prismaMock.report.create.mock.calls[0][0].data.agencyId).toBe(
      "agency-open311",
    );
  });

  it("rejects a user-selected agency that is not a resolved candidate", async () => {
    // Arrange: same ambiguous match, but the client sends an agency id that is
    // NOT in the candidate set — a forged/arbitrary choice.
    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-act" },
      { id: "agency-open311" },
    ] as Awaited<ReturnType<typeof prismaMock.agency.findMany>>);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({
        description: "Pothole",
        issueType: "ROAD_DAMAGE",
        latitude: 37.4524,
        longitude: -122.1817,
        selectedAgencyId: "agency-evil",
      }),
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert: rejected with a 400 and the report is never created.
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe("INVALID_AGENCY_CHOICE");
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("persists a user-supplied custom agency URL override as-is", async () => {
    // Arrange: the app routed somewhere (or nowhere) but the user pasted the
    // correct agency's link in the review step. It's stored verbatim — NOT
    // validated against the routed candidates, since the routing was wrong.
    prismaMock.agency.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.create.mockResolvedValue({
      id: "group_1",
    } as Awaited<ReturnType<typeof prismaMock.issueGroup.create>>);
    prismaMock.report.create.mockResolvedValue(
      makeReport({ id: "report_created" }),
    );

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({
        description: "Pothole on University Ave",
        issueType: "ROAD_DAMAGE",
        latitude: 37.4419,
        longitude: -122.143,
        customAgencyUrl: "https://example.gov/report",
      }),
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert: the override is passed straight through to the create call.
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(prismaMock.report.create).toHaveBeenCalledOnce();
    expect(prismaMock.report.create.mock.calls[0][0].data.customAgencyUrl).toBe(
      "https://example.gov/report",
    );
  });

  it("rejects an invalid custom agency URL with a 400", async () => {
    // Arrange: routing/dedupe stubs in case parsing ever got that far (it won't).
    prismaMock.agency.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);

    const request = new NextRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({
        description: "Pothole",
        issueType: "ROAD_DAMAGE",
        customAgencyUrl: "not a url",
      }),
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert: the schema rejects it before any report is created.
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("returns 500 when the database write throws", async () => {
    // Arrange
    prismaMock.agency.findMany.mockResolvedValue([]);
    prismaMock.issueGroup.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);
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
