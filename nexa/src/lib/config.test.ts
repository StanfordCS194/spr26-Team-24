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
