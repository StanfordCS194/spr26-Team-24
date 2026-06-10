import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderResult } from "./types";

// The four private pure helpers (safeCall, toClassification, pickWinner,
// mergeLocation) are exercised through the only exported caller,
// `classifyWithConsensus`. We mock the three providers plus preprocess/observe
// so no real LLM, image-decode, or network access occurs.

const openaiMock = vi.fn();
const anthropicMock = vi.fn();
const googleMock = vi.fn();
const preprocessImageMock = vi.fn();
const observeImageMock = vi.fn();

vi.mock("./openai-provider", () => ({
  classifyWithOpenAI: (...a: unknown[]) => openaiMock(...a),
}));
vi.mock("./anthropic-provider", () => ({
  classifyWithAnthropic: (...a: unknown[]) => anthropicMock(...a),
}));
vi.mock("./google-provider", () => ({
  classifyWithGoogle: (...a: unknown[]) => googleMock(...a),
}));
vi.mock("./preprocess", () => ({
  preprocessImage: (...a: unknown[]) => preprocessImageMock(...a),
}));
vi.mock("./observe", async (importOriginal) => {
  // Keep the real renderObservation (pure); only stub observeImage (the I/O).
  const actual = await importOriginal<typeof import("./observe")>();
  return {
    ...actual,
    observeImage: (...a: unknown[]) => observeImageMock(...a),
  };
});

// Imported AFTER the mocks are registered (vi.mock is hoisted anyway).
import { classifyWithConsensus } from "./consensus";

/** Build a ProviderResult with sensible defaults. */
function makeProvider(over: Partial<ProviderResult> = {}): ProviderResult {
  return {
    issueType: "ROAD_DAMAGE",
    aiDescription: "A pothole.",
    severity: "high",
    confidence: 0.9,
    provider: "openai",
    latencyMs: 100,
    ...over,
  };
}

