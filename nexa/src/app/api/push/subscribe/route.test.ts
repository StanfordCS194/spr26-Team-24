import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

// Mock the session helper so we can drive the userId attached to a subscription.
const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => getSession(),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  endpoint: "https://push.example.com/sub/abc",
  keys: { p256dh: "pub-key", auth: "auth-secret" },
};

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("upserts the subscription with the session userId", async () => {
    getSession.mockResolvedValue({ userId: "user_1", email: "a@b.com" });
    prismaMock.pushSubscription.upsert.mockResolvedValue({} as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(201);
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: VALID_BODY.endpoint },
      create: {
        endpoint: VALID_BODY.endpoint,
        p256dh: "pub-key",
        auth: "auth-secret",
        userId: "user_1",
      },
      update: {
        p256dh: "pub-key",
        auth: "auth-secret",
        userId: "user_1",
      },
    });
  });

  it("stores a null userId for an anonymous (guest) subscriber", async () => {
    getSession.mockResolvedValue(null);
    prismaMock.pushSubscription.upsert.mockResolvedValue({} as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(201);
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: null }),
      }),
    );
  });

  it("rejects a body missing the push keys with a 400", async () => {
    getSession.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ endpoint: "https://push.example.com/sub/abc" }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.pushSubscription.upsert).not.toHaveBeenCalled();
  });
});
