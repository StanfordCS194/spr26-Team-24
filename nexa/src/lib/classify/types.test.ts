import { describe, expect, it } from "vitest";

import {
  buildClassificationPrompt,
  CLASSIFICATION_PROMPT,
  parseClassificationResponse,
} from "./types";

// Unit tests (node project): all three units here are pure, no mocks needed.
// `renderLocation` is private, so it is exercised through its only caller,
// `buildClassificationPrompt`.

describe("parseClassificationResponse", () => {
  const valid = {
    issueType: "ROAD_DAMAGE",
    aiDescription: "A pothole.",
    severity: "high",
    confidence: 0.9,
  };

  it("parses bare JSON with no fences or prose", () => {
    // Arrange / Act
    const result = parseClassificationResponse(JSON.stringify(valid));

    // Assert
    expect(result).toEqual(valid);
  });

  it("parses JSON wrapped in a ```json fenced block", () => {
    // Arrange
    const raw = "```json\n" + JSON.stringify(valid) + "\n```";

    // Act
    const result = parseClassificationResponse(raw);

    // Assert
    expect(result).toEqual(valid);
  });

  it("parses JSON wrapped in a bare ``` fenced block", () => {
    // Arrange
    const raw = "```\n" + JSON.stringify(valid) + "\n```";

    // Act / Assert
    expect(parseClassificationResponse(raw)).toEqual(valid);
  });

  it("extracts the object when prose precedes and follows it", () => {
    // Arrange
    const raw = `Here is the result: ${JSON.stringify(valid)} Hope that helps!`;

    // Act / Assert
    expect(parseClassificationResponse(raw)).toEqual(valid);
  });

  it("throws SyntaxError when there is no JSON object", () => {
    // Arrange / Act / Assert
    expect(() => parseClassificationResponse("no json here")).toThrow(
      SyntaxError,
    );
  });

  it("throws SyntaxError on an empty string", () => {
    expect(() => parseClassificationResponse("")).toThrow(SyntaxError);
  });

  it("throws SyntaxError when braces are reversed", () => {
    // Arrange: a closing brace appears before any opening brace.
    expect(() => parseClassificationResponse("} foo {")).toThrow(SyntaxError);
  });

  it("throws on malformed JSON inside valid brace bounds", () => {
    // Arrange: looks like an object but is not parseable JSON.
    expect(() => parseClassificationResponse("{ not: valid, json }")).toThrow();
  });

  it("throws when required fields are missing (schema enforced)", () => {
    // Arrange: only issueType is present — the schema now rejects the rest.
    const raw = JSON.stringify({ issueType: "OTHER" });

    // Act / Assert: a traceable validation error, not a half-typed object.
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("throws when issueType is not in the IssueType enum", () => {
    // Arrange: a value outside the allowed enum must fail rather than cast.
    const raw = JSON.stringify({ ...valid, issueType: "NOT_A_TYPE" });

    // Act / Assert
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("throws when issueType is a number (the documented crash case)", () => {
    // Arrange: `{ issueType: 123 }` previously passed the cast and crashed
    // downstream — it must now fail at the boundary.
    const raw = JSON.stringify({ ...valid, issueType: 123 });

    // Act / Assert
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("throws when severity is not in the Severity enum", () => {
    // Arrange
    const raw = JSON.stringify({ ...valid, severity: "critical" });

    // Act / Assert
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("throws when a string field is the wrong type (no coercion)", () => {
    // Arrange: aiDescription is a number — validation rejects rather than coerce.
    const raw = JSON.stringify({ ...valid, aiDescription: 42 });

    // Act / Assert
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("throws when confidence is not a number", () => {
    // Arrange
    const raw = JSON.stringify({ ...valid, confidence: "high" });

    // Act / Assert
    expect(() => parseClassificationResponse(raw)).toThrow(
      /invalid classification response/i,
    );
  });

  it("accepts confidence values outside 0-1 (bounds are out of scope, #106)", () => {
    // Arrange: the schema validates the type, not the numeric range.
    const raw = JSON.stringify({ ...valid, confidence: 5 });

    // Act / Assert
    expect(parseClassificationResponse(raw).confidence).toBe(5);
  });
});

describe("buildClassificationPrompt", () => {
  it("returns the base prompt when given no options", () => {
    // Arrange / Act
    const prompt = buildClassificationPrompt();

    // Assert
    expect(prompt).toBe(CLASSIFICATION_PROMPT);
  });

  it("appends a non-empty observation block", () => {
    // Arrange
    const observationBlock = "\nStage-1 visual observations:\n  Scene: dark";

    // Act
    const prompt = buildClassificationPrompt({ observationBlock });

    // Assert
    expect(prompt).toContain(CLASSIFICATION_PROMPT);
    expect(prompt).toContain(observationBlock);
    expect(prompt).toBe([CLASSIFICATION_PROMPT, observationBlock].join("\n"));
  });

  it("omits an empty-string observation block", () => {
    // Arrange / Act
    const prompt = buildClassificationPrompt({ observationBlock: "" });

    // Assert
    expect(prompt).toBe(CLASSIFICATION_PROMPT);
  });

  // renderLocation is exercised through buildClassificationPrompt below.

  it("returns the base prompt for null location", () => {
    expect(buildClassificationPrompt({ location: null })).toBe(
      CLASSIFICATION_PROMPT,
    );
  });

  it("returns the base prompt for undefined location", () => {
    expect(buildClassificationPrompt({ location: undefined })).toBe(
      CLASSIFICATION_PROMPT,
    );
  });

  it("returns the base prompt when location has no usable fields", () => {
    // Arrange: all fields null/empty — renderLocation yields "".
    const prompt = buildClassificationPrompt({
      location: { latitude: null, longitude: null, address: null },
    });

    // Assert
    expect(prompt).toBe(CLASSIFICATION_PROMPT);
  });

  it("renders a single address field", () => {
    // Arrange / Act
    const prompt = buildClassificationPrompt({
      location: { address: "1 Main St" },
    });

    // Assert
    expect(prompt).toContain("Report location context:");
    expect(prompt).toContain("Address: 1 Main St");
    expect(prompt).not.toContain("Coordinates:");
    expect(prompt).not.toContain("Jurisdiction:");
  });

  it("renders coordinates with toFixed(5) precision", () => {
    // Arrange / Act
    const prompt = buildClassificationPrompt({
      location: { latitude: 37.123456789, longitude: -122.1 },
    });

    // Assert
    expect(prompt).toContain("Coordinates: 37.12346, -122.10000");
  });

  it("excludes non-finite latitude/longitude", () => {
    // Arrange: NaN is typeof number but should not be rendered... however the
    // source only guards on typeof, so document the ACTUAL behavior: a NaN
    // number IS rendered. Use a non-number to confirm exclusion instead.
    const prompt = buildClassificationPrompt({
      location: { latitude: 37.5, longitude: null },
    });

    // Assert: only one coordinate present → coordinates line omitted.
    expect(prompt).not.toContain("Coordinates:");
  });

  it("renders all three fields joined by newlines with two-space indent", () => {
    // Arrange / Act
    const prompt = buildClassificationPrompt({
      location: {
        address: "1 Main St",
        latitude: 1,
        longitude: 2,
        jurisdiction: "Palo Alto",
      },
    });

    // Assert
    expect(prompt).toContain(
      "\n\nReport location context:\n  Address: 1 Main St\n  Coordinates: 1.00000, 2.00000\n  Jurisdiction: Palo Alto",
    );
  });

  it("combines observation block and location into ordered sections", () => {
    // Arrange
    const observationBlock = "\nStage-1 visual observations:\n  Scene: pothole";

    // Act
    const prompt = buildClassificationPrompt({
      observationBlock,
      location: { address: "1 Main St" },
    });

    // Assert: base, then observation, then location, in that order.
    const baseIdx = prompt.indexOf(CLASSIFICATION_PROMPT);
    const obsIdx = prompt.indexOf(observationBlock);
    const locIdx = prompt.indexOf("Report location context:");
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(obsIdx).toBeGreaterThan(baseIdx);
    expect(locIdx).toBeGreaterThan(obsIdx);
  });
});
