import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// instrumentation.ts reads SENTRY_DSN through config.ts, whose getters are lazy
// + memoized per module instance. Reset the module registry between cases so a
// changed SENTRY_DSN takes effect on a fresh import.
const ORIGINAL_SENTRY_DSN = process.env.SENTRY_DSN;

async function loadInstrumentation() {
  vi.resetModules();
  return import("./instrumentation");
}

beforeEach(() => {
  delete process.env.SENTRY_DSN;
});

afterEach(() => {
  if (ORIGINAL_SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
  vi.restoreAllMocks();
});

describe("instrumentation (error-tracking hook)", () => {
  it("register is a no-op and does not throw when SENTRY_DSN is unset", async () => {
    const { register } = await loadInstrumentation();
    await expect(register()).resolves.toBeUndefined();
  });

  it("onRequestError is a no-op and does not throw when SENTRY_DSN is unset", async () => {
    const { onRequestError } = await loadInstrumentation();
    await expect(
      // The shape of the args is irrelevant when the hook short-circuits.
      onRequestError(
        new Error("boom") as { digest: string } & Error,
        { path: "/", method: "GET", headers: {} },
        {
          routerKind: "App Router",
          routePath: "/",
          routeType: "route",
          revalidateReason: undefined,
        } as Parameters<typeof onRequestError>[2],
      ),
    ).resolves.toBeUndefined();
  });
});

// --- Soft-required env warnings at startup (issue #242) --------------------
const SOFT_REQUIRED_VARS = [
  "NEXT_PUBLIC_POSTHOG_KEY",
  "RESEND_API_KEY",
  "SUBMISSION_FROM_EMAIL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "CRON_SECRET",
] as const;

describe("register: soft-required env warnings", () => {
  const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
  // NODE_ENV is typed read-only; assign through a widened view (mirrors test/env.ts).
  const env = process.env as Record<string, string | undefined>;
  const ORIGINAL_NODE_ENV = env.NODE_ENV;
  const ORIGINAL_SOFT: Record<string, string | undefined> = {};

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    for (const name of SOFT_REQUIRED_VARS) {
      ORIGINAL_SOFT[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
    env.NODE_ENV = ORIGINAL_NODE_ENV;
    for (const name of SOFT_REQUIRED_VARS) {
      const original = ORIGINAL_SOFT[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    vi.restoreAllMocks();
  });

  it("logs a [config] WARNING per unset soft-required var in production", async () => {
    process.env.VERCEL_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { register } = await loadInstrumentation();
    await register();

    const lines = warn.mock.calls.map((c) => String(c[0]));
    // One line per unset feature gate (telemetry, email, AI, maps, cron).
    const configLines = lines.filter((l) => l.startsWith("[config] WARNING:"));
    expect(configLines).toHaveLength(5);
    expect(configLines.join("\n")).toContain("NEXT_PUBLIC_POSTHOG_KEY");
    expect(configLines.join("\n")).toContain("AI classification unavailable");
    expect(configLines.join("\n")).toContain("CRON_SECRET");
  });

  it("does NOT warn outside production even when vars are unset", async () => {
    env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { register } = await loadInstrumentation();
    await register();

    expect(
      warn.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.startsWith("[config] WARNING:")),
    ).toHaveLength(0);
  });

  it("emits no [config] warnings in production once every var is configured", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_x";
    process.env.RESEND_API_KEY = "re_x";
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.test";
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.GOOGLE_MAPS_API_KEY = "maps-x";
    process.env.CRON_SECRET = "cron-x";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { register } = await loadInstrumentation();
    await register();

    expect(
      warn.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.startsWith("[config] WARNING:")),
    ).toHaveLength(0);
  });
});
