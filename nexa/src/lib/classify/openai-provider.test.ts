import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { classifyWithOpenAI } from "./openai-provider";

// `classifyWithOpenAI` constructs `new OpenAI(...)` and calls
// `.chat.completions.create()`. We mock the SDK module so no network/LLM call
// or API key is needed, and so we can drive response parsing/normalization by
// controlling the raw model content it returns.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

/** Build the SDK response shape `classifyWithOpenAI` reads. */
function reply(content: string | null) {
  return { choices: [{ message: { content } }] };
}

describe("classifyWithOpenAI", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("normalizes a well-formed SDK response into a ProviderResult", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(JSON.stringify(classificationResult)));

    // Act
    const result = await classifyWithOpenAI("a pothole", null);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.severity).toBe(classificationResult.severity);
    expect(result.aiDescription).toBe(classificationResult.aiDescription);
    expect(result.confidence).toBe(classificationResult.confidence);
    expect(result.provider).toBe("openai/gpt-4o-mini");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects with a validation error on a malformed response (bad enum)", async () => {
    // Arrange: issueType is not a member of the enum, so parsing must fail
    // traceably rather than cast an invalid value through.
    createMock.mockResolvedValue(
      reply(
        JSON.stringify({
          ...classificationResult,
          issueType: "NOT_A_REAL_TYPE",
        }),
      ),
    );

    // Act / Assert
    await expect(classifyWithOpenAI("desc", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("rejects with a SyntaxError when the response contains no JSON object", async () => {
    // Arrange
    createMock.mockResolvedValue(reply("no json here"));

    // Act / Assert
    await expect(classifyWithOpenAI("desc", null)).rejects.toThrow(SyntaxError);
  });

  it("passes the configured LLM timeout to the SDK", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(JSON.stringify(classificationResult)));

    // Act
    await classifyWithOpenAI("desc", null);

    // Assert: the timeout option (request-options second arg) is forwarded.
    const options = createMock.mock.calls[0][1];
    expect(options).toMatchObject({ timeout: DEFAULT_LLM_TIMEOUT_MS });
  });
});
