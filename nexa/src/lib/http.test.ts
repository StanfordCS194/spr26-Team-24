import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWithTimeout,
  isTransientError,
  TimeoutError,
  withRetry,
} from "./http";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("returns the response when fetch resolves before the deadline", async () => {
    // Arrange
    const expected = new Response("ok");
    const fetchMock = vi.fn().mockResolvedValue(expected);
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const res = await fetchWithTimeout("https://example.test", {
      timeoutMs: 50,
    });

    // Assert
    expect(res).toBe(expected);
    // The call is given an AbortSignal even though the caller passed none.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects with a TimeoutError when fetch outlives the deadline", async () => {
    // Arrange: fetch that only rejects once its signal aborts.
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    // Act / Assert
    await expect(
      fetchWithTimeout("https://example.test", { timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates a caller-supplied abort without masking it as a timeout", async () => {
    // Arrange
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const external = new AbortController();

    // Act
    const promise = fetchWithTimeout("https://example.test", {
      timeoutMs: 10_000,
      signal: external.signal,
    });
    external.abort();

    // Assert: the caller's abort is not relabeled as a TimeoutError.
    await expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !(e instanceof TimeoutError),
    );
  });
});

describe("isTransientError", () => {
  it("treats timeouts and connection errors as transient", () => {
    expect(isTransientError(new TimeoutError(10))).toBe(true);
    const connErr = Object.assign(new Error("boom"), { code: "ECONNRESET" });
    expect(isTransientError(connErr)).toBe(true);
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
  });

  it("treats ordinary errors as non-transient", () => {
    expect(isTransientError(new Error("bad request"))).toBe(false);
    expect(isTransientError("nope")).toBe(false);
  });
});

describe("withRetry", () => {
  const noSleep = () => Promise.resolve();

  it("returns the first successful result without retrying", async () => {
    // Arrange
    const op = vi.fn().mockResolvedValue("done");

    // Act
    const result = await withRetry(op, { sleep: noSleep });

    // Assert
    expect(result).toBe("done");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to the attempt cap then succeeds", async () => {
    // Arrange: fail twice with a transient error, then succeed.
    const transient = Object.assign(new Error("net"), { code: "ECONNRESET" });
    const op = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue("ok");

    // Act
    const result = await withRetry(op, { attempts: 3, sleep: noSleep });

    // Assert
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    // Arrange
    const op = vi.fn().mockRejectedValue(new Error("permanent"));

    // Act / Assert
    await expect(
      withRetry(op, {
        attempts: 5,
        shouldRetry: () => false,
        sleep: noSleep,
      }),
    ).rejects.toThrow("permanent");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("re-throws the last error once attempts are exhausted", async () => {
    // Arrange: always-failing transient op.
    const transient = Object.assign(new Error("net"), { code: "ECONNRESET" });
    const op = vi.fn().mockRejectedValue(transient);
    const onRetry = vi.fn();

    // Act / Assert
    await expect(
      withRetry(op, { attempts: 2, sleep: noSleep, onRetry }),
    ).rejects.toBe(transient);
    expect(op).toHaveBeenCalledTimes(2);
    // onRetry fires once: after attempt 1, before the final attempt.
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("applies capped exponential backoff delays", async () => {
    // Arrange
    const transient = Object.assign(new Error("net"), { code: "ECONNRESET" });
    const op = vi.fn().mockRejectedValue(transient);
    const delays: number[] = [];

    // Act
    await withRetry(op, {
      attempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 250,
      sleep: noSleep,
      onRetry: (_e, _a, delay) => delays.push(delay),
    }).catch(() => {});

    // Assert: 100, 200, then capped at 250.
    expect(delays).toEqual([100, 200, 250]);
  });
});
