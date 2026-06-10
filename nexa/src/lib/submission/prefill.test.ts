import { describe, expect, it } from "vitest";

import { AGENCIES } from "../../../prisma/agencies";
import { buildPrefillFields, type PrefillReport } from "./prefill";

// A report with nothing useful to derive from — so the only way a value can
// appear is if it's surfaced from the agency schema's embedded `.value`.
function makeBareReport(overrides: Partial<PrefillReport> = {}): PrefillReport {
  return {
    description: null,
    aiDescription: null,
    address: null,
    latitude: null,
    longitude: null,
    imageUrl: null,
    createdAt: new Date("2026-06-09T12:00:00Z"),
    contactEmail: null,
    ...overrides,
  };
}

const CARB = AGENCIES.find((a) => a.name === "CARB Smoking Vehicle Complaint");

describe("buildPrefillFields — embedded field values (issue #193)", () => {
  it("surfaces an embedded contact_phone.value the report can't provide", () => {
    const fields = buildPrefillFields(makeBareReport(), {
      contact_phone: { type: "string", value: "(800) 242-4450" },
    });

    const phone = fields.find((f) => f.key === "contact_phone");
    expect(phone).toBeDefined();
    expect(phone?.value).toBe("(800) 242-4450");
  });

  it("surfaces the real CARB hotline so VEHICLE_EMISSIONS is submittable", () => {
    // Guard: the seed entry must exist and be PHONE-intake.
    expect(CARB).toBeDefined();
    expect(CARB?.intakeMethod).toBe("PHONE");

    const fields = buildPrefillFields(makeBareReport(), CARB!.requiredFields);
    const phone = fields.find((f) => f.key === "contact_phone");

    // The verified hotline must reach the client as a non-null copy-over value.
    expect(phone?.value).toBe("(800) 242-4450");
  });

  it("prefers an embedded value over a derived one when both could apply", () => {
    // `contact_email` would normally be derived from report.contactEmail, but an
    // embedded value is authoritative and wins.
    const fields = buildPrefillFields(
      makeBareReport({ contactEmail: "user@example.com" }),
      { contact_email: { type: "string", value: "intake@agency.gov" } },
    );

    const email = fields.find((f) => f.key === "contact_email");
    expect(email?.value).toBe("intake@agency.gov");
  });

  it("ignores a non-string or empty embedded value and falls back to derivation", () => {
    const fields = buildPrefillFields(
      makeBareReport({ address: "1 Main St" }),
      {
        observation_location: { type: "string", value: "", required: true },
      },
    );

    // Empty embedded value -> fall through to the address derivation.
    const loc = fields.find((f) => f.key === "observation_location");
    expect(loc?.value).toBe("1 Main St");
  });
});
