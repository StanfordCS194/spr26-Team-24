import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@/test";

import {
  useReportSubmission,
  type ClassifyInput,
} from "./use-report-submission";

const WINNER = {
  issueType: "ROAD_DAMAGE" as const,
  aiDescription: "A large pothole in the roadway.",
  severity: "high" as const,
  confidence: 0.95,
};

const CLASSIFY_PAYLOAD = {
  success: true,
  data: {
    winner: WINNER,
    allResults: [{ provider: "stub", latencyMs: 5, ...WINNER }],
    consensus: true,
    method: "unanimous",
    preprocess: null,
    locationUsed: null,
  },
};

function baseInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    description: "",
    imageBase64: "data:image/jpeg;base64,AAAA",
    latitude: null,
    longitude: null,
    address: "",
    ...overrides,
  };
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(CLASSIFY_PAYLOAD),
  });
}

describe("useReportSubmission.classify", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the cached result for identical inputs (no second LLM call)", async () => {
    // Arrange
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReportSubmission());
    const onSuccess = vi.fn();

    // Act: first call hits the network; second (same inputs) hits the cache.
    await act(async () => {
      await result.current.classify(baseInput(), {
        onSuccess,
        errorFallback: "err",
      });
    });
    await act(async () => {
      await result.current.classify(baseInput(), {
        onSuccess,
        errorFallback: "err",
      });
    });

    // Assert: classify route POSTed exactly once, but onSuccess fired twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(result.current.classification?.aiDescription).toBe(
      WINNER.aiDescription,
    );
  });

  it("re-classifies when the image changes", async () => {
    // Arrange
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReportSubmission());
    const onSuccess = vi.fn();

    // Act
    await act(async () => {
      await result.current.classify(baseInput(), {
        onSuccess,
        errorFallback: "err",
      });
    });
    await act(async () => {
      await result.current.classify(
        baseInput({ imageBase64: "data:image/jpeg;base64,BBBB" }),
        { onSuccess, errorFallback: "err" },
      );
    });

    // Assert: a different image is a cache miss -> a second network call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not surface an error or toggle classifying on the silent path", async () => {
    // Arrange: the classify route fails (e.g. no AI keys configured).
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ success: false, error: "no keys" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReportSubmission());
    const onSuccess = vi.fn();

    // Act
    await act(async () => {
      await result.current.classify(
        baseInput(),
        { onSuccess, errorFallback: "err" },
        { silent: true },
      );
    });

    // Assert: graceful degradation — no banner, no spinner, onSuccess not called.
    expect(result.current.classifyError).toBeNull();
    expect(result.current.classifying).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("surfaces the error on the non-silent path", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ success: false, error: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReportSubmission());

    // Act
    await act(async () => {
      await result.current.classify(baseInput(), {
        onSuccess: vi.fn(),
        errorFallback: "fallback",
      });
    });

    // Assert
    expect(result.current.classifyError).toBe("boom");
  });

  it("clears the cache on reset so the next call re-classifies", async () => {
    // Arrange
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReportSubmission());
    const cb = { onSuccess: vi.fn(), errorFallback: "err" };

    // Act
    await act(async () => {
      await result.current.classify(baseInput(), cb);
    });
    act(() => result.current.reset());
    await act(async () => {
      await result.current.classify(baseInput(), cb);
    });

    // Assert: reset invalidates the cache -> a fresh network call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
