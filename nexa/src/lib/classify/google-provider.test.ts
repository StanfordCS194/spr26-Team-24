import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";

import { classifyWithGoogle } from "./google-provider";

// `classifyWithGoogle` constructs `new GoogleGenAI(...)` and calls
// `.models.generateContent()`. Mock the SDK so no network/key is used and we
// can drive every mime-type, response-parsing, and error branch from the test.
const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

/** Build the Google response shape the provider reads (`response.text`). */
function reply(text: string | null | undefined) {
  return { text };
}

function validJson() {
  return JSON.stringify(classificationResult);
}

describe("classifyWithGoogle", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("parses a well-formed response and tags provider + latency", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    const result = await classifyWithGoogle("a pothole", null);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.provider).toBe("google/gemini-2.5-flash");
    expect(typeof result.latencyMs).toBe("number");
  });

  it("includes an inlineData part with the mime type derived from the data URL", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("", "data:image/png;base64,QUJD");

    // Assert
    const arg = generateContentMock.mock.calls[0][0];
    const parts = arg.contents[0].parts;
    const inline = parts.find(
      (p: Record<string, unknown>) => "inlineData" in p,
    );
    expect(inline.inlineData.mimeType).toBe("image/png");
    // Data URL prefix stripped to raw base64.
    expect(inline.inlineData.data).toBe("QUJD");
  });

  it("falls back to image/jpeg when the input has no data-URL mime prefix", async () => {
    // Arrange: bare base64 -> extractMimeType regex does not match -> default.
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("", "QUJDRA==");

    // Assert
    const arg = generateContentMock.mock.calls[0][0];
    const inline = arg.contents[0].parts.find(
      (p: Record<string, unknown>) => "inlineData" in p,
    );
    expect(inline.inlineData.mimeType).toBe("image/jpeg");
  });

  it("omits the inlineData part and the description for text-only empty input", async () => {
    // Arrange: no image, whitespace description -> only the text part remains.
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("   ", null);

    // Assert
    const parts = generateContentMock.mock.calls[0][0].contents[0].parts;
    expect(parts).toHaveLength(1);
    expect("text" in parts[0]).toBe(true);
    expect(parts.some((p: Record<string, unknown>) => "inlineData" in p)).toBe(
      false,
    );
  });

  it("appends the user description to the text part when provided", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("graffiti on the wall", null);

    // Assert
    const parts = generateContentMock.mock.calls[0][0].contents[0].parts;
    const textPart = parts.find((p: Record<string, unknown>) => "text" in p);
    expect(textPart.text).toContain("graffiti on the wall");
    expect(textPart.text).toContain("USER_DESCRIPTION");
  });

  it("uses the default prompt and forwards model + timeout config", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("", null);

    // Assert
    const arg = generateContentMock.mock.calls[0][0];
    expect(arg.model).toBe("gemini-2.5-flash");
    expect(typeof arg.config.httpOptions.timeout).toBe("number");
    const textPart = arg.contents[0].parts.find(
      (p: Record<string, unknown>) => "text" in p,
    );
    expect(textPart.text).toContain("civic issue classifier");
  });

  it("honors an override prompt", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithGoogle("", null, { prompt: "OVERRIDE_PROMPT_Z" });

    // Assert
    const textPart =
      generateContentMock.mock.calls[0][0].contents[0].parts.find(
        (p: Record<string, unknown>) => "text" in p,
      );
    expect(textPart.text).toContain("OVERRIDE_PROMPT_Z");
    expect(textPart.text).not.toContain("civic issue classifier");
  });

  it("defaults raw to {} when response.text is null (schema error)", async () => {
    // Arrange: null text -> "{}" -> schema rejects missing required fields.
    generateContentMock.mockResolvedValue(reply(null));

    // Act / Assert
    await expect(classifyWithGoogle("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a schema error on a malformed (invalid severity) response", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(
      reply(JSON.stringify({ ...classificationResult, severity: "extreme" })),
    );

    // Act / Assert
    await expect(classifyWithGoogle("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a SyntaxError when the reply contains no JSON object", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply("plain prose, no json"));

    // Act / Assert
    await expect(classifyWithGoogle("x", null)).rejects.toThrow(SyntaxError);
  });

  it("propagates SDK errors (timeout/exception) to the caller", async () => {
    // Arrange
    generateContentMock.mockRejectedValue(new Error("google timeout"));

    // Act / Assert
    await expect(
      classifyWithGoogle("x", "data:image/jpeg;base64,QUJD"),
    ).rejects.toThrow("google timeout");
  });
});
