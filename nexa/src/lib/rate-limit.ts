// ---------------------------------------------------------------------------
// Lightweight in-memory rate limiter for unauthenticated, expensive endpoints.
//
// The classify / form-link / location-suggest routes fan out to paid LLM and
// geocoding providers, take no auth, and so are trivially abusable to burn
// through API quota and budget. This module provides ONE shared fixed-window
// limiter keyed by client IP that every such route reuses.
//
// SERVERLESS CAVEAT: state lives in this module's process memory, so the limit
// is enforced PER INSTANCE. On Vercel each concurrent lambda has its own copy,
// so the effective global limit is `limit * instances`. This is a deliberate
// cheap first line of defence against a single abusive client; a hard global
// cap needs a shared store (Upstash/Redis), which is out of scope here.
// ---------------------------------------------------------------------------

import { errorResponse } from "@/lib/api/response";

/** Parse a positive-integer env var, falling back to `fallback` when unset/invalid. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Max requests allowed per IP within one window. Configurable via env. */
export function getRateLimitMax(): number {
  return envInt("RATE_LIMIT_MAX", 20);
}

/** Length of the fixed window in milliseconds. Configurable via env. */
export function getRateLimitWindowMs(): number {
  return envInt("RATE_LIMIT_WINDOW_MS", 60_000);
}

export type RateLimitResult = {
  /** Whether this request is allowed (under the limit). */
  allowed: boolean;
  /** Requests still permitted in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets — use for the `Retry-After` header. */
  retryAfterSeconds: number;
};

type WindowState = {
  count: number;
  /** Epoch ms at which the current window expires and the count resets. */
  resetAt: number;
};

/** Per-key window counters. Module-level so the state survives across calls. */
const buckets = new Map<string, WindowState>();

/**
 * Derive the client IP from `x-forwarded-for`. Vercel/most proxies prepend the
 * real client as the first entry, so we take the left-most hop. Falls back to a
 * shared `"unknown"` key when the header is absent (callers behind no proxy),
 * which still bounds anonymous traffic in aggregate.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Record one request against `key` and report whether it is within the limit.
 *
 * Fixed-window algorithm: the first request in a window stamps a `resetAt`
 * `windowMs` into the future; subsequent requests increment until the window
 * expires, after which the counter restarts. Cheap and allocation-light at the
 * cost of allowing up to `2*limit` requests across a window boundary — an
 * accepted trade-off for a budget guard.
 *
 * `now` is injectable for deterministic tests.
 */
export function rateLimit(
  key: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? getRateLimitMax();
  const windowMs = options.windowMs ?? getRateLimitWindowMs();
  const now = options.now ?? Date.now();

  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000),
  );

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds,
  };
}

/**
 * Convenience wrapper: derive the IP from request headers and apply the shared
 * limit in one call. Returns the same {@link RateLimitResult}.
 */
export function rateLimitRequest(
  headers: Headers,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  return rateLimit(clientIpFromHeaders(headers), options);
}

/**
 * Apply the shared per-IP limit to an incoming request. When the caller is over
 * the limit, returns a 429 envelope (via {@link errorResponse}) carrying a
 * `Retry-After` header so clients back off; otherwise returns `null` and the
 * route proceeds. Centralising this keeps the three protected routes free of
 * duplicated limiter plumbing.
 */
export function enforceRateLimit(
  headers: Headers,
  options: { limit?: number; windowMs?: number; now?: number } = {},
) {
  const result = rateLimitRequest(headers, options);
  if (result.allowed) return null;

  const response = errorResponse(
    "Too many requests. Please slow down and try again shortly.",
    429,
    "RATE_LIMITED",
  );
  response.headers.set("Retry-After", String(result.retryAfterSeconds));
  return response;
}

/** Test-only: clear all window state. */
export function __resetRateLimitStore(): void {
  buckets.clear();
}
