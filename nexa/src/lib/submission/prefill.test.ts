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

  it("ignores a non-string embedded value (number) and derives instead", () => {
    const fields = buildPrefillFields(
      makeBareReport({ address: "2 Oak Ave" }),
      {
        // Only string `.value` is authoritative; a number must be ignored.
        service_address: { type: "string", value: 42 },
      },
    );

    const addr = fields.find((f) => f.key === "service_address");
    expect(addr?.value).toBe("2 Oak Ave");
  });
});

// A populated report so each derivation branch has something to surface.
function makeFullReport(overrides: Partial<PrefillReport> = {}): PrefillReport {
  return {
    description: "Pothole on Main St",
    aiDescription: "AI: deep pothole",
    address: "100 Main St, Palo Alto, CA",
    latitude: 37.4419,
    longitude: -122.143,
    imageUrl: "https://example.com/photo.jpg",
    createdAt: new Date("2026-06-09T12:00:00Z"),
    contactEmail: "reporter@example.com",
    ...overrides,
  };
}

// Convenience: derive a single field from a one-key schema.
function fieldFor(
  key: string,
  spec: Record<string, unknown>,
  report: PrefillReport,
) {
  return buildPrefillFields(report, { [key]: spec }).find((f) => f.key === key);
}

describe("buildPrefillFields — valueForKey derivation branches", () => {
  it("derives the description from report.description", () => {
    const f = fieldFor("description", { type: "string" }, makeFullReport());
    expect(f?.value).toBe("Pothole on Main St");
  });

  it("matches the details/comment/problem/issue synonyms for description", () => {
    for (const key of ["details", "comment", "problem_description", "issue"]) {
      const f = fieldFor(key, { type: "string" }, makeFullReport());
      expect(f?.value).toBe("Pothole on Main St");
    }
  });

  it("falls back to aiDescription when description is blank/whitespace", () => {
    const f = fieldFor(
      "description",
      { type: "string" },
      makeFullReport({ description: "   " }),
    );
    expect(f?.value).toBe("AI: deep pothole");
  });

  it("yields a null description when neither description is present", () => {
    const f = fieldFor("description", { type: "string" }, makeBareReport());
    expect(f?.value).toBeNull();
  });

  it("derives the address from report.address (and its synonyms)", () => {
    for (const key of ["address", "location", "intersection", "cross_street"]) {
      const f = fieldFor(key, { type: "string" }, makeFullReport());
      expect(f?.value).toBe("100 Main St, Palo Alto, CA");
    }
  });

  it("yields a null address when the report has none", () => {
    const f = fieldFor("address", { type: "string" }, makeBareReport());
    expect(f?.value).toBeNull();
  });

  it("stringifies the latitude for a lat field", () => {
    const f = fieldFor("latitude", { type: "number" }, makeFullReport());
    expect(f?.value).toBe("37.4419");
  });

  it("yields null latitude when the report has none", () => {
    const f = fieldFor("latitude", { type: "number" }, makeBareReport());
    expect(f?.value).toBeNull();
  });

  it("treats latitude 0 as present, not missing", () => {
    const f = fieldFor(
      "latitude",
      { type: "number" },
      makeBareReport({ latitude: 0 }),
    );
    expect(f?.value).toBe("0");
  });

  it("stringifies the longitude for both lon and lng spellings", () => {
    for (const key of ["longitude", "lng"]) {
      const f = fieldFor(key, { type: "number" }, makeFullReport());
      expect(f?.value).toBe("-122.143");
    }
  });

  it("yields null longitude when the report has none", () => {
    const f = fieldFor("longitude", { type: "number" }, makeBareReport());
    expect(f?.value).toBeNull();
  });

  it("treats longitude 0 as present, not missing", () => {
    const f = fieldFor(
      "lng",
      { type: "number" },
      makeBareReport({ longitude: 0 }),
    );
    expect(f?.value).toBe("0");
  });

  it("derives the contact email from report.contactEmail", () => {
    const f = fieldFor("contact_email", { type: "string" }, makeFullReport());
    expect(f?.value).toBe("reporter@example.com");
  });

  it("yields null email when the report has none", () => {
    const f = fieldFor("email", { type: "string" }, makeBareReport());
    expect(f?.value).toBeNull();
  });

  it("formats the createdAt for a datetime field (date/time synonyms)", () => {
    const createdAt = new Date("2026-06-09T12:00:00Z");
    const expected = createdAt.toLocaleString();
    for (const key of ["datetime", "date", "observation_date", "observed_at"]) {
      const f = fieldFor(
        "incident_" + key,
        { type: "string" },
        makeFullReport({ createdAt }),
      );
      expect(f?.value).toBe(expected);
    }
  });

  it("accepts an ISO string createdAt and formats it", () => {
    const f = fieldFor(
      "observation_date",
      { type: "string" },
      makeFullReport({ createdAt: "2026-06-09T12:00:00Z" }),
    );
    expect(f?.value).toBe(new Date("2026-06-09T12:00:00Z").toLocaleString());
  });
});

