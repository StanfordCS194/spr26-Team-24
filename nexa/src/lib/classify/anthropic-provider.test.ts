import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";

import { classifyWithAnthropic } from "./anthropic-provider";

// `classifyWithAnthropic` constructs `new Anthropic(...)` and calls
// `.messages.create()`. Mock the SDK so no network/key is used and we can drive
// every media-type, response-parsing, and error branch from the test.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

/** Build the Anthropic response shape the provider reads. */
function reply(blocks: Array<{ type: string; text?: string }>) {
  return { content: blocks };
}

/** A text block carrying well-formed classification JSON. */
function textReply(text: string) {
  return reply([{ type: "text", text }]);
}

function validJson() {
  return JSON.stringify(classificationResult);
}

describe("classifyWithAnthropic", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("parses a well-formed text block and tags provider + latency", async () => {
    // Arrange
    createMock.mockResolvedValue(textReply(validJson()));

    // Act
    const result = await classifyWithAnthropic("a pothole", null);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.provider).toBe("anthropic/claude-haiku-4-5");
    expect(typeof result.latencyMs).toBe("number");
  });

  it("appends the description to the text prompt and omits the image block when text-only", async () => {
    // Arrange
    createMock.mockResolvedValue(textReply(validJson()));

    // Act
    await classifyWithAnthropic("trash near the curb", null);

    // Assert: no image content block, description folded into the text block.
    const arg = createMock.mock.calls[0][0];
    const content = arg.messages[0].content;
    expect(content.some((b: { type: string }) => b.type === "image")).toBe(
      false,
    );
    expect(JSON.stringify(content)).toContain("trash near the curb");
  });

  it("uses the default prompt with no description (empty/whitespace input)", async () => {
    // Arrange: whitespace -> formatUserDescription returns "" (no append).
    createMock.mockResolvedValue(textReply(validJson()));

    // Act
    await classifyWithAnthropic("   ", null);

    // Assert
    const arg = createMock.mock.calls[0][0];
    const text = arg.messages[0].content.find(
      (b: { type: string }) => b.type === "text",
    ).text;
    expect(text).toContain("civic issue classifier");
    expect(text).not.toContain("USER_DESCRIPTION");
  });

  it("honors an override prompt", async () => {
    // Arrange
    createMock.mockResolvedValue(textReply(validJson()));

    // Act
    await classifyWithAnthropic("", null, { prompt: "OVERRIDE_PROMPT_Y" });

    // Assert
    const text = createMock.mock.calls[0][0].messages[0].content[0].text;
    expect(text).toContain("OVERRIDE_PROMPT_Y");
    expect(text).not.toContain("civic issue classifier");
  });

  it.each([
    ["data:image/png;base64,QUJD", "image/png", "QUJD"],
    ["data:image/gif;base64,QUJD", "image/gif", "QUJD"],
    ["data:image/webp;base64,QUJD", "image/webp", "QUJD"],
    ["data:image/jpeg;base64,QUJD", "image/jpeg", "QUJD"],
    // No recognized prefix -> jpeg default, and stripDataUrlPrefix is a no-op.
    ["QUJDRA==", "image/jpeg", "QUJDRA=="],
  ])(
    "maps %s to media_type %s on the image block",
    async (input, expectedType, expectedData) => {
      // Arrange
      createMock.mockResolvedValue(textReply(validJson()));

      // Act
      await classifyWithAnthropic("", input);

      // Assert
      const arg = createMock.mock.calls[0][0];
      const imageBlock = arg.messages[0].content.find(
        (b: { type: string }) => b.type === "image",
      );
      expect(imageBlock).toBeTruthy();
      expect(imageBlock.source.media_type).toBe(expectedType);
      // Data URL prefix is stripped down to the raw base64 payload.
      expect(imageBlock.source.data).toBe(expectedData);
    },
  );

  it("defaults raw to {} when the first block is not a text block", async () => {
    // Arrange: a non-text leading block -> raw becomes "{}" -> schema error.
    createMock.mockResolvedValue(reply([{ type: "tool_use" }]));

    // Act / Assert
    await expect(classifyWithAnthropic("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("defaults raw to {} when content is empty", async () => {
    // Arrange: no blocks -> optional chaining -> "{}".
    createMock.mockResolvedValue(reply([]));

    // Act / Assert
    await expect(classifyWithAnthropic("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a schema error on a malformed (missing-field) response", async () => {
    // Arrange: aiDescription is the wrong type.
    createMock.mockResolvedValue(
      textReply(JSON.stringify({ ...classificationResult, aiDescription: 5 })),
    );

    // Act / Assert
    await expect(classifyWithAnthropic("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a SyntaxError when the reply contains no JSON object", async () => {
    // Arrange
    createMock.mockResolvedValue(textReply("not json"));

    // Act / Assert
    await expect(classifyWithAnthropic("x", null)).rejects.toThrow(SyntaxError);
  });

  it("propagates SDK errors (timeout/exception) to the caller", async () => {
    // Arrange
    createMock.mockRejectedValue(new Error("anthropic timeout"));

    // Act / Assert
    await expect(
      classifyWithAnthropic("x", "data:image/png;base64,QUJD"),
    ).rejects.toThrow("anthropic timeout");
  });
});
