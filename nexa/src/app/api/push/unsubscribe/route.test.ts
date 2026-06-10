import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const ENDPOINT = "https://push.example.com/sub/abc";

describe("POST /api/push/unsubscribe", () => {
  beforeEach(() => {
    prismaMock.pushSubscription.deleteMany.mockReset();
  });

  it("deletes the stored subscription for the endpoint and returns the envelope", async () => {
    // Arrange
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({
      count: 1,
    } as never);

    // Act
    const response = await POST(makeRequest({ endpoint: ENDPOINT }));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { unsubscribed: true } });
    expect(
      prismaMock.pushSubscription.deleteMany,
    ).toHaveBeenCalledExactlyOnceWith({ where: { endpoint: ENDPOINT } });
  });

  it("is idempotent: still succeeds when no subscription matched", async () => {
    // Arrange
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({
      count: 0,
    } as never);

    // Act
    const response = await POST(makeRequest({ endpoint: ENDPOINT }));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { unsubscribed: true } });
  });

  it("rejects a body missing the endpoint with a 400 and never touches the DB", async () => {
    // Act
    const response = await POST(makeRequest({}));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(prismaMock.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 500 when the delete throws", async () => {
    // Arrange
    prismaMock.pushSubscription.deleteMany.mockRejectedValue(
      new Error("db down"),
    );

    // Act
    const response = await POST(makeRequest({ endpoint: ENDPOINT }));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to remove push subscription.",
    });
  });
});
