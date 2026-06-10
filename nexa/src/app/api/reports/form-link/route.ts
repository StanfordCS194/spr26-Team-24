import { NextRequest } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { fetchWithTimeout, DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { ISSUE_TYPE_LABELS, US_STATE_CODES } from "@/lib/constants";
import { IssueType } from "@/generated/prisma/enums";
import { resolveJurisdiction } from "@/lib/jurisdictions/resolve";
import { FormLinkRequestSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import type {
  FormLookupConfidence,
  OfficialFormLookupResult,
} from "@/lib/api/types";

type LookupResult =
  | {
      status: "found";
      formUrl: string;
      reason: string;
      confidence: FormLookupConfidence;
    }
  | {
      status: "not_found";
      reason: string;
    };

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state?: string;
  county?: string;
};

/**
 * Nominatim often puts housing complexes and micro-places in `hamlet`, which is
 * not a municipality for 311 search. Prefer incorporated-style fields only.
 */
function parseFormalMunicipality(
  address: NominatimAddress | undefined,
): string | null {
  if (!address) return null;
  return (
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    null
  );
}

const LOOKUP_SYSTEM_PROMPT = `You help find the official city webpage a resident should use to report a civic issue.

Rules:
- You MUST use the web_search tool. Do not answer from memory.
- Search queries should target the specific city's official government website (e.g. "City of Palo Alto report an issue 311").
- The result is "found" as long as the URL is on the official city government website (typically a *.gov, *.us, or the city's official domain) and the page is a place residents use to report civic issues. This includes general 311 / Report-an-Issue / service-request portals that cover many issue types.
- You DO NOT need a separate form for each issue type. If the city uses a unified 311 / Report-an-Issue page that residents use for things like potholes, streetlights, dumping, etc., return THAT page.
- Exclude county, state, federal, private, non-profit, news, and third-party sites.
- Only return "not_found" if no official city government reporting / 311 page exists for this city. Do NOT return "not_found" just because there is no issue-type-specific page.
- Use "high" confidence when the page is clearly the city's 311 / Report-an-Issue page. Use "medium" for the city's general services page if no 311 page is visible. Use "low" only when uncertain.
- Reply with a single JSON object only (no prose, no markdown fences) matching this shape:
{
  "status": "found" | "not_found",
  "formUrl": string | null,
  "reason": string,
  "confidence": "low" | "medium" | "high"
}

Example: For Palo Alto, "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311" is the correct unified 311 page and should be returned for any civic issue type, including road damage.`;

/**
 * Accepts only URLs hosted on an official US government domain. Guards against
 * suffix-only bypasses that the old `endsWith(".gov"|".us")` check allowed:
 * - userinfo tricks (`https://trusted.gov@evil.us/`) resolve `hostname` to the
 *   attacker host, so any credentials in the URL are rejected outright;
 * - non-https URLs are rejected;
 * - `.us` is openly registrable (`evil.us`) and lets attackers append the label
 *   to anything (`paloalto.gov.evil.us`), so `.us` is trusted only when the
 *   registrable suffix is `<state>.us` (`paloalto.ca.us`);
 * - `.gov` registration is restricted to US government entities, so an exact
 *   `.gov` TLD (with at least one label in front) stays trusted.
 */
function isOfficialCityGovUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    // Userinfo (`user:pass@host`) lets an attacker disguise the real host.
    if (parsed.username !== "" || parsed.password !== "") return false;

    const host = parsed.hostname.toLowerCase();
    const labels = host.split(".");
    if (labels.length < 2 || labels.some((label) => label === "")) {
      return false;
    }

    const tld = labels[labels.length - 1];

    // `.gov` is a restricted, government-only TLD: trust any subdomain of it.
    if (tld === "gov") return true;

    // `.us` only when the registrable suffix is `<state-code>.us`.
    if (tld === "us" && labels.length >= 3) {
      return US_STATE_CODES.has(labels[labels.length - 2]);
    }

    return false;
  } catch {
    return false;
  }
}

