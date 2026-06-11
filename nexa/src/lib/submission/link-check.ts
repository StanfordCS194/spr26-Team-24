// ---------------------------------------------------------------------------
// Custom-agency-link form detection.
//
// When a user overrides Nexa's auto-routing with their own agency link (the
// "Filing somewhere else?" field on the review step), we want to tell them
// whether that link actually points at something they can file a report at —
// before they submit. This module does that check.
//
// It is deliberately advisory: `checkSubmittableLink` NEVER throws and always
// resolves to one of four typed verdicts (see {@link LinkCheckResult}). The UI
// surfaces the verdict as inline feedback but never blocks submission on it.
//
// Detection is pragmatic and dependency-free — there is no HTML parser in the
// project (checked package.json), so we key off string/regex heuristics over
// the fetched HTML rather than adding a DOM library. The page is fetched with a
// bounded timeout (reusing `fetchWithTimeout`), a sane browser-ish User-Agent,
// and a hard cap on how many bytes we read, so a hostile/huge page can't stall
// or OOM the route.
// ---------------------------------------------------------------------------

import {
  fetchWithTimeout,
  DEFAULT_HTTP_TIMEOUT_MS,
  TimeoutError,
} from "@/lib/http";
import type { LinkCheckResult } from "@/lib/api/types";

/**
 * Max bytes of the response body we read before giving up. A reporting form
 * lives in the first chunk of HTML; reading megabytes of a hostile page buys us
 * nothing and risks memory/time. 512 KiB comfortably covers real civic pages.
 */
export const MAX_BODY_BYTES = 512 * 1024;

/**
 * A browser-ish User-Agent. Many real .gov / civic portals serve different
 * markup (or simply refuse) to an obvious bot UA, so we present as a normal
 * browser to get representative HTML. We still identify Nexa in a comment-style
 * suffix for operator transparency without tripping naive bot filters.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; NexaCivicLinkCheck/1.0; +https://nexa.report/bot)";

/** Injectable `fetch` for tests; defaults to the timeout-wrapped global fetch. */
export type LinkCheckOptions = {
  fetchImpl?: typeof fetch;
  /** Overrides the per-request timeout (defaults to {@link DEFAULT_HTTP_TIMEOUT_MS}). */
  timeoutMs?: number;
};

/**
 * Validate that `raw` is a syntactically usable http(s) URL with a real host.
 * Rejects non-http(s) schemes (`javascript:`, `data:`, `mailto:`, `ftp:`…),
 * missing/empty hosts, and anything `URL` can't parse. Returns the normalized
 * `URL` on success so callers fetch exactly what was validated.
 */
export function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A bare scheme like `http:///path` parses but has no host to fetch.
  if (!url.hostname) return null;
  return url;
}

/** Known gov-ish TLDs whose bot-protection 403/401 we treat as "likely a real form". */
function isLikelyGovHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "gov" ||
    host.endsWith(".gov") ||
    host.endsWith(".gov.uk") ||
    host.endsWith(".us") ||
    host.endsWith(".mil") ||
    host.endsWith(".city") ||
    // Common municipal SaaS reporting portals also gate bots aggressively.
    host.endsWith("seeclickfix.com") ||
    host.endsWith("publicstuff.com") ||
    host.endsWith("granicus.com")
  );
}

/**
 * Signal patterns that strongly indicate a submittable civic-reporting form or
 * portal. Each entry is [human-readable signal name, test]. Kept as a flat list
 * so both the detector and tests can reason about which markers fired.
 */
const PORTAL_MARKERS: Array<[signal: string, test: RegExp]> = [
  ["seeclickfix", /seeclickfix/i],
  ["open311", /open311|\/georeport\/v2|service_request/i],
  [
    "submit_a_request",
    /submit\s+a\s+request|report\s+(an?\s+)?(issue|problem|concern)/i,
  ],
  ["311_portal", /\b311\b|service\s+request|report\s+it/i],
  [
    "service_portal_saas",
    /publicstuff|govqa|accela|romulus|cityworks|salesforce\.com\/form/i,
  ],
];

/**
 * True when the HTML contains a `<form>` that looks submittable: it either
 * declares `method="post"` or carries at least one input/textarea/select the
 * user would fill in. A purely decorative search box on an otherwise static
 * page is weak signal, so we additionally require the page to look like a
 * reporting context (handled by the caller via portal markers) before treating
 * a GET-only form as "found".
 */
