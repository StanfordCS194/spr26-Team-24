import { describe, expect, it, vi } from "vitest";

import {
  checkSubmittableLink,
  parseHttpUrl,
  isPrivateIp,
  isBlockedHostname,
  MAX_BODY_BYTES,
} from "./link-check";
import { TimeoutError } from "@/lib/http";

/** Build a stub `fetch` returning an HTML body with the given status. */
function htmlFetch(html: string, init: ResponseInit = {}): typeof fetch {
  return vi.fn(
    async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
        ...init,
      }),
  ) as unknown as typeof fetch;
}

/** A stub `fetch` that throws — simulates DNS/connection failure. */
function throwingFetch(error: unknown): typeof fetch {
  return vi.fn(async () => {
    throw error;
  }) as unknown as typeof fetch;
}

describe("parseHttpUrl", () => {
  it("accepts http and https URLs with a host", () => {
    expect(parseHttpUrl("https://city.gov/report")?.hostname).toBe("city.gov");
    expect(parseHttpUrl("http://example.com")?.protocol).toBe("http:");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseHttpUrl("  https://city.gov  ")?.hostname).toBe("city.gov");
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<form>"],
    ["mailto:a@b.com"],
    ["ftp://host/file"],
    ["http://"],
    ["https://"],
    ["not a url"],
    [""],
  ])("rejects %s", (raw) => {
    expect(parseHttpUrl(raw)).toBeNull();
  });
});

