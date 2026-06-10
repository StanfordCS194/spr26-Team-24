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
