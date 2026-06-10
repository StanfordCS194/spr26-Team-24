import { describe, expect, it } from "vitest";

import {
  ClassifyRequestSchema,
  CreateReportSchema,
  FormLinkRequestSchema,
  MAX_DESCRIPTION_LENGTH,
} from "./schemas";

// Bounds added in #106: coordinate ranges and description length are enforced
// in the shared schemas so every route returns the same 400 envelope instead
// of letting out-of-range data reach routing/geospatial code or the LLM prompt.

describe("CreateReportSchema coordinate bounds", () => {
  it("accepts in-range coordinates", () => {
    const result = CreateReportSchema.safeParse({
      latitude: 37.4,
      longitude: -122.1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the inclusive extremes", () => {
    expect(
      CreateReportSchema.safeParse({ latitude: 90, longitude: 180 }).success,
    ).toBe(true);
    expect(
      CreateReportSchema.safeParse({ latitude: -90, longitude: -180 }).success,
    ).toBe(true);
  });

  it("rejects latitude above 90", () => {
    const result = CreateReportSchema.safeParse({ latitude: 91 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/latitude/i);
  });

  it("rejects latitude below -90", () => {
    expect(CreateReportSchema.safeParse({ latitude: -90.1 }).success).toBe(
      false,
    );
  });

  it("rejects longitude above 180", () => {
    const result = CreateReportSchema.safeParse({ longitude: 181 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/longitude/i);
  });

  it("rejects longitude below -180", () => {
    expect(CreateReportSchema.safeParse({ longitude: -181 }).success).toBe(
      false,
    );
  });

  it("still allows omitting coordinates entirely", () => {
    expect(CreateReportSchema.safeParse({}).success).toBe(true);
  });
});

describe("CreateReportSchema description length", () => {
  it("accepts a description at the max length", () => {
    const description = "a".repeat(MAX_DESCRIPTION_LENGTH);
    expect(CreateReportSchema.safeParse({ description }).success).toBe(true);
  });

  it("rejects a description over the max length", () => {
    const description = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
    const result = CreateReportSchema.safeParse({ description });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/description/i);
  });
});

describe("ClassifyRequestSchema bounds", () => {
  it("rejects out-of-range latitude", () => {
    expect(ClassifyRequestSchema.safeParse({ latitude: 100 }).success).toBe(
      false,
    );
  });

  it("rejects out-of-range longitude", () => {
    expect(ClassifyRequestSchema.safeParse({ longitude: 200 }).success).toBe(
      false,
    );
  });

  it("rejects an over-long description", () => {
    const description = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
    expect(ClassifyRequestSchema.safeParse({ description }).success).toBe(
      false,
    );
  });

  it("accepts in-range coordinates and a normal description", () => {
    expect(
      ClassifyRequestSchema.safeParse({
        latitude: 37.4,
        longitude: -122.1,
        description: "a pothole",
      }).success,
    ).toBe(true);
  });
});

describe("FormLinkRequestSchema bounds", () => {
  it("rejects out-of-range latitude", () => {
    expect(FormLinkRequestSchema.safeParse({ latitude: -91 }).success).toBe(
      false,
    );
  });

  it("rejects out-of-range longitude", () => {
    expect(FormLinkRequestSchema.safeParse({ longitude: 181 }).success).toBe(
      false,
    );
  });

  it("accepts in-range coordinates", () => {
    expect(
      FormLinkRequestSchema.safeParse({ latitude: 0, longitude: 0 }).success,
    ).toBe(true);
  });
});