beforeEach(() => {
  openaiMock.mockReset();
  anthropicMock.mockReset();
  googleMock.mockReset();
  preprocessImageMock.mockReset();
  observeImageMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyWithConsensus — voting (pickWinner)", () => {
  type Scenario = {
    name: string;
    types: [string, string, string];
    confidences: [number, number, number];
    expectedMethod: string;
    expectedConsensus: boolean;
    expectedWinnerType: string;
  };

  const scenarios: Scenario[] = [
    {
      name: "unanimous picks the highest-confidence agreeing result",
      types: ["ROAD_DAMAGE", "ROAD_DAMAGE", "ROAD_DAMAGE"],
      confidences: [0.7, 0.95, 0.8],
      expectedMethod: "unanimous",
      expectedConsensus: true,
      expectedWinnerType: "ROAD_DAMAGE",
    },
    {
      name: "majority picks the most-voted type's best result",
      types: ["ROAD_DAMAGE", "ROAD_DAMAGE", "OTHER"],
      confidences: [0.6, 0.7, 0.99],
      expectedMethod: "majority",
      expectedConsensus: true,
      expectedWinnerType: "ROAD_DAMAGE",
    },
    {
      name: "highest-confidence breaks a three-way tie with no majority",
      types: ["ROAD_DAMAGE", "OTHER", "ILLEGAL_DUMPING"],
      confidences: [0.5, 0.91, 0.4],
      expectedMethod: "highest-confidence",
      expectedConsensus: false,
      expectedWinnerType: "OTHER",
    },
  ];

  it.each(scenarios)(
    "$name",
    async ({
      types,
      confidences,
      expectedMethod,
      expectedConsensus,
      expectedWinnerType,
    }) => {
      // Arrange
      openaiMock.mockResolvedValue(
        makeProvider({
          provider: "openai",
          issueType: types[0] as ProviderResult["issueType"],
          confidence: confidences[0],
        }),
      );
      anthropicMock.mockResolvedValue(
        makeProvider({
          provider: "anthropic",
          issueType: types[1] as ProviderResult["issueType"],
          confidence: confidences[1],
        }),
      );
      googleMock.mockResolvedValue(
        makeProvider({
          provider: "google",
          issueType: types[2] as ProviderResult["issueType"],
          confidence: confidences[2],
        }),
      );

      // Act
      const result = await classifyWithConsensus("desc", null);

      // Assert
      expect(result.method).toBe(expectedMethod);
      expect(result.consensus).toBe(expectedConsensus);
      expect(result.winner.issueType).toBe(expectedWinnerType);
      expect(result.allResults).toHaveLength(3);
    },
  );

  it("breaks an exact confidence tie deterministically by provider name, not call order", async () => {
    // Arrange: a three-way disagreement where every provider reports the SAME
    // confidence. The old reduce kept the first array element (openai, by
    // Promise.all order) — an undocumented, order-dependent tiebreaker. The new
    // rule prefers the lexicographically smallest provider name on a tie:
    // anthropic < google < openai, so anthropic must win regardless of order.
    openaiMock.mockResolvedValue(
      makeProvider({
        provider: "openai",
        issueType: "ROAD_DAMAGE",
        confidence: 0.8,
      }),
    );
    anthropicMock.mockResolvedValue(
      makeProvider({
        provider: "anthropic",
        issueType: "OTHER",
        confidence: 0.8,
      }),
    );
    googleMock.mockResolvedValue(
      makeProvider({
        provider: "google",
        issueType: "ILLEGAL_DUMPING",
        confidence: 0.8,
      }),
    );

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert: anthropic (smallest provider name) wins the tie, not openai.
    expect(result.method).toBe("highest-confidence");
    expect(result.winner.issueType).toBe("OTHER");
  });

  it("majority block's peak confidence wins, not the array-order first vote", async () => {
    // Arrange: ROAD_DAMAGE has the 2-vote plurality. Verify the winner is the
    // ROAD_DAMAGE result with the higher confidence (peak), selected
    // deterministically rather than by call order within the group.
    openaiMock.mockResolvedValue(
      makeProvider({ provider: "openai", issueType: "OTHER", confidence: 0.6 }),
    );
    anthropicMock.mockResolvedValue(
      makeProvider({
        provider: "anthropic",
        issueType: "ROAD_DAMAGE",
        confidence: 0.7,
      }),
    );
    googleMock.mockResolvedValue(
      makeProvider({
        provider: "google",
        issueType: "ROAD_DAMAGE",
        confidence: 0.55,
      }),
    );

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert: ROAD_DAMAGE has the 2-vote majority; its peak (0.7) wins.
    expect(result.method).toBe("majority");
    expect(result.winner.issueType).toBe("ROAD_DAMAGE");
    expect(result.winner.confidence).toBe(0.7);
  });

  it("strips provider/latencyMs from the winner (toClassification)", async () => {
    // Arrange
    const winning = makeProvider({ confidence: 0.99 });
    openaiMock.mockResolvedValue(winning);
    anthropicMock.mockResolvedValue(makeProvider({ provider: "anthropic" }));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert: winner is a ClassificationResult (no provider/latencyMs keys).
    expect(result.winner).toEqual({
      issueType: "ROAD_DAMAGE",
      aiDescription: "A pothole.",
      severity: "high",
      confidence: 0.99,
    });
    expect("provider" in result.winner).toBe(false);
    expect("latencyMs" in result.winner).toBe(false);
  });
});

describe("classifyWithConsensus — safeCall failure handling", () => {
  it("drops a throwing provider and logs to console.error with its name", async () => {
    // Arrange
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockRejectedValue(new Error("boom"));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert: only the two successful providers remain.
    expect(result.allResults).toHaveLength(2);
    expect(result.allResults.map((r) => r.provider)).toEqual([
      "openai",
      "google",
    ]);
    expect(console.error).toHaveBeenCalledWith(
      "[classify] anthropic failed:",
      expect.any(Error),
    );
  });

  it("tolerates a non-Error throwable", async () => {
    // Arrange
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockRejectedValue("string failure");
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert
    expect(result.allResults).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith(
      "[classify] anthropic failed:",
      "string failure",
    );
  });

  it("returns the OTHER/0-confidence fallback when all providers fail", async () => {
    // Arrange
    openaiMock.mockRejectedValue(new Error("a"));
    anthropicMock.mockRejectedValue(new Error("b"));
    googleMock.mockRejectedValue(new Error("c"));

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert
    expect(result.method).toBe("fallback");
    expect(result.consensus).toBe(false);
    expect(result.winner.issueType).toBe("OTHER");
    expect(result.winner.confidence).toBe(0);
    expect(result.winner.severity).toBe("low");
    expect(result.allResults).toEqual([]);
  });
});

