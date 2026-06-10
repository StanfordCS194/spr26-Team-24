import { afterEach, describe, expect, it } from "vitest";

import {
  __resetRateLimitStore,
  clientIpFromHeaders,
  enforceRateLimit,
  rateLimit,
} from "./rate-limit";

afterEach(() => {
  __resetRateLimitStore();
});

describe("rateLimit", () => {
  it("allows requests up to the limit then blocks", () => {
    const opts = { limit: 3, windowMs: 60_000, now: 1_000 };

    expect(rateLimit("a", opts).allowed).toBe(true);
    expect(rateLimit("a", opts).allowed).toBe(true);
    const third = rateLimit("a", opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = rateLimit("a", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks each key independently", () => {
    const opts = { limit: 1, windowMs: 60_000, now: 1_000 };
    expect(rateLimit("a", opts).allowed).toBe(true);
    expect(rateLimit("b", opts).allowed).toBe(true);
    expect(rateLimit("a", opts).allowed).toBe(false);
  });

  it("resets the count once the window expires", () => {
    expect(rateLimit("a", { limit: 1, windowMs: 1_000, now: 0 }).allowed).toBe(
      true,
    );
    expect(
      rateLimit("a", { limit: 1, windowMs: 1_000, now: 500 }).allowed,
    ).toBe(false);
    // Window elapsed: counter restarts.
    expect(
      rateLimit("a", { limit: 1, windowMs: 1_000, now: 1_000 }).allowed,
    ).toBe(true);
  });

  it("reports retryAfter in seconds rounded up", () => {
    rateLimit("a", { limit: 1, windowMs: 5_000, now: 0 });
    const blocked = rateLimit("a", { limit: 1, windowMs: 5_000, now: 1_200 });
    expect(blocked.allowed).toBe(false);
    // ~3.8s remaining → ceil to 4.
    expect(blocked.retryAfterSeconds).toBe(4);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the left-most x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip then 'unknown'", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.5" })),
    ).toBe("198.51.100.5");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  it("returns null while under the limit", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    expect(
      enforceRateLimit(headers, { limit: 2, windowMs: 60_000 }),
    ).toBeNull();
    expect(
      enforceRateLimit(headers, { limit: 2, windowMs: 60_000 }),
    ).toBeNull();
  });

  it("returns a 429 envelope with Retry-After once over the limit", async () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    enforceRateLimit(headers, { limit: 1, windowMs: 60_000 });
    const response = enforceRateLimit(headers, { limit: 1, windowMs: 60_000 });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(Number(response!.headers.get("Retry-After"))).toBeGreaterThan(0);

    const body = (await response!.json()) as {
      success: boolean;
      code?: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe("RATE_LIMITED");
  });
});
