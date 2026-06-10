import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Observation, observeImage, renderObservation } from "./observe";

// `observeImage` constructs `new OpenAI(...)` and calls
// `.chat.completions.create()`. We mock the SDK so no network/LLM call happens
// and so we can drive `parseObservation` (private) through its only caller by
// controlling the raw model content it returns.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

/** Build the SDK response shape `observeImage` reads. */
function reply(content: string | null) {
  return { choices: [{ message: { content } }] };
}

describe("observeImage (parseObservation behavior)", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("parses a bare JSON observation", async () => {
    // Arrange
    createMock.mockResolvedValue(
      reply(
        JSON.stringify({
          objects: ["pothole"],
          conditions: ["cracked asphalt"],
          hazards: ["trip hazard"],
          scene: "A pothole in the road.",
        }),
      ),
    );

    // Act
    const obs = await observeImage("data:image/jpeg;base64,xxx");

    // Assert
    expect(obs.objects).toEqual(["pothole"]);
    expect(obs.conditions).toEqual(["cracked asphalt"]);
    expect(obs.hazards).toEqual(["trip hazard"]);
    expect(obs.scene).toBe("A pothole in the road.");
    expect(typeof obs.latencyMs).toBe("number");
  });

  it("parses a ```json fenced observation and ignores surrounding prose", async () => {
    // Arrange
    const json = JSON.stringify({
      objects: ["sedan"],
      conditions: [],
      hazards: [],
      scene: "A car idling.",
    });
    createMock.mockResolvedValue(reply("Sure!\n```json\n" + json + "\n```\n"));

    // Act
    const obs = await observeImage("data:image/jpeg;base64,xxx");

    // Assert
    expect(obs.objects).toEqual(["sedan"]);
    expect(obs.scene).toBe("A car idling.");
  });

  it("extracts the object via brace bounds when extra text surrounds it", async () => {
    // Arrange
    createMock.mockResolvedValue(
      reply('noise {"objects":["x"],"scene":"s"} trailing'),
    );

    // Act
    const obs = await observeImage("data:image/jpeg;base64,xxx");

    // Assert
    expect(obs.objects).toEqual(["x"]);
    expect(obs.scene).toBe("s");
  });

  it("throws on a wrong-shaped field instead of coercing it to empty", async () => {
    // Arrange: objects is a string, hazards a number — previously these were
    // silently coerced to [], masking an upstream model failure. They must now
    // fail traceably at the boundary.
    createMock.mockResolvedValue(
      reply(JSON.stringify({ objects: "nope", hazards: 3, scene: "s" })),
    );

    // Act / Assert
    await expect(observeImage("data:image/jpeg;base64,xxx")).rejects.toThrow(
      /invalid observation response/i,
    );
  });

  it("throws on non-string array elements instead of stringifying them", async () => {
    // Arrange: the array must contain strings — no String() coercion now.
    createMock.mockResolvedValue(
      reply(JSON.stringify({ objects: [1, true, null], scene: "s" })),
    );

    // Act / Assert
    await expect(observeImage("data:image/jpeg;base64,xxx")).rejects.toThrow(
      /invalid observation response/i,
    );
  });

  it("throws when scene is present but not a string", async () => {
    // Arrange: a non-string scene is malformed, not an empty scene.
    createMock.mockResolvedValue(reply(JSON.stringify({ scene: 99 })));

    // Act / Assert
    await expect(observeImage("data:image/jpeg;base64,xxx")).rejects.toThrow(
      /invalid observation response/i,
    );
  });

  it("treats missing keys as a legitimate empty observation (blurry/empty image)", async () => {
    // Arrange: the prompt permits empty arrays / scene for an empty image, and
    // null content defaults raw to "{}" — every key missing is valid, so the
    // schema fills defaults rather than throwing.
    createMock.mockResolvedValue(reply(null));

    // Act
    const obs = await observeImage("data:image/jpeg;base64,xxx");

    // Assert
    expect(obs).toMatchObject({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
    });
  });

  it("throws SyntaxError when the response contains no JSON object", async () => {
    // Arrange
    createMock.mockResolvedValue(reply("no json at all"));

    // Act / Assert
    await expect(observeImage("data:image/jpeg;base64,xxx")).rejects.toThrow(
      SyntaxError,
    );
  });

  it("throws SyntaxError when braces are reversed", async () => {
    // Arrange
    createMock.mockResolvedValue(reply("} a {"));

    // Act / Assert
    await expect(observeImage("data:image/jpeg;base64,xxx")).rejects.toThrow(
      SyntaxError,
    );
  });

  it("appends the user description as a hint when provided", async () => {
    // Arrange
    createMock.mockResolvedValue(reply(JSON.stringify({ scene: "s" })));

    // Act
    await observeImage("data:image/jpeg;base64,xxx", "a pothole near the curb");

    // Assert: the description is forwarded into the request content parts.
    const arg = createMock.mock.calls[0][0];
    const serialized = JSON.stringify(arg);
    expect(serialized).toContain("a pothole near the curb");
  });
});

describe("renderObservation", () => {
  const full: Observation = {
    objects: ["pothole", "sedan"],
    conditions: ["cracked asphalt"],
    hazards: ["trip hazard"],
    scene: "A pothole in the road.",
    latencyMs: 100,
  };

  it("returns empty string for null", () => {
    expect(renderObservation(null)).toBe("");
  });

  it("prefixes the block with the Stage-1 header", () => {
    // Act
    const out = renderObservation(full);

    // Assert
    expect(out.startsWith("\nStage-1 visual observations:")).toBe(true);
  });

  it("formats scene, objects, conditions, and hazards lines", () => {
    // Act
    const out = renderObservation(full);

    // Assert
    expect(out).toContain("  Scene: A pothole in the road.");
    expect(out).toContain("  Objects: pothole, sedan");
    expect(out).toContain("  Conditions: cracked asphalt");
    expect(out).toContain("  Hazards: trip hazard");
  });

  it("excludes empty arrays and empty scene", () => {
    // Arrange
    const sparse: Observation = {
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 5,
    };

    // Act
    const out = renderObservation(sparse);

    // Assert: only the header line remains.
    expect(out).toBe("\nStage-1 visual observations:");
    expect(out).not.toContain("Scene:");
    expect(out).not.toContain("Objects:");
  });
});