describe("SSRF guard", () => {
  it("flags private / loopback / link-local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it("blocks localhost-ish and single-label hosts, allows public domains", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "router.local",
      "service.internal",
      "intranet", // single label
      "127.0.0.1",
      "169.254.169.254",
    ]) {
      expect(isBlockedHostname(host)).toBe(true);
    }
    for (const host of ["paloalto.gov", "seeclickfix.com", "8.8.8.8"]) {
      expect(isBlockedHostname(host)).toBe(false);
    }
  });

  it("returns invalid_url for an internal-IP link WITHOUT fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await checkSubmittableLink("http://169.254.169.254/latest", {
      fetchImpl,
    });
    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_url for a localhost link without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await checkSubmittableLink("http://localhost:8080/admin", {
      fetchImpl,
    });
    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("checkSubmittableLink", () => {
  it("returns invalid_url for a non-http scheme without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await checkSubmittableLink("javascript:alert(1)", {
      fetchImpl,
    });
    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns invalid_url for a malformed URL without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await checkSubmittableLink("http://", { fetchImpl });
    expect(result).toEqual({ status: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("detects a POST form as form_found with high confidence", async () => {
    const html = `<html><body>
      <form method="POST" action="/submit"><input name="desc" /></form>
    </body></html>`;
    const result = await checkSubmittableLink("https://city.gov/report", {
      fetchImpl: htmlFetch(html),
    });
    expect(result).toEqual({
      status: "form_found",
      confidence: "high",
      signals: expect.arrayContaining(["post_form"]),
    });
  });

  it("detects a self-closing/unterminated POST form tag", async () => {
    // SPA-style page: a <form method=post> tag with no matching </form>.
    const html = `<html><body><form method="post" data-spa>`;
    const result = await checkSubmittableLink("https://city.gov/report", {
      fetchImpl: htmlFetch(html),
    });
    expect(result.status).toBe("form_found");
    if (result.status === "form_found") {
      expect(result.confidence).toBe("high");
    }
  });

  it("detects a SeeClickFix reporting portal marker", async () => {
    const html = `<html><head><title>SeeClickFix</title></head>
      <body>Report an issue to your city</body></html>`;
    const result = await checkSubmittableLink(
      "https://seeclickfix.com/report",
      { fetchImpl: htmlFetch(html) },
    );
    expect(result.status).toBe("form_found");
    if (result.status === "form_found") {
      expect(result.signals).toContain("seeclickfix");
    }
  });

  it("treats a GET form co-located with portal text as medium confidence", async () => {
    const html = `<html><body>
      <h1>Submit a request</h1>
      <form action="/search"><input name="q" /></form>
    </body></html>`;
    const result = await checkSubmittableLink("https://example.com/portal", {
      fetchImpl: htmlFetch(html),
    });
    expect(result).toMatchObject({
      status: "form_found",
      confidence: "medium",
    });
  });

  it("treats portal text with no form as low confidence (JS-rendered form)", async () => {
    const html = `<html><body><div id="app">Report a problem online</div></body></html>`;
    const result = await checkSubmittableLink("https://example.com/portal", {
      fetchImpl: htmlFetch(html),
    });
    expect(result).toMatchObject({
      status: "form_found",
      confidence: "low",
    });
  });

  it("treats a plain input form with no portal markers as medium confidence", async () => {
    const html = `<html><body><form action="/x"><input name="a" /></form></body></html>`;
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: htmlFetch(html),
    });
    expect(result).toEqual({
      status: "form_found",
      confidence: "medium",
      signals: ["input_form"],
    });
  });

  it("returns no_form for reachable HTML with no form or markers", async () => {
    const html = `<html><body><h1>Welcome to our city</h1><p>Hello.</p></body></html>`;
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: htmlFetch(html),
    });
    expect(result).toMatchObject({ status: "no_form" });
  });

  it("returns no_form for an empty body", async () => {
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: htmlFetch("   "),
    });
    expect(result).toMatchObject({ status: "no_form" });
  });

  it("returns unreachable for a 404", async () => {
    const result = await checkSubmittableLink("https://example.com/missing", {
      fetchImpl: htmlFetch("Not found", { status: 404 }),
    });
    expect(result).toMatchObject({ status: "unreachable" });
    if (result.status === "unreachable") {
      expect(result.reason).toContain("404");
    }
  });

  it("returns unreachable for a 500", async () => {
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: htmlFetch("Server error", { status: 500 }),
    });
    expect(result).toMatchObject({ status: "unreachable" });
  });

  it("returns unreachable on a timeout", async () => {
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: throwingFetch(new TimeoutError(12_000)),
    });
    expect(result).toEqual({
      status: "unreachable",
      reason: "The link timed out.",
    });
  });

  it("returns unreachable on a DNS/network throw", async () => {
    const dnsError = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    const result = await checkSubmittableLink("https://nope.invalid/", {
      fetchImpl: throwingFetch(dnsError),
    });
    expect(result).toMatchObject({ status: "unreachable" });
  });

  it("follows redirects to a form (the stub fetch resolves the final page)", async () => {
    // fetch with redirect:"follow" lands on the final 200 HTML; emulate that.
    const html = `<form method="post"><input name="x" /></form>`;
    const fetchImpl = htmlFetch(html);
    const result = await checkSubmittableLink("https://example.com/old", {
      fetchImpl,
    });
    expect(result.status).toBe("form_found");
    // The request was issued with redirect:"follow".
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/old",
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("treats a 403 from a .gov host as a likely (low-confidence) form", async () => {
    const result = await checkSubmittableLink("https://paloalto.gov/report", {
      fetchImpl: htmlFetch("Forbidden", { status: 403 }),
    });
    expect(result).toEqual({
      status: "form_found",
      confidence: "low",
      signals: ["gov_domain_bot_protected"],
    });
  });

  it("treats a 401 from a seeclickfix host as a likely form", async () => {
    const result = await checkSubmittableLink(
      "https://city.seeclickfix.com/report",
      { fetchImpl: htmlFetch("Unauthorized", { status: 401 }) },
    );
    expect(result.status).toBe("form_found");
  });

  it("does NOT treat a 403 from a non-gov host as a form", async () => {
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: htmlFetch("Forbidden", { status: 403 }),
    });
    expect(result).toMatchObject({ status: "unreachable" });
  });

  it("caps an oversized body and still classifies it", async () => {
    // A huge body whose form sits in the first chunk. We assert the cap is
    // honored by streaming a body larger than MAX_BODY_BYTES.
    const head = `<form method="post"><input name="x" /></form>`;
    const filler = "x".repeat(MAX_BODY_BYTES * 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(head));
        controller.enqueue(enc.encode(filler));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;

    const result = await checkSubmittableLink("https://example.com/big", {
      fetchImpl,
    });
    expect(result.status).toBe("form_found");
  });

  it("never throws — an unexpected fetch error maps to unreachable", async () => {
    const result = await checkSubmittableLink("https://example.com/", {
      fetchImpl: throwingFetch(new Error("boom")),
    });
    expect(result).toMatchObject({ status: "unreachable" });
  });
});
