import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

// Env-gating note: src/lib/push reads VAPID_* into module-level consts at import
// time, so each scenario sets the env and `vi.resetModules()` + dynamic import
// to pick up the value. The default test env has no VAPID keys, exercising the
// NO-OP path the way production does when keys are unset.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("sendPush (env-gated)", () => {
  it("is a NO-OP returning 0 when VAPID keys are unset", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendPush, isPushConfigured } = await import("./index");

    expect(isPushConfigured()).toBe(false);

    const sent = await sendPush("user_1", {
      title: "Report status updated",
      body: "Your report is now in progress.",
    });

    // No keys -> no send, no DB lookup, just a log line.
    expect(sent).toBe(0);
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("reports configured when both VAPID keys are set", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";

    const { isPushConfigured } = await import("./index");

    expect(isPushConfigured()).toBe(true);
  });

  it("short-circuits to 0 for a null userId even when configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";

    const { sendPush } = await import("./index");

    const sent = await sendPush(null, { title: "x", body: "y" });

    expect(sent).toBe(0);
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled();
  });
});
