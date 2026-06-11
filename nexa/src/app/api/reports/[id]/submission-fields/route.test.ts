import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntakeMethod } from "@/generated/prisma/enums";
import { makeReport } from "@/test/factories/report";
import { makeAgency } from "@/test/factories/agency";
import { prismaMock } from "@/test/prisma-mock";

// Ownership gates on the session; agency resolution is delegated to the
// jurisdictions lib. Mock both boundaries; use the REAL buildPrefillFields so we
// assert the actual prefill shape the route emits.
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/auth";

const { resolveAgencyId } = vi.hoisted(() => ({ resolveAgencyId: vi.fn() }));
vi.mock("@/lib/jurisdictions/agency", () => ({ resolveAgencyId }));

import { GET } from "./route";

const mockedGetSession = vi.mocked(getSession);

function request(): NextRequest {
  return new NextRequest("http://localhost/api/reports/r1/submission-fields");
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/reports/[id]/submission-fields", () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
    resolveAgencyId.mockReset();
    prismaMock.report.findUnique.mockReset();
    prismaMock.agency.findUnique.mockReset();
  });

  it("returns 404 when the report does not exist", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue(null);
    prismaMock.report.findUnique.mockResolvedValue(null);

    // Act
    const res = await GET(request(), params("missing"));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: "Report not found." });
  });

  it("returns 403 when an owned report belongs to another user", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "viewer", email: "v@x.com" });
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({ id: "r1", userId: "someone_else" }),
      agency: null,
    } as never);

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: "You can only view your own reports.",
    });
  });

  it("serves an anonymous (userId-null) report to any caller", async () => {
    // Arrange: anonymous report, no agency on the report, none resolved either.
    mockedGetSession.mockResolvedValue(null);
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({ id: "r1", userId: null, agencyId: null }),
      agency: null,
    } as never);
    resolveAgencyId.mockResolvedValue({ agencyId: null, candidates: [] });

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert: no 403/404; route returns the null-agency envelope (no agency and
    // no override link, so nothing to file and no destination).
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { agency: null, formUrl: null, customAgencyUrl: null, fields: [] },
    });
  });

  it("returns agency, formUrl and prefilled fields for an owned report with an agency", async () => {
    // Arrange: report carries its agency directly (no resolution needed).
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    const agency = makeAgency({
      id: "agency_1",
      name: "Palo Alto 311",
      intakeUrl: "https://www.paloalto.gov/311",
      intakeMethod: IntakeMethod.WEB_FORM,
      requiredFields: {
        location_address: { type: "string", required: true },
        description: { type: "string", required: true },
        photo: { type: "file", required: false },
      },
    });
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({
        id: "r1",
        userId: "owner",
        agencyId: "agency_1",
        address: "University Ave, Palo Alto, CA",
        description: "Large pothole on the corner.",
      }),
      agency,
    } as never);

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert: envelope shape + prefilled values from the report.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.agency).toEqual({
      name: "Palo Alto 311",
      intakeUrl: "https://www.paloalto.gov/311",
      intakeMethod: IntakeMethod.WEB_FORM,
    });
    expect(body.data.formUrl).toBe("https://www.paloalto.gov/311");

    const byKey = Object.fromEntries(
      body.data.fields.map((f: { key: string }) => [f.key, f]),
    );
    expect(byKey.location_address).toMatchObject({
      key: "location_address",
      label: "Location address",
      value: "University Ave, Palo Alto, CA",
      required: true,
      type: "string",
    });
    expect(byKey.description.value).toBe("Large pothole on the corner.");
    // The agency resolver is not consulted when the report already has an agency.
    expect(resolveAgencyId).not.toHaveBeenCalled();
  });

  it("prefers the user's custom link as the destination over the agency form", async () => {
    // Arrange: an agency matched, but the user pasted their own correct link.
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    const agency = makeAgency({
      id: "agency_1",
      name: "Palo Alto 311",
      intakeUrl: "https://www.paloalto.gov/311",
      intakeMethod: IntakeMethod.WEB_FORM,
      requiredFields: { description: { type: "string", required: true } },
    });
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({
        id: "r1",
        userId: "owner",
        agencyId: "agency_1",
        description: "Broken streetlight.",
        customAgencyUrl: "https://correctcity.gov/report",
      }),
      agency,
    } as never);

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert: the override link wins as the destination, and is surfaced.
    expect(body.data.formUrl).toBe("https://correctcity.gov/report");
    expect(body.data.customAgencyUrl).toBe("https://correctcity.gov/report");
    expect(body.data.fields.length).toBeGreaterThan(0);
  });

  it("pre-composes the report against the custom link when no agency matched", async () => {
    // Arrange: out of coverage (no agency), but the user supplied a link.
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({
        id: "r1",
        userId: "owner",
        agencyId: null,
        address: "1 Main St",
        description: "Fallen tree blocking the road.",
        customAgencyUrl: "https://mytown.gov/contact",
      }),
      agency: null,
    } as never);
    resolveAgencyId.mockResolvedValue({ agencyId: null, candidates: [] });

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert: no agency, but the report is still pre-composed against the link.
    expect(body.data.agency).toBeNull();
    expect(body.data.formUrl).toBe("https://mytown.gov/contact");
    expect(body.data.customAgencyUrl).toBe("https://mytown.gov/contact");
    const byKey = Object.fromEntries(
      body.data.fields.map((f: { key: string }) => [f.key, f]),
    );
    expect(byKey.description.value).toBe("Fallen tree blocking the road.");
    expect(byKey.location_address.value).toBe("1 Main St");
  });

  it("resolves the agency by location when the report has none attached", async () => {
    // Arrange: no agency on the report; resolver picks one, route loads it.
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue({
      ...makeReport({ id: "r1", userId: "owner", agencyId: null }),
      agency: null,
    } as never);
    resolveAgencyId.mockResolvedValue({
      agencyId: "agency_9",
      candidates: ["agency_9"],
    });
    prismaMock.agency.findUnique.mockResolvedValue(
      makeAgency({
        id: "agency_9",
        name: "Resolved Agency",
        requiredFields: {},
      }),
    );

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(resolveAgencyId).toHaveBeenCalledOnce();
    expect(prismaMock.agency.findUnique).toHaveBeenCalledWith({
      where: { id: "agency_9" },
    });
    expect(body.data.agency.name).toBe("Resolved Agency");
    expect(body.data.fields).toEqual([]);
  });

  it("returns 500 when the lookup throws", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockRejectedValue(new Error("db down"));

    // Act
    const res = await GET(request(), params("r1"));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to build submission fields.",
    });
  });
});