describe("classifyWithConsensus — single-stage (twoStage off)", () => {
  it("skips preprocess and observe and passes the raw image through", async () => {
    // Arrange
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockResolvedValue(makeProvider({ provider: "anthropic" }));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", "RAWIMAGE", {
      twoStage: false,
    });

    // Assert
    expect(preprocessImageMock).not.toHaveBeenCalled();
    expect(observeImageMock).not.toHaveBeenCalled();
    expect(result.observation).toBeNull();
    expect(result.preprocess).toBeNull();
    // Providers received the raw image untouched.
    expect(openaiMock).toHaveBeenCalledWith(
      "desc",
      "RAWIMAGE",
      expect.any(Object),
    );
  });

  it("skips preprocessing when twoStage is on but no image is supplied", async () => {
    // Arrange
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockResolvedValue(makeProvider({ provider: "anthropic" }));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", null, {
      twoStage: true,
    });

    // Assert
    expect(preprocessImageMock).not.toHaveBeenCalled();
    expect(result.preprocess).toBeNull();
    expect(result.observation).toBeNull();
  });
});

describe("classifyWithConsensus — two-stage pipeline", () => {
  function stubPreprocess(
    exifGps: { latitude: number; longitude: number } | null,
  ) {
    preprocessImageMock.mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,PROCESSED",
      base64: "PROCESSED",
      byteLength: 123,
      exifGps,
      width: 1024,
      height: 768,
      originalWidth: 4000,
      originalHeight: 3000,
    });
  }

  beforeEach(() => {
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockResolvedValue(makeProvider({ provider: "anthropic" }));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));
  });

  it("runs preprocess -> observe -> stage-2 and passes the processed image to providers", async () => {
    // Arrange
    stubPreprocess(null);
    observeImageMock.mockResolvedValue({
      objects: ["pothole"],
      conditions: [],
      hazards: [],
      scene: "A pothole.",
      latencyMs: 50,
    });

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
    });

    // Assert
    expect(preprocessImageMock).toHaveBeenCalledWith("RAW");
    expect(observeImageMock).toHaveBeenCalledWith(
      "data:image/jpeg;base64,PROCESSED",
      "desc",
    );
    expect(result.preprocess).toEqual({
      width: 1024,
      height: 768,
      byteLength: 123,
      exifGpsUsed: false,
    });
    expect(result.observation?.scene).toBe("A pothole.");
    // Providers received the processed data URL, plus the stage-2 prompt
    // embedding the observation.
    const [, img, opts] = openaiMock.mock.calls[0];
    expect(img).toBe("data:image/jpeg;base64,PROCESSED");
    expect((opts as { prompt: string }).prompt).toContain(
      "Stage-1 visual observations:",
    );
  });

  it("calls all three providers via Promise.all", async () => {
    // Arrange
    stubPreprocess(null);
    observeImageMock.mockResolvedValue({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 1,
    });

    // Act
    await classifyWithConsensus("desc", "RAW", { twoStage: true });

    // Assert
    expect(openaiMock).toHaveBeenCalledOnce();
    expect(anthropicMock).toHaveBeenCalledOnce();
    expect(googleMock).toHaveBeenCalledOnce();
  });

  // --- mergeLocation behavior through locationUsed/exifGpsUsed -------------

  it("prefers caller coordinates over EXIF GPS (exifGpsUsed=false)", async () => {
    // Arrange: caller has coords AND exif has coords.
    stubPreprocess({ latitude: 1, longitude: 2 });
    observeImageMock.mockResolvedValue({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 1,
    });

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
      location: { latitude: 37.5, longitude: -122.2, address: "Main St" },
    });

    // Assert
    expect(result.locationUsed).toEqual({
      latitude: 37.5,
      longitude: -122.2,
      address: "Main St",
    });
    expect(result.preprocess?.exifGpsUsed).toBe(false);
  });

  it("falls back to EXIF GPS when caller lacks coordinates, preserving address", async () => {
    // Arrange
    stubPreprocess({ latitude: 10, longitude: 20 });
    observeImageMock.mockResolvedValue({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 1,
    });

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
      location: { address: "Elm St", jurisdiction: "Palo Alto" },
    });

    // Assert
    expect(result.locationUsed).toEqual({
      address: "Elm St",
      jurisdiction: "Palo Alto",
      latitude: 10,
      longitude: 20,
    });
    expect(result.preprocess?.exifGpsUsed).toBe(true);
  });

  it("leaves location null when neither caller coords nor EXIF GPS exist", async () => {
    // Arrange
    stubPreprocess(null);
    observeImageMock.mockResolvedValue({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 1,
    });

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
    });

    // Assert
    expect(result.locationUsed).toBeNull();
    expect(result.preprocess?.exifGpsUsed).toBe(false);
  });

  it("does not mutate the caller's location object (spread copy)", async () => {
    // Arrange
    stubPreprocess({ latitude: 5, longitude: 6 });
    observeImageMock.mockResolvedValue({
      objects: [],
      conditions: [],
      hazards: [],
      scene: "",
      latencyMs: 1,
    });
    const caller = { address: "Oak St" };

    // Act
    await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
      location: caller,
    });

    // Assert: original object untouched.
    expect(caller).toEqual({ address: "Oak St" });
  });

  // --- graceful degradation -----------------------------------------------

  it("degrades gracefully when preprocessing fails (raw image, null meta)", async () => {
    // Arrange
    preprocessImageMock.mockRejectedValue(new Error("decode failed"));

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
    });

    // Assert: falls back to the raw image, no observation/preprocess metadata.
    expect(result.preprocess).toBeNull();
    expect(result.observation).toBeNull();
    expect(observeImageMock).not.toHaveBeenCalled();
    const [, img] = openaiMock.mock.calls[0];
    expect(img).toBe("RAW");
    expect(console.error).toHaveBeenCalledWith(
      "[classify] preprocessing failed:",
      expect.any(Error),
    );
  });

  it("degrades gracefully when stage-1 observation fails (keeps preprocess meta)", async () => {
    // Arrange
    stubPreprocess({ latitude: 1, longitude: 2 });
    observeImageMock.mockRejectedValue(new Error("observe failed"));

    // Act
    const result = await classifyWithConsensus("desc", "RAW", {
      twoStage: true,
    });

    // Assert: preprocess metadata survives, observation is null.
    expect(result.observation).toBeNull();
    expect(result.preprocess).not.toBeNull();
    // Processed image still used by providers.
    const [, img] = openaiMock.mock.calls[0];
    expect(img).toBe("data:image/jpeg;base64,PROCESSED");
    expect(console.error).toHaveBeenCalledWith(
      "[classify] stage-1 observation failed:",
      expect.any(Error),
    );
  });
});

describe("classifyWithConsensus — output shape", () => {
  it("returns winner, allResults, consensus, method, observation, preprocess, locationUsed", async () => {
    // Arrange
    openaiMock.mockResolvedValue(makeProvider({ provider: "openai" }));
    anthropicMock.mockResolvedValue(makeProvider({ provider: "anthropic" }));
    googleMock.mockResolvedValue(makeProvider({ provider: "google" }));

    // Act
    const result = await classifyWithConsensus("desc", null);

    // Assert
    expect(Object.keys(result).sort()).toEqual(
      [
        "allResults",
        "consensus",
        "locationUsed",
        "method",
        "observation",
        "preprocess",
        "winner",
      ].sort(),
    );
  });
});
