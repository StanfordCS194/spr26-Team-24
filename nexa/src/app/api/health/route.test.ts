import { describe, expect, it } from "vitest";

import { http, HttpResponse } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { GET } from "./route";

// Integration test (node project) for a route handler. The health route is the
// simplest handler; this also proves the MSW server is live (an un-stubbed
// outbound request would fail under onUnhandledRequest: "error").
describe("GET /api/health", () => {
  it("responds 200 with status ok", async () => {
    // Arrange / Act
    const response = await GET();

    // Assert
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("has a live MSW server that serves a stubbed handler", async () => {
    // Arrange: register a per-test handler.
    server.use(
      http.get("https://example.test/ping", () =>
        HttpResponse.json({ pong: true }),
      ),
    );

    // Act
    const res = await fetch("https://example.test/ping");

    // Assert
    await expect(res.json()).resolves.toEqual({ pong: true });
  });
});
