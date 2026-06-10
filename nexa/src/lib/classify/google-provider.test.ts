import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { classifyWithGoogle } from "./google-provider";

// `classifyWithGoogle` constructs `new GoogleGenAI(...)` and calls
// `.models.generateContent()`. We mock the SDK module so no network/LLM call or
// API key is needed, and so we can drive response parsing/normalization by
// controlling the raw `response.text` it returns.
const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

/** Build the SDK response shape `classifyWithGoogle` reads. */
function reply(text: string) {
  return { text };
}

describe("classifyWithGoogle", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("normalizes a well-formed SDK response into a ProviderResult", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(
      reply(JSON.stringify(classificationResult)),
    );

    // Act
    const result = await classifyWithGoogle("a pothole", null);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.severity).toBe(classificationResult.severity);
    expect(result.aiDescription).toBe(classificationResult.aiDescription);
    expect(result.confidence).toBe(classificationResult.confidence);
    expect(result.provider).toBe("google/gemini-2.5-flash");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects with a validation error on a malformed response (missing field)", async () => {
    // Arrange: confidence is missing, so the schema must fail traceably rather
    // than cast a partial object through as a ClassificationResult.
    const { confidence: _omit, ...withoutConfidence } = classificationResult;
    generateContentMock.mockResolvedValue(
      reply(JSON.stringify(withoutConfidence)),
    );

    // Act / Assert
    await expect(classifyWithGoogle("desc", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("rejects with a SyntaxError when the response contains no JSON object", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(reply("no json here"));

    // Act / Assert
    await expect(classifyWithGoogle("desc", null)).rejects.toThrow(SyntaxError);
  });

  it("passes the configured LLM timeout to the SDK via httpOptions", async () => {
    // Arrange
    generateContentMock.mockResolvedValue(
      reply(JSON.stringify(classificationResult)),
    );

    // Act
    await classifyWithGoogle("desc", null);

    // Assert: the timeout is nested under config.httpOptions for this SDK.
    const arg = generateContentMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      config: { httpOptions: { timeout: DEFAULT_LLM_TIMEOUT_MS } },
    });
  });
});
