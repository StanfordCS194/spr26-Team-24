import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@/test";

import { useSpeechRecognition } from "./use-speech-recognition";

// ---------------------------------------------------------------------------
// Fake SpeechRecognition: captures the configured handlers so a test can fire
// onresult/onerror/onend and assert the hook's reaction.
// ---------------------------------------------------------------------------

interface ResultEntry {
  isFinal: boolean;
  transcript: string;
}

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  static startThrows = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => {
    if (FakeSpeechRecognition.startThrows) throw new Error("boom");
  });
  stop = vi.fn();

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  /** Drive onresult with a synthetic result list (resultIndex 0). */
  fireResult(entries: ResultEntry[]) {
    const results = entries.map((e) => ({
      isFinal: e.isFinal,
      0: { transcript: e.transcript },
    }));
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign(results, { length: results.length }),
    });
  }
}

function lastInstance() {
  const all = FakeSpeechRecognition.instances;
  return all[all.length - 1];
}

describe("useSpeechRecognition", () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    FakeSpeechRecognition.startThrows = false;
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    // Ensure no webkit-prefixed leftover interferes.
    vi.stubGlobal("webkitSpeechRecognition", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reports supported=true via useSyncExternalStore when a ctor exists", () => {
    // Arrange / Act
    const { result } = renderHook(() => useSpeechRecognition());

    // Assert
    expect(result.current.supported).toBe(true);
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports supported=false when no SpeechRecognition ctor exists", () => {
    // Arrange
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);

    // Act
    const { result } = renderHook(() => useSpeechRecognition());

    // Assert
    expect(result.current.supported).toBe(false);
  });

  it("start() configures lang/continuous/interim and begins listening", () => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());

    // Act
    act(() => {
      result.current.start(vi.fn());
    });

    // Assert
    const instance = lastInstance();
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(instance.continuous).toBe(false);
    expect(instance.interimResults).toBe(false);
    expect(instance.lang).toBe(navigator.language);
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("start() sets an error and does not construct when unsupported", () => {
    // Arrange
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const { result } = renderHook(() => useSpeechRecognition());

    // Act
    act(() => {
      result.current.start(vi.fn());
    });

    // Assert
    expect(result.current.error).toBe("speech.unsupported");
    expect(result.current.listening).toBe(false);
  });

  it("start() guards against a double-start (no second instance)", () => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(vi.fn());
    });

    // Act: second start while one is active.
    act(() => {
      result.current.start(vi.fn());
    });

    // Assert: only one recognition instance was ever constructed.
    expect(FakeSpeechRecognition.instances).toHaveLength(1);
  });

  it("onresult invokes the callback only for final results, trimmed", () => {
    // Arrange
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(onFinal);
    });

    // Act
    act(() => {
      lastInstance().fireResult([
        { isFinal: false, transcript: "interim text" },
        { isFinal: true, transcript: "  final text  " },
      ]);
    });

    // Assert
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("final text");
  });

  it("onresult ignores a final result whose transcript is empty after trim", () => {
    // Arrange
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(onFinal);
    });

    // Act
    act(() => {
      lastInstance().fireResult([{ isFinal: true, transcript: "   " }]);
    });

    // Assert
    expect(onFinal).not.toHaveBeenCalled();
  });

  it.each([
    ["not-allowed", "speech.denied"],
    ["service-not-allowed", "speech.denied"],
    ["no-speech", "speech.noSpeech"],
    ["audio-capture", "speech.noMicrophone"],
    ["network", "speech.failed"],
  ])("onerror(%s) maps to its message key", (code, message) => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(vi.fn());
    });

    // Act
    act(() => {
      lastInstance().onerror?.({ error: code });
    });

    // Assert
    expect(result.current.error).toBe(message);
  });

  it("onend clears listening and allows a fresh start afterwards", () => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(vi.fn());
    });

    // Act
    act(() => {
      lastInstance().onend?.();
    });

    // Assert: listening false, and ref cleared so a new start builds a 2nd instance.
    expect(result.current.listening).toBe(false);
    act(() => {
      result.current.start(vi.fn());
    });
    expect(FakeSpeechRecognition.instances).toHaveLength(2);
  });

  it("stop() calls stop() on the active recognition instance", () => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(vi.fn());
    });
    const instance = lastInstance();

    // Act
    act(() => {
      result.current.stop();
    });

    // Assert
    expect(instance.stop).toHaveBeenCalledTimes(1);
  });

  it("stop() is a no-op when not listening", () => {
    // Arrange
    const { result } = renderHook(() => useSpeechRecognition());

    // Act / Assert: no instance exists, so nothing throws.
    expect(() => {
      act(() => {
        result.current.stop();
      });
    }).not.toThrow();
  });

  it("sets an error if start() throws while starting", () => {
    // Arrange: the recognition instance's start() throws.
    FakeSpeechRecognition.startThrows = true;
    const { result } = renderHook(() => useSpeechRecognition());

    // Act
    act(() => {
      result.current.start(vi.fn());
    });

    // Assert
    expect(result.current.error).toBe("speech.startFailed");
    expect(result.current.listening).toBe(false);
  });

  it("unmount stops the active recognition (cleanup effect)", () => {
    // Arrange
    const { result, unmount } = renderHook(() => useSpeechRecognition());
    act(() => {
      result.current.start(vi.fn());
    });
    const instance = lastInstance();

    // Act
    unmount();

    // Assert
    expect(instance.stop).toHaveBeenCalled();
  });
});
