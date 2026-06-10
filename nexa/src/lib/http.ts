// ---------------------------------------------------------------------------
// Shared resilience helpers for external HTTP calls.
//
// On Vercel Hobby a request is killed after ~30s, so any external dependency
// that hangs stalls the whole route. These helpers give every outbound call a
// bounded lifetime (AbortController timeout) and, where the call is safe to
// repeat, a small exponential-backoff retry for transient/network/5xx errors.
//
// Two pieces, kept deliberately small so every call site reuses them rather
// than rolling its own AbortController:
//   - fetchWithTimeout: a drop-in `fetch` that aborts after `timeoutMs`.
//   - withRetry:        wraps any async op in bounded exponential backoff.
//
// SDK-based calls (OpenAI / Anthropic / Google) don't go through `fetch`
// directly; they expose their own per-request timeout/abort options and are
// wired up at their own call sites using DEFAULT_LLM_TIMEOUT_MS below.
// ---------------------------------------------------------------------------

/** Default timeout for plain HTTP (geocoding, Open311) — well under Hobby's ~30s. */
export const DEFAULT_HTTP_TIMEOUT_MS = 12_000;

/** Default timeout for LLM SDK calls, which are slower than a REST hop. */
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;

/** Thrown when a {@link fetchWithTimeout} call exceeds its deadline. */
export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export type FetchWithTimeoutInit = RequestInit & {
  /** Abort the request after this many ms (default {@link DEFAULT_HTTP_TIMEOUT_MS}). */
  timeoutMs?: number;
};

/**
 * `fetch` with an AbortController deadline. Identical to `fetch` on success;
 * on timeout it rejects with a {@link TimeoutError} rather than hanging.
 *
 * If the caller passes their own `signal`, it is honored alongside the timeout:
 * whichever aborts first wins.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, signal, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Chain a caller-supplied signal so an external abort still propagates.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (error) {
    // An abort triggered by *our* timer (not the caller) surfaces as a typed
    // TimeoutError so callers can distinguish a deadline from other failures.
    if (
      controller.signal.aborted &&
      !(signal?.aborted ?? false) &&
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new TimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

export type RetryOptions = {
  /** Total attempts, including the first (default 3). */
  attempts?: number;
  /** Base backoff in ms; doubles each retry (default 300). */
  baseDelayMs?: number;
  /** Cap on any single backoff delay (default 4000). */
  maxDelayMs?: number;
  /**
   * Decides whether a thrown error is worth retrying. Defaults to
   * {@link isTransientError} (network/timeout). Callers that can see HTTP
   * status (e.g. Open311) pass a predicate that also retries 5xx.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Hook for tests / observability; called before each backoff sleep. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Heuristic for "transient" failures that are safe to retry on an idempotent
 * call: timeouts and connection-level errors. We intentionally do NOT treat an
 * arbitrary thrown Error as transient — only failures that strongly suggest the
 * request never reached / never completed at the server.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    // Node/undici connection errors surface a `code` on the cause or error.
    const code =
      (error as { code?: unknown }).code ??
      (error as { cause?: { code?: unknown } }).cause?.code ??
      undefined;
    if (typeof code === "string") {
      return [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "EPIPE",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_SOCKET",
      ].includes(code);
    }
    // Generic fetch network failure.
    if (error.message === "fetch failed" || error.message === "Failed to fetch")
      return true;
  }
  return false;
}

/**
 * Runs `op` with bounded exponential backoff. Retries only when `shouldRetry`
 * returns true (default: transient errors). Re-throws the last error once
 * attempts are exhausted, so callers see the original failure type.
 */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 4_000,
    shouldRetry = isTransientError,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt >= attempts;
      if (isLast || !shouldRetry(error, attempt)) throw error;

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  // Unreachable (the loop either returns or throws), but satisfies the type.
  throw lastError;
}