describe("buildPrefillFields — file/photo branch", () => {
  it("never prefills a value for a file-typed field but hints to attach", () => {
    const f = fieldFor("evidence", { type: "file" }, makeFullReport());
    expect(f?.value).toBeNull();
    expect(f?.hint).toBe("Attach the photo you uploaded to Nexa.");
  });

  it("matches photo/image/attachment keys regardless of declared type", () => {
    for (const key of ["photo", "image_url", "attachment"]) {
      const f = fieldFor(key, { type: "string" }, makeFullReport());
      expect(f?.value).toBeNull();
      expect(f?.hint).toBe("Attach the photo you uploaded to Nexa.");
    }
  });

  it("hints that no photo is attached when the report has no imageUrl", () => {
    const f = fieldFor("photo", { type: "file" }, makeBareReport());
    expect(f?.hint).toBe("No photo attached.");
  });
});

describe("buildPrefillFields — unknown / underivable field branch", () => {
  it("returns a null value and a fill-it-in hint for unknown keys", () => {
    const f = fieldFor("vehicle_make", { type: "string" }, makeFullReport());
    expect(f?.value).toBeNull();
    expect(f?.hint).toBe("You'll need to fill this in.");
  });

  it("does NOT match license_plate to latitude (whole-token matching, #234)", () => {
    // Regression for the substring quirk: license_pLATe used to contain "lat"
    // and resolve to the report latitude. With token matching it splits to
    // ["license","plate"] — neither is a latitude token — so it stays unknown.
    const f = fieldFor("license_plate", { type: "string" }, makeFullReport());
    expect(f?.value).toBeNull();
    expect(f?.hint).toBe("You'll need to fill this in.");
  });

  it("leaves the other CARB vehicle fields unfilled (no false token match)", () => {
    // template/vehicle_make/etc. must not false-match any derivation branch.
    for (const key of [
      "template",
      "vehicle_make",
      "vehicle_model",
      "vehicle_color",
      "contact_name",
    ]) {
      const f = fieldFor(key, { type: "string" }, makeFullReport());
      expect(f?.value).toBeNull();
      expect(f?.hint).toBe("You'll need to fill this in.");
    }
  });

  it("keeps the real CARB form-field keys mapping correctly", () => {
    // Pin every derivable key from the CARB VEHICLE_EMISSIONS schema.
    const report = makeFullReport();
    expect(
      fieldFor("observation_location", { type: "string" }, report)?.value,
    ).toBe("100 Main St, Palo Alto, CA");
    expect(
      fieldFor("observation_datetime", { type: "datetime" }, report)?.value,
    ).toBe(new Date(report.createdAt as Date).toLocaleString());
    // And the keys from the SeeClickFix-style schema.
    expect(
      fieldFor("location_address", { type: "string" }, report)?.value,
    ).toBe("100 Main St, Palo Alto, CA");
    expect(fieldFor("latitude", { type: "number" }, report)?.value).toBe(
      "37.4419",
    );
    expect(fieldFor("longitude", { type: "number" }, report)?.value).toBe(
      "-122.143",
    );
    expect(fieldFor("contact_email", { type: "string" }, report)?.value).toBe(
      "reporter@example.com",
    );
    expect(fieldFor("description", { type: "string" }, report)?.value).toBe(
      "Pothole on Main St",
    );
  });
});

describe("buildPrefillFields — schema parsing, labels, ordering", () => {
  it("returns an empty list for a null/non-object schema", () => {
    expect(buildPrefillFields(makeFullReport(), null)).toEqual([]);
    expect(buildPrefillFields(makeFullReport(), undefined)).toEqual([]);
    expect(buildPrefillFields(makeFullReport(), "not-an-object")).toEqual([]);
    expect(buildPrefillFields(makeFullReport(), 7)).toEqual([]);
  });

  it("defaults the type to 'string' when the spec omits or mistypes it", () => {
    const fields = buildPrefillFields(makeFullReport(), {
      foo: {},
      bar: { type: 99 },
    });
    expect(fields.every((f) => f.type === "string")).toBe(true);
  });

  it("tolerates a null/non-object field spec", () => {
    const fields = buildPrefillFields(makeFullReport(), {
      description: null,
    });
    const f = fields.find((field) => field.key === "description");
    // null spec → defaults (type string, not required) → derives description.
    expect(f?.required).toBe(false);
    expect(f?.value).toBe("Pothole on Main St");
  });

  it("humanizes keys: underscores/dashes to spaces, first letter capitalized", () => {
    const fields = buildPrefillFields(makeFullReport(), {
      location_address: { type: "string" },
      "cross-street": { type: "string" },
    });
    expect(fields.find((f) => f.key === "location_address")?.label).toBe(
      "Location address",
    );
    expect(fields.find((f) => f.key === "cross-street")?.label).toBe(
      "Cross street",
    );
  });

  it("marks required only when the spec sets required === true", () => {
    const fields = buildPrefillFields(makeFullReport(), {
      a: { type: "string", required: true },
      b: { type: "string", required: false },
      c: { type: "string", required: "yes" },
    });
    expect(fields.find((f) => f.key === "a")?.required).toBe(true);
    expect(fields.find((f) => f.key === "b")?.required).toBe(false);
    // Only a strict boolean true counts as required.
    expect(fields.find((f) => f.key === "c")?.required).toBe(false);
  });

  it("sorts required fields ahead of optional ones", () => {
    const fields = buildPrefillFields(makeFullReport(), {
      optional_one: { type: "string" },
      required_one: { type: "string", required: true },
      optional_two: { type: "string" },
      required_two: { type: "string", required: true },
    });
    expect(fields.map((f) => f.required)).toEqual([true, true, false, false]);
  });
});
