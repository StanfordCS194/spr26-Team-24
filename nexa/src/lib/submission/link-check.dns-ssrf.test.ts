import { beforeEach, describe, expect, it, vi } from "vitest";

// link-check.test.ts covers the STRING-based SSRF guard (literal private IPs and
// localhost-ish hostnames). This file covers the second, DNS-based layer on the
// real fetch path: a perfectly public-looking hostname that RESOLVES to a
// private address (DNS-rebinding / metadata-endpoint pivot). That branch only
// runs when no `fetchImpl` is injected, so these tests mock `node:dns/promises`
// and `fetchWithTimeout` and call checkSubmittableLink WITHOUT a fetch stub.
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

const { fetchWithTimeout } = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, fetchWithTimeout };
});

import { checkSubmittableLink } from "./link-check";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("checkSubmittableLink — DNS-based SSRF guard (real fetch path)", () => {
  beforeEach(() => {
    lookup.mockReset();
    fetchWithTimeout.mockReset();
  });

  it("rejects a public hostname that RESOLVES to a private IP, without fetching", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    const result = await checkSubmittableLink(
      "https://sneaky.example.com/report",
    );

    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("rejects when ANY resolved address is private (mixed A records incl. metadata IP)", async () => {
    lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    const result = await checkSubmittableLink("https://mixed.example.com/");

    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("proceeds to fetch when the host resolves to a public IP", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    fetchWithTimeout.mockResolvedValue(
      htmlResponse(`<form method="post"><input name="x" /></form>`),
    );

    const result = await checkSubmittableLink("https://realcity.gov/report");

    expect(result.status).toBe("form_found");
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("treats a DNS resolution failure as unreachable, without fetching", async () => {
    lookup.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    );

    const result = await checkSubmittableLink("https://nonexistent.invalid/");

    expect(result).toMatchObject({ status: "unreachable" });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});