/** Walk Responses API payloads when `output_text` is unset (tool-heavy responses). */
function collectResponsesAssistantText(response: unknown): string {
  if (!response || typeof response !== "object") return "";

  const r = response as {
    output_text?: string | null;
    output?: unknown[];
  };

  const direct = typeof r.output_text === "string" ? r.output_text.trim() : "";
  if (direct) return direct;

  const chunks: string[] = [];
  for (const item of r.output ?? []) {
    if (!item || typeof item !== "object") continue;
    const o = item as { type?: string; content?: unknown[] };
    if (o.type !== "message" || !Array.isArray(o.content)) continue;
    for (const block of o.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; text?: string };
      if (
        (b.type === "output_text" || b.type === "text") &&
        typeof b.text === "string"
      ) {
        chunks.push(b.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

/** First balanced `{ … }` at `start`, respecting JSON `"` strings. */
function sliceBalancedJsonObject(
  content: string,
  start: number,
): string | null {
  if (content[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

function extractFormLookupJson(raw: string): string | null {
  let text = raw.replace(/\uFEFF/g, "").trim();

  const fenceMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/i) ??
    text.match(/```\s*([\s\S]*?)```/i);
  text = fenceMatch ? fenceMatch[1].trim() : text;

  text = text.replace(/\u3010[^\u3011]*\u3011/g, "");

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const blob = sliceBalancedJsonObject(text, i);
    if (!blob) continue;
    try {
      const probe = JSON.parse(blob) as { status?: string };
      if (probe.status === "found" || probe.status === "not_found") {
        return blob;
      }
    } catch {
      //
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

type ResolvedLocation = {
  cityName: string | null;
  stateName: string | null;
  latitude: number | null;
  longitude: number | null;
};

const EMPTY_LOCATION: ResolvedLocation = {
  cityName: null,
  stateName: null,
  latitude: null,
  longitude: null,
};

async function reverseLookupCity(
  latitude: number,
  longitude: number,
): Promise<ResolvedLocation> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${latitude}&lon=${longitude}`,
      {
        headers: { "User-Agent": "Nexa civic form lookup" },
        cache: "no-store",
      },
    );
  } catch {
    // A slow/hung geocoder must not stall the whole form-link request; treat
    // it as an unresolved location and let the caller fall back.
    return { ...EMPTY_LOCATION, latitude, longitude };
  }

  if (!response.ok) {
    return { ...EMPTY_LOCATION, latitude, longitude };
  }

  const data = (await response.json()) as { address?: NominatimAddress };
  return {
    cityName: parseFormalMunicipality(data.address),
    stateName: data.address?.state ?? null,
    latitude,
    longitude,
  };
}

async function geocodeAddress(address: string): Promise<ResolvedLocation> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(address)}`,
      {
        headers: { "User-Agent": "Nexa civic form lookup" },
        cache: "no-store",
      },
    );
  } catch {
    return EMPTY_LOCATION;
  }

  if (!response.ok) return EMPTY_LOCATION;

  const data = (await response.json()) as Array<{
    address?: NominatimAddress;
    lat?: string;
    lon?: string;
  }>;
  const first = data[0];
  if (!first) return EMPTY_LOCATION;

  const lat = first.lat ? Number(first.lat) : NaN;
  const lon = first.lon ? Number(first.lon) : NaN;
  return {
    cityName: parseFormalMunicipality(first.address),
    stateName: first.address?.state ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

/**
 * Produces lat/lon (used by the polygon resolver) and a city/state pair (used
 * by the LLM fallback). When coords are supplied we still forward-geocode the
 * typed address as a fallback for filling in city/state.
 */
async function resolveLocation(
  address: string | undefined,
  latitude: number | undefined,
  longitude: number | undefined,
): Promise<ResolvedLocation> {
  let base: ResolvedLocation = EMPTY_LOCATION;

  if (typeof latitude === "number" && typeof longitude === "number") {
    base = await reverseLookupCity(latitude, longitude);
  }

  if (!base.cityName && address?.trim()) {
    const forward = await geocodeAddress(address.trim());
    base = {
      cityName: base.cityName ?? forward.cityName,
      stateName: base.stateName ?? forward.stateName,
      latitude: base.latitude ?? forward.latitude,
      longitude: base.longitude ?? forward.longitude,
    };
  }

  return base;
}

async function lookupOfficialForm(params: {
  cityName: string;
  stateName: string | null;
  issueType: IssueType;
  address?: string;
}): Promise<LookupResult> {
  const issueLabel = ISSUE_TYPE_LABELS[params.issueType] ?? params.issueType;
  const statePart = params.stateName ? `, ${params.stateName}` : "";

  const prompt = `Use web_search to find the official city webpage a resident should use to report a "${issueLabel}" issue in ${params.cityName}${statePart}.

Context:
- User-provided location: ${params.address ?? "not provided"}
- Issue type: ${params.issueType} (${issueLabel})

Instructions:
1. Search for the city's official 311 / Report-an-Issue / service-request portal (e.g. "${params.cityName} 311 report an issue", "${params.cityName} report a pothole official city site").
2. If the city has a single unified Report-an-Issue / 311 page that covers many civic issue types, return THAT page — even if it isn't dedicated to "${issueLabel}".
3. Confirm the page is on the official city government website (typically a *.gov, *.us, or the city's official domain). Reject county, state, federal, news, and third-party sites.
4. Reply with the JSON object described in the system instructions.

Do not say "not_found" just because there is no "${issueLabel}"-specific form — the general city 311 / Report-an-Issue page is the correct answer in that case.`;

  const client = getOpenAI();
  const response = await client.responses.create(
    {
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: LOOKUP_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      tools: [{ type: "web_search_preview" }],
      tool_choice: { type: "web_search_preview" },
    },
    { timeout: DEFAULT_LLM_TIMEOUT_MS },
  );

  const raw = collectResponsesAssistantText(response);
  if (!raw) {
    return {
      status: "not_found",
      reason: "Search response was empty.",
    };
  }

  const jsonText = extractFormLookupJson(raw);
  if (!jsonText) {
    console.warn("Form lookup: no JSON object in response", raw);
    return {
      status: "not_found",
      reason: "Could not parse the search response.",
    };
  }

  let parsed: {
    status?: string;
    formUrl?: string | null;
    reason?: string;
    confidence?: FormLookupConfidence;
  };

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.warn("Form lookup: invalid JSON", jsonText, error);
    return {
      status: "not_found",
      reason: "Could not parse the search response.",
    };
  }

  if (
    parsed.status === "found" &&
    typeof parsed.formUrl === "string" &&
    isOfficialCityGovUrl(parsed.formUrl)
  ) {
    return {
      status: "found",
      formUrl: parsed.formUrl,
      reason: parsed.reason ?? "Official city service-request page.",
      confidence: parsed.confidence ?? "medium",
    };
  }

  return {
    status: "not_found",
    reason:
      parsed.reason ??
      "Did not find a verifiable official city service-request page.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const { issueType, address, latitude, longitude } = await parseJsonRequest(
      request,
      FormLinkRequestSchema,
    );

    if (!issueType) {
      return errorResponse("Valid issueType is required.", 400);
    }

    const location = await resolveLocation(address, latitude, longitude);

    // 1. Curated polygon registry (deterministic). Wins when we have a
    //    verified portal for the matched jurisdiction.
    if (
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
    ) {
      const match = resolveJurisdiction(
        location.latitude,
        location.longitude,
        issueType,
      );
      if (match?.portal) {
        const result: OfficialFormLookupResult = {
          status: "found",
          cityName: match.jurisdiction.displayName,
          formUrl: match.portal.url,
          reason: match.portal.reason,
          confidence: match.portal.confidence,
        };
        return successResponse(result);
      }
      // Matched a polygon but the portal is unverified — fall through to
      // the LLM lookup using the jurisdiction display name as the hint.
      if (match && !location.cityName) {
        location.cityName = match.jurisdiction.displayName;
      }
    }

    // 2. LLM fallback for anywhere we don't have polygon coverage.
    if (!location.cityName) {
      const result: OfficialFormLookupResult = {
        status: "not_found",
        cityName: null,
        message: "No official city form found.",
        reason: "Could not determine a city from the provided location.",
      };
      return successResponse(result);
    }

    const lookup = await lookupOfficialForm({
      cityName: location.cityName,
      stateName: location.stateName,
      issueType,
      address,
    });

    if (lookup.status === "found") {
      const result: OfficialFormLookupResult = {
        status: "found",
        cityName: location.cityName,
        formUrl: lookup.formUrl,
        reason: lookup.reason,
        confidence: lookup.confidence,
      };
      return successResponse(result);
    }

    const result: OfficialFormLookupResult = {
      status: "not_found",
      cityName: location.cityName,
      message: "No official city form found.",
      reason: lookup.reason,
    };
    return successResponse(result);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Official form lookup error:", error);
    return errorResponse("Failed to look up official city form.", 500);
  }
}