function detectForms(html: string): {
  hasPostForm: boolean;
  hasInputForm: boolean;
} {
  let hasPostForm = false;
  let hasInputForm = false;

  // Walk each <form ...> ... </form> block. A defensive cap on iterations keeps
  // a pathological page (thousands of tiny forms) from spinning the regex.
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = formRe.exec(html)) !== null && seen < 50) {
    seen++;
    const attrs = match[1];
    const body = match[2];
    if (/\bmethod\s*=\s*["']?\s*post/i.test(attrs)) hasPostForm = true;
    if (/<(input|textarea|select)\b/i.test(body)) hasInputForm = true;
    if (hasPostForm) break; // strongest signal found; no need to keep scanning
  }

  // Some SPA/JS-rendered portals ship a self-closing or unterminated <form> tag
  // (no matching </form> in the initial HTML). Treat a lone POST form tag as a
  // post form so we don't miss those.
  if (!hasPostForm && /<form\b[^>]*\bmethod\s*=\s*["']?\s*post/i.test(html)) {
    hasPostForm = true;
  }

  return { hasPostForm, hasInputForm };
}

/** Which portal markers fired in the HTML, by signal name. */
function detectPortalMarkers(html: string): string[] {
  return PORTAL_MARKERS.filter(([, test]) => test.test(html)).map(
    ([signal]) => signal,
  );
}

/**
 * Read the response body up to {@link MAX_BODY_BYTES}, then abort the stream.
 * Returns "" if the body can't be read. We stream-and-cap rather than calling
 * `.text()` so an attacker-controlled multi-GB response can't be buffered whole.
 */
async function readCappedBody(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    // No stream (e.g. a stubbed Response); fall back to text() but still cap.
    try {
      const text = await response.text();
      return text.slice(0, MAX_BODY_BYTES);
    } catch {
      return "";
    }
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (received >= MAX_BODY_BYTES) break;
    }
    out += decoder.decode();
  } catch {
    // Partial body is still useful for detection; return what we have.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore — we're done with the stream either way
    }
  }
  return out.slice(0, MAX_BODY_BYTES);
}

/**
 * Classify a custom agency link as one of four {@link LinkCheckResult} verdicts.
 * Never throws — every failure mode (bad URL, DNS error, timeout, non-HTML,
 * empty body, bot block) maps to a typed result so the caller can render
 * advisory feedback without a try/catch.
 *
 * Heuristics & rationale:
 *  - Syntactic validation first (no network) rejects non-http(s) and hostless
 *    URLs as `invalid_url`.
 *  - A `<form method=post>` (or a form with fillable inputs on a reporting page)
 *    or a known civic-portal marker (SeeClickFix / Open311 / "submit a request"
 *    / 311) is `form_found`. POST form or SaaS portal => high confidence; a
 *    GET form that only co-occurs with portal text => medium; portal text alone
 *    (JS-rendered form not in initial HTML) => low.
 *  - A 401/403 from a gov-ish host is `form_found` at low confidence, NOT
 *    `unreachable`: real .gov reporting pages routinely 403 plain bots, and
 *    flagging those as broken would wrongly scare users off valid links.
 *  - Any other non-2xx/3xx, a DNS/connection throw, or a timeout is
 *    `unreachable`.
 *  - Reachable HTML with no form and no markers is `no_form`.
 */
export async function checkSubmittableLink(
  url: string,
  options: LinkCheckOptions = {},
): Promise<LinkCheckResult> {
  const parsed = parseHttpUrl(url);
  if (!parsed) return { status: "invalid_url" };

  const { fetchImpl, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = options;

  let response: Response;
  try {
    const init: RequestInit & { timeoutMs?: number } = {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      timeoutMs,
    };
    response = fetchImpl
      ? await fetchImpl(parsed.toString(), init)
      : await fetchWithTimeout(parsed.toString(), init);
  } catch (error) {
    if (error instanceof TimeoutError) {
      return { status: "unreachable", reason: "The link timed out." };
    }
    return {
      status: "unreachable",
      reason: "We couldn't connect to that link.",
    };
  }

  // Bot-protection on a gov-ish host: many real .gov reporting portals answer a
  // plain bot with 401/403. Don't punish those — treat as a likely form, but at
  // low confidence since we never saw the markup.
  if (
    (response.status === 401 || response.status === 403) &&
    isLikelyGovHost(parsed.hostname)
  ) {
    return {
      status: "form_found",
      confidence: "low",
      signals: ["gov_domain_bot_protected"],
    };
  }

  if (!response.ok) {
    return {
      status: "unreachable",
      reason: `The link returned an error (HTTP ${response.status}).`,
    };
  }

  const html = await readCappedBody(response);
  if (!html.trim()) {
    return {
      status: "no_form",
      reason: "The page was empty.",
    };
  }

  const { hasPostForm, hasInputForm } = detectForms(html);
  const markers = detectPortalMarkers(html);

  // High confidence: an actual POST form, or a recognized civic-portal SaaS.
  if (hasPostForm) {
    return {
      status: "form_found",
      confidence: "high",
      signals: ["post_form", ...markers],
    };
  }

  // A known reporting portal/marker on the page.
  if (markers.length > 0) {
    // A fillable (GET) form co-located with portal text is a strong-but-not-
    // POST signal; portal text without any form is likely a JS-rendered form.
    return {
      status: "form_found",
      confidence: hasInputForm ? "medium" : "low",
      signals: hasInputForm ? ["input_form", ...markers] : markers,
    };
  }

  // A fillable form with no reporting markers: could be a login/search box, so
  // medium confidence rather than high — but still a submittable form.
  if (hasInputForm) {
    return {
      status: "form_found",
      confidence: "medium",
      signals: ["input_form"],
    };
  }

  return {
    status: "no_form",
    reason: "We couldn't find a form on that page.",
  };
}
