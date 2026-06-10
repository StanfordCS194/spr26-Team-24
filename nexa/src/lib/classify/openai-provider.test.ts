import { beforeEach, describe, expect, it, vi } from "vitest";

import { classificationResult } from "@/test/fixtures/classification";

import { classifyWithOpenAI } from "./openai-provider";

// `classifyWithOpenAI` constructs `new OpenAI(...)` and calls
// `.chat.completions.create()`. Mock the SDK so no network/key is used and we
// can drive every response-parsing and error branch by controlling the reply.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const DATA_URL = "data:image/jpeg;base64,QUJD";

/** Build the SDK response shape the provider reads. */
function reply(content: string | null | undefined) {
  return { choices: [{ message: { content } }] };
}

/** A well-formed classification JSON the schema accepts. */
function validJson() {
  return JSON.stringify(classificationResult);
}

describe("classifyWithOpenAI", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("parses a well-formed response and tags provider + latency", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    const result = await classifyWithOpenAI("a pothole", DATA_URL);

    // Assert
    expect(result.issueType).toBe(classificationResult.issueType);
    expect(result.severity).toBe(classificationResult.severity);
    expect(result.confidence).toBe(classificationResult.confidence);
    expect(result.provider).toBe("openai/gpt-4o-mini");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("includes the image_url content part when an image is supplied", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithOpenAI("a pothole", DATA_URL);

    // Assert: the request carries an image_url part with the data URL.
    const arg = createMock.mock.calls[0][0];
    const content = arg.messages[0].content;
    const imagePart = content.find(
      (p: { type: string }) => p.type === "image_url",
    );
    expect(imagePart).toBeTruthy();
    expect(imagePart.image_url.url).toBe(DATA_URL);
  });

  it("omits the image part and the description block for text-only empty input", async () => {
    // Arrange: no image, whitespace-only description -> formatUserDescription "".
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithOpenAI("   ", null);

    // Assert: only the single prompt text part remains.
    const arg = createMock.mock.calls[0][0];
    const content = arg.messages[0].content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content.some((p: { type: string }) => p.type === "image_url")).toBe(
      false,
    );
  });

  it("appends the user description as a fenced data block when provided", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithOpenAI("trash near the curb", null);

    // Assert
    const serialized = JSON.stringify(createMock.mock.calls[0][0]);
    expect(serialized).toContain("trash near the curb");
    expect(serialized).toContain("USER_DESCRIPTION");
  });

  it("uses the default prompt and forwards model/timeout settings", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithOpenAI("", null);

    // Assert: default prompt text present; second arg carries the timeout.
    const [body, opts] = createMock.mock.calls[0];
    expect(body.model).toBe("gpt-4o-mini");
    expect(JSON.stringify(body)).toContain("civic issue classifier");
    expect(typeof opts.timeout).toBe("number");
  });

  it("uses the override prompt when options.prompt is set", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(validJson()));

    // Act
    await classifyWithOpenAI("", null, { prompt: "OVERRIDE_PROMPT_X" });

    // Assert
    const serialized = JSON.stringify(createMock.mock.calls[0][0]);
    expect(serialized).toContain("OVERRIDE_PROMPT_X");
    expect(serialized).not.toContain("civic issue classifier");
  });

  it("defaults raw to {} when message content is null (parses to a thrown schema error)", async () => {
    // Arrange: null content -> "{}" -> schema rejects missing required fields.
    createMock.mockResolvedValue(reply(null));

    // Act / Assert
    await expect(classifyWithOpenAI("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("defaults raw to {} when the choices array is empty", async () => {
    // Arrange: no choices -> optional chaining yields "{}".
    createMock.mockResolvedValue({ choices: [] });

    // Act / Assert
    await expect(classifyWithOpenAI("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a schema error on a malformed (invalid enum) response", async () => {
    // Arrange: issueType is not a valid enum value.
    createMock.mockResolvedValue(
      reply(JSON.stringify({ ...classificationResult, issueType: "NOPE" })),
    );

    // Act / Assert
    await expect(classifyWithOpenAI("x", null)).rejects.toThrow(
      /invalid classification response/i,
    );
  });

  it("throws a SyntaxError when the reply contains no JSON object", async () => {
    // Arrange
    createMock.mockResolvedValue(reply("no json here"));

    // Act / Assert
    await expect(classifyWithOpenAI("x", null)).rejects.toThrow(SyntaxError);
  });

  it("propagates SDK errors (timeout/exception) to the caller", async () => {
    // Arrange: the OpenAI client rejects (e.g. APITimeoutError / network).
    createMock.mockRejectedValue(new Error("openai timeout"));

    // Act / Assert
    await expect(classifyWithOpenAI("x", DATA_URL)).rejects.toThrow(
      "openai timeout",
    );
  });
});
