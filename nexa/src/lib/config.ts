/**
 * Typed, centralized access to environment variables.
 *
 * Every env var read by the app should go through a getter here so that:
 *   - required vars fail fast with a clear, named error when missing (rather
 *     than surfacing as a confusing runtime failure deep in a query/SDK call);
 *   - optional vars have a single, consistent shape (`string | undefined`);
 *   - the literal env var names live in exactly one place.
 *
 * Getters are lazy and cached — they read `process.env` on first access and
 * memoize the result.
 * Laziness matters because some env vars are only present at runtime (e.g. on
 * Vercel) and not during the build, so we must not read them at module load.
 */

/** Thrown when a required environment variable is missing or empty. */
export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Required environment variable ${name} is not set`);
    this.name = "MissingEnvError";
  }
}

/**
 * Read a required env var, throwing {@link MissingEnvError} when it is missing
 * or empty. Treats whitespace-only values as missing.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingEnvError(name);
  return value;
}

/** Read an optional env var, returning a trimmed value or `undefined`. */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Read an optional numeric env var, falling back to `fallback` when the var is
 * unset, empty, non-numeric, or non-positive. Keeps tuning knobs configurable
 * without letting a typo silently disable a feature (a `0`/`NaN` radius would).
 */
function optionalPositiveNumberEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Wrap a getter so its result is computed once and cached. The first call
 * resolves the value (and may throw for required vars); later calls return the
 * memoized result.
 */
function cached<T>(read: () => T): () => T {
  let resolved = false;
  let value: T;
  return () => {
    if (!resolved) {
      value = read();
      resolved = true;
    }
    return value;
  };
}

// --- Required: app cannot function without these ---

/** Postgres connection string used by the Prisma adapter. Required. */
export const getDatabaseUrl = cached(() => requireEnv("DATABASE_URL"));

/** Secret used to sign and verify session JWTs. Required. */
export const getJwtSecret = cached(() => requireEnv("JWT_SECRET"));

// --- Optional: features degrade or are skipped when absent ---

/**
 * Shared secret guarding cron endpoints. Optional today — exposed here so the
 * cron route can adopt it once #99 lands.
 */
export const getCronSecret = cached(() => optionalEnv("CRON_SECRET"));

/** OpenAI API key (GPT classification + stage-1 observation). */
export const getOpenAiKey = cached(() => optionalEnv("OPENAI_API_KEY"));

/** Anthropic API key (Claude classification). */
export const getAnthropicKey = cached(() => optionalEnv("ANTHROPIC_API_KEY"));

/**
 * Google AI / Gemini API key — used by the Gemini classification provider.
 * Distinct from {@link getGoogleMapsApiKey}: this is the generative AI key.
 */
export const getGoogleApiKey = cached(() => optionalEnv("GOOGLE_API_KEY"));

/**
 * Google Maps / Places API key — used for address autocomplete.
 * Distinct from {@link getGoogleApiKey}: this is the Maps Platform key.
 */
export const getGoogleMapsApiKey = cached(() =>
  optionalEnv("GOOGLE_MAPS_API_KEY"),
);

// --- Duplicate-report detection (see src/lib/reports/dedup.ts) ---

/** Default radius (metres) within which a same-type report counts as a dup. */
export const DEFAULT_DUPLICATE_RADIUS_METERS = 50;
/** Default look-back window (hours) for the duplicate search. */
export const DEFAULT_DUPLICATE_WINDOW_HOURS = 24;

/**
 * Radius (metres) within which a new report with the same reporter + issue type
 * is treated as a likely duplicate. Configurable via `DUPLICATE_RADIUS_METERS`;
 * defaults to {@link DEFAULT_DUPLICATE_RADIUS_METERS}.
 */
export const getDuplicateRadiusMeters = cached(() =>
  optionalPositiveNumberEnv(
    "DUPLICATE_RADIUS_METERS",
    DEFAULT_DUPLICATE_RADIUS_METERS,
  ),
);

/**
 * Look-back window (hours) for the duplicate search — only reports created
 * within this window are considered. Configurable via `DUPLICATE_WINDOW_HOURS`;
 * defaults to {@link DEFAULT_DUPLICATE_WINDOW_HOURS}.
 */
export const getDuplicateWindowHours = cached(() =>
  optionalPositiveNumberEnv(
    "DUPLICATE_WINDOW_HOURS",
    DEFAULT_DUPLICATE_WINDOW_HOURS,
  ),
);
