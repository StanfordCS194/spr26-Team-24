import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// ---------------------------------------------------------------------------
// Deterministic fixed-window boundary tests (#207). These exercise the
// PRODUCTION clock path: rateLimit is called WITHOUT an injected `now`, so it
// reads Date.now(). Vitest fake timers freeze and advance that clock, so the
// window edges are deterministic with no injected time and no real sleeps.
// ---------------------------------------------------------------------------
describe("rateLimit — fixed-window boundary under fake timers (#207)", () => {
  const WINDOW_MS = 60_000;
  const START = new Date("2026-06-09T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    // __resetRateLimitStore runs via the outer afterEach; restore the clock.
    vi.useRealTimers();
  });

  it("counts requests within the window and blocks past the limit", () => {
    const opts = { limit: 3, windowMs: WINDOW_MS };

    // Three requests inside the same (frozen) window are allowed.
    expect(rateLimit("ip", opts).allowed).toBe(true);
    expect(rateLimit("ip", opts).allowed).toBe(true);
    expect(rateLimit("ip", opts).remaining).toBe(0);

    // Advance but stay strictly inside the window: still blocked.
    vi.advanceTimersByTime(WINDOW_MS - 1);
    const blocked = rateLimit("ip", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(1); // ~1ms left → ceil to 1.
  });

  it("does NOT reset one millisecond before the window expires", () => {
    const opts = { limit: 1, windowMs: WINDOW_MS };
    expect(rateLimit("ip", opts).allowed).toBe(true);

    // resetAt = START + WINDOW_MS; one tick before that the window is alive.
    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(rateLimit("ip", opts).allowed).toBe(false);
  });

  it("resets exactly at the window edge (now >= resetAt is inclusive)", () => {
    const opts = { limit: 1, windowMs: WINDOW_MS };
    expect(rateLimit("ip", opts).allowed).toBe(true);

    // Advance precisely to resetAt: the counter restarts and the request passes.
    vi.advanceTimersByTime(WINDOW_MS);
    const afterReset = rateLimit("ip", opts);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0); // fresh window, one request spent.
  });

  it("starts a fresh window after expiry rather than carrying the count over", () => {
    const opts = { limit: 2, windowMs: WINDOW_MS };
    rateLimit("ip", opts); // 1
    expect(rateLimit("ip", opts).remaining).toBe(0); // 2 — at the limit
    expect(rateLimit("ip", opts).allowed).toBe(false); // blocked in window 1

    // Roll past the window: full budget is available again.
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimit("ip", opts).allowed).toBe(true);
    expect(rateLimit("ip", opts).allowed).toBe(true);
    expect(rateLimit("ip", opts).allowed).toBe(false);
  });

  it("isolates keys: one IP exhausting its budget does not leak into another", () => {
    const opts = { limit: 1, windowMs: WINDOW_MS };

    // ip_a spends and exhausts its budget.
    expect(rateLimit("ip_a", opts).allowed).toBe(true);
    expect(rateLimit("ip_a", opts).allowed).toBe(false);

    // ip_b is untouched — full budget despite ip_a being blocked.
    expect(rateLimit("ip_b", opts).allowed).toBe(true);
    expect(rateLimit("ip_b", opts).allowed).toBe(false);

    // Their windows expire independently; advancing time resets both cleanly.
    vi.advanceTimersByTime(WINDOW_MS);
    expect(rateLimit("ip_a", opts).allowed).toBe(true);
    expect(rateLimit("ip_b", opts).allowed).toBe(true);
  });

  it("keeps each key's window edge independent when stamped at different times", () => {
    const opts = { limit: 1, windowMs: WINDOW_MS };

    // ip_a's window opens at START.
    expect(rateLimit("ip_a", opts).allowed).toBe(true);

    // Half a window later ip_b opens its own window.
    vi.advanceTimersByTime(WINDOW_MS / 2);
    expect(rateLimit("ip_b", opts).allowed).toBe(true);

    // At START + WINDOW_MS, ip_a resets but ip_b (opened later) is still capped.
    vi.advanceTimersByTime(WINDOW_MS / 2);
    expect(rateLimit("ip_a", opts).allowed).toBe(true);
    expect(rateLimit("ip_b", opts).allowed).toBe(false);
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
