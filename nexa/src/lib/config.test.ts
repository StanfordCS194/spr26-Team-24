import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts getters are lazy + memoized per module instance, so each test that
// needs a different ADMIN_EMAILS value resets the module registry and re-imports
// a fresh copy after setting process.env.
const ORIGINAL = process.env.ADMIN_EMAILS;

async function loadGetAdminEmails() {
  vi.resetModules();
  const mod = await import("./config");
  return mod.getAdminEmails;
}

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

describe("getAdminEmails", () => {
  it("returns an empty set when ADMIN_EMAILS is unset (locked down by default)", async () => {
    const getAdminEmails = await loadGetAdminEmails();
    expect(getAdminEmails().size).toBe(0);
  });

  it("parses a comma-separated list, lower-casing and trimming each entry", async () => {
    process.env.ADMIN_EMAILS = "  Alice@x.org , BOB@y.org ";
    const getAdminEmails = await loadGetAdminEmails();
    const set = getAdminEmails();
    expect(set.has("alice@x.org")).toBe(true);
    expect(set.has("bob@y.org")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("drops empty entries from stray commas", async () => {
    process.env.ADMIN_EMAILS = "a@x.org,,, ,b@x.org";
    const getAdminEmails = await loadGetAdminEmails();
    expect(getAdminEmails().size).toBe(2);
  });

  it("memoizes the parsed set across calls", async () => {
    process.env.ADMIN_EMAILS = "a@x.org";
    const getAdminEmails = await loadGetAdminEmails();
    expect(getAdminEmails()).toBe(getAdminEmails());
  });
});

const ORIGINAL_SENTRY_DSN = process.env.SENTRY_DSN;

async function loadGetSentryDsn() {
  vi.resetModules();
  const mod = await import("./config");
  return mod.getSentryDsn;
}

describe("getSentryDsn", () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (ORIGINAL_SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
  });

  it("returns undefined when SENTRY_DSN is unset (error tracking is a no-op)", async () => {
    const getSentryDsn = await loadGetSentryDsn();
    expect(getSentryDsn()).toBeUndefined();
  });

  it("returns a trimmed DSN when set", async () => {
    process.env.SENTRY_DSN = "  https://abc@o0.ingest.sentry.io/1  ";
    const getSentryDsn = await loadGetSentryDsn();
    expect(getSentryDsn()).toBe("https://abc@o0.ingest.sentry.io/1");
  });
});

// --- Soft-required env audit (issue #242) ----------------------------------
//
// These functions read process.env directly (not the cached getters), so a
// fresh import is unnecessary — but every var must be set/cleared per case to
// keep the audit deterministic regardless of the ambient test environment.
const SOFT_REQUIRED_VARS = [
  "NEXT_PUBLIC_POSTHOG_KEY",
  "RESEND_API_KEY",
  "SUBMISSION_FROM_EMAIL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "CRON_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
] as const;

describe("soft-required env audit", () => {
  const ORIGINAL_SOFT: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of SOFT_REQUIRED_VARS) {
      ORIGINAL_SOFT[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of SOFT_REQUIRED_VARS) {
      const original = ORIGINAL_SOFT[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it("warns about every soft-required feature when all vars are unset", async () => {
    const { getSoftRequiredEnvWarnings } = await import("./config");
    const warnings = getSoftRequiredEnvWarnings();
    expect(warnings).toHaveLength(6);
    expect(warnings.join("\n")).toContain("NEXT_PUBLIC_POSTHOG_KEY");
    expect(warnings.join("\n")).toContain("RESEND_API_KEY");
    expect(warnings.join("\n")).toContain("AI classification unavailable");
    expect(warnings.join("\n")).toContain("GOOGLE_MAPS_API_KEY");
    expect(warnings.join("\n")).toContain("CRON_SECRET");
    expect(warnings.join("\n")).toContain("GOOGLE_OAUTH_CLIENT_ID");
  });

  it("emits no warnings once every soft-required var is configured", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_x";
    process.env.RESEND_API_KEY = "re_x";
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.test";
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.GOOGLE_MAPS_API_KEY = "maps-x";
    process.env.CRON_SECRET = "cron-x";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "gcid-x";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "gcsecret-x";
    const { getSoftRequiredEnvWarnings } = await import("./config");
    expect(getSoftRequiredEnvWarnings()).toEqual([]);
  });

  it("requires BOTH RESEND_API_KEY and SUBMISSION_FROM_EMAIL for emailSubmission", async () => {
    process.env.RESEND_API_KEY = "re_x"; // only one of the pair
    const { getConfiguredFeatures, getSoftRequiredEnvWarnings } =
      await import("./config");
    expect(getConfiguredFeatures().emailSubmission).toBe(false);
    expect(getSoftRequiredEnvWarnings().join("\n")).toContain(
      "EMAIL-intake agencies degrade to manual-assist",
    );
  });

  it("treats ANY one AI provider key as sufficient for classification", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    const { getConfiguredFeatures, getSoftRequiredEnvWarnings } =
      await import("./config");
    expect(getConfiguredFeatures().aiClassification).toBe(true);
    expect(getSoftRequiredEnvWarnings().join("\n")).not.toContain(
      "AI classification unavailable",
    );
  });

  it("treats whitespace-only values as unset", async () => {
    process.env.CRON_SECRET = "   ";
    const { getConfiguredFeatures } = await import("./config");
    expect(getConfiguredFeatures().statusPollingCron).toBe(false);
  });

  it("exposes a secret-free boolean feature map (no values leaked)", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_supersecret";
    const { getConfiguredFeatures } = await import("./config");
    const features = getConfiguredFeatures();
    expect(features).toEqual({
      telemetry: true,
      emailSubmission: false,
      aiClassification: false,
      addressAutocomplete: false,
      statusPollingCron: false,
      googleSignIn: false,
    });
    expect(JSON.stringify(features)).not.toContain("phc_supersecret");
  });
});
