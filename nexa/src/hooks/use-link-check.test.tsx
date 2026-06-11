import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@/test";

import { useLinkCheck } from "./use-link-check";
import type { LinkCheckResult } from "@/lib/api/types";

/** Stub a `fetch` JSON response with the given status + envelope. */
function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Advance past the hook's debounce window and flush the pending fetch. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe("useLinkCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("debounces and stores the verdict for a valid link", async () => {
    const verdict: LinkCheckResult = {
      status: "form_found",
      confidence: "high",
      signals: ["post_form"],
    };
    const fetchFn = mockFetch(200, { success: true, data: verdict });

    const { result } = renderHook(() => useLinkCheck());

    // Typing fires no fetch until the debounce elapses.
    act(() => result.current.check("https://city.gov/report"));
    expect(fetchFn).not.toHaveBeenCalled();

    await flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.result).toEqual(verdict);
    expect(result.current.loading).toBe(false);
  });

  it("clears the verdict for a blank field without fetching", async () => {
    const fetchFn = mockFetch(200, { success: true, data: null });
    const { result } = renderHook(() => useLinkCheck());

    act(() => result.current.check("   "));
    await flush();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });

  it("maps a 400 to an invalid_url verdict", async () => {
    mockFetch(400, { success: false, error: "Enter a valid URL." });
    const { result } = renderHook(() => useLinkCheck());

    act(() => result.current.check("http://bad"));
    await flush();

    expect(result.current.result).toEqual({ status: "invalid_url" });
  });

  it("maps a network throw to an unreachable verdict", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useLinkCheck());

    act(() => result.current.check("https://city.gov/report"));
    await flush();

    expect(result.current.result).toMatchObject({ status: "unreachable" });
  });

  it("reset() clears the verdict and cancels the pending debounced check", async () => {
    const fetchFn = mockFetch(200, {
      success: true,
      data: { status: "no_form", reason: "x" },
    });
    const { result } = renderHook(() => useLinkCheck());

    act(() => result.current.check("https://city.gov/report"));
    act(() => result.current.reset());

    await flush();

    // reset() cleared the debounce timer, so the fetch never fired.
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });
});
