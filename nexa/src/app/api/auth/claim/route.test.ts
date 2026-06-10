import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { POST } from "./route";

// Integration test (node project) for the account-claim route with Prisma
// deep-mocked. Covers the original passwordless-account upgrade AND the
// anonymous-reporting addition where `reportIds` attach guest reports.

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/claim", () => {
  it("creates the account and attaches anonymous reports by id", async () => {
    // Arrange — new email (no existing user), two pending guest report ids.
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user_new",
      email: "guest@example.com",
      name: null,
    } as Awaited<ReturnType<typeof prismaMock.user.create>>);
    prismaMock.report.updateMany.mockResolvedValue({ count: 2 });

    const request = makeRequest({
      email: "guest@example.com",
      password: "supersecret",
      reportIds: ["rpt_1", "rpt_2"],
    });

    // Act
    const response = await POST(request);

    // Assert — orphan reports re-associated with the new user only.
    expect(response.status).toBe(200);
    expect(prismaMock.report.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rpt_1", "rpt_2"] }, userId: null },
      data: { userId: "user_new" },
    });
  });

  it("does not touch reports when no reportIds are supplied", async () => {
    // Arrange — original passwordless-account flow stays unchanged.
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user_new",
      email: "legacy@example.com",
      name: null,
    } as Awaited<ReturnType<typeof prismaMock.user.create>>);

    const request = makeRequest({
      email: "legacy@example.com",
      password: "supersecret",
    });

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(200);
    expect(prismaMock.report.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the account already has a password", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_existing",
      passwordHash: "already-set",
    } as Awaited<ReturnType<typeof prismaMock.user.findUnique>>);

    const request = makeRequest({
      email: "taken@example.com",
      password: "supersecret",
      reportIds: ["rpt_1"],
    });

    // Act
    const response = await POST(request);

    // Assert — no report mutation happens on the rejected path.
    expect(response.status).toBe(409);
    expect(prismaMock.report.updateMany).not.toHaveBeenCalled();
  });
});
