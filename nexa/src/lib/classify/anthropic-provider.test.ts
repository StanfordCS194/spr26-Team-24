import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { classifyWithAnthropic } from "./anthropic-provider";

// `classifyWithAnthropic` constructs `new Anthropic(...)` and calls
// `.messages.create()`. We mock the SDK module so no network/LLM call or API
// key is needed, and so we can drive response parsing/normalization by
// controlling the raw model content it returns.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

/** Build the SDK response shape `classifyWithAnthropic` reads. */
function reply(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("classifyWithAnthropic", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("normalizes a well-formed SDK response into a ProviderResult", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(JSON.stringify(classificationResult)));

    // Act
    const result = await classifyWithAnthropic("a pothole", null);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.severity).toBe(classificationResult.severity);
    expect(result.aiDescription).toBe(classificationResult.aiDescription);
    expect(result.confidence).toBe(classificationResult.confidence);
    expect(result.provider).toBe("anthropic/claude-haiku-4-5");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects with a validation error on a malformed response (bad enum)", async () => {
    // Arrange: severity is not a member of the enum, so parsing must fail
    // traceably rather than cast an invalid value through.
    createMock.mockResolvedValue(
      reply(
        JSON.stringify({
          ...classificationResult,
          severity: "catastrophic",
        }),
      ),
    );

    // Act / Assert
    await expect(classifyWithAnthropic("desc", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("rejects with a SyntaxError when the response contains no JSON object", async () => {
    // Arrange
    createMock.mockResolvedValue(reply("no json here"));

    // Act / Assert
    await expect(classifyWithAnthropic("desc", null)).rejects.toThrow(
      SyntaxError,
    );
  });

  it("passes the configured LLM timeout to the SDK", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(JSON.stringify(classificationResult)));

    // Act
    await classifyWithAnthropic("desc", null);

    // Assert: the timeout option (request-options second arg) is forwarded.
    const options = createMock.mock.calls[0][1];
    expect(options).toMatchObject({ timeout: DEFAULT_LLM_TIMEOUT_MS });
  });
});
