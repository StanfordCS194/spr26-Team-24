/**
 * Next.js instrumentation entry point (issue #208).
 *
 * Wires server-side error tracking behind the same env-gating convention used
 * for push / email / S3: it is a NO-OP unless `SENTRY_DSN` is set, so the app
 * runs unchanged out of the box and activates the moment the DSN is provided.
 *
 * This deliberately does NOT replace the existing observability baseline — the
 * `[…][ALERT]` console logs (e.g. `[poll-status][ALERT]`) and the `/api/health`
 * DB probe remain the source of truth. When a DSN is set, `onRequestError`
 * forwards uncaught server errors to Sentry IN ADDITION to those logs.
 *
 * To keep the install lean, `@sentry/nextjs` is imported dynamically and only
 * when a DSN is present; when the package is absent the hook degrades to the
 * existing console logging without throwing. See `docs/ops.md` for the full
 * integration guide.
 */
import type { Instrumentation } from "next";

import { getSentryDsn, getSoftRequiredEnvWarnings } from "@/lib/config";

const ALERT_PREFIX = "[instrumentation][ALERT]";

/**
 * Greppable marker for the soft-required env audit (issue #242). A single,
 * consistent prefix means ops can alert on `[config] WARNING` across logs.
 */
const CONFIG_WARNING_PREFIX = "[config] WARNING:";

/**
 * True only on a real production deploy. Soft-required env vars are expected to
 * be unset in dev/test (and during the build), so warning there would be noise —
 * we only surface them where a missing key is an actual misconfiguration.
 * Mirrors the env resolution used for Sentry's `environment` above.
 */
function isProduction(): boolean {
  return (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
}

/**
 * Log one `[config] WARNING: …` line per unset soft-required env var, naming the
 * feature it disables. Production-only and never throws — purely informational
 * ops visibility. Hard-required vars (DATABASE_URL, JWT_SECRET) are unaffected;
 * they still fail fast through `requireEnv` in `config.ts`.
 */
function warnOnMissingSoftRequiredEnv(): void {
  if (!isProduction()) return;
  for (const impact of getSoftRequiredEnvWarnings()) {
    console.warn(`${CONFIG_WARNING_PREFIX} ${impact}`);
  }
}

/**
 * Minimal structural type for the bits of `@sentry/nextjs` we touch. Declared
 * locally so the project does not need the package installed to typecheck — the
 * SDK is an OPTIONAL dependency, loaded only when `SENTRY_DSN` is set.
 */
interface SentryModule {
  init(options: {
    dsn: string;
    tracesSampleRate?: number;
    environment?: string;
  }): void;
  captureRequestError(
    ...args: Parameters<Instrumentation.onRequestError>
  ): void;
}

/**
 * Lazily load and initialize the Sentry Next.js SDK. Returns the loaded module,
 * or `null` when no DSN is set or the optional `@sentry/nextjs` package is not
 * installed (so error tracking is purely additive and never a hard dependency).
 */
async function loadSentry(): Promise<SentryModule | null> {
  const dsn = getSentryDsn();
  if (!dsn) return null;
  try {
    // Optional dependency: the dynamic specifier is built at runtime so the
    // bundler does not try to resolve the package unless it is installed.
    const moduleName = "@sentry/nextjs";
    const Sentry = (await import(moduleName).catch(
      () => null,
    )) as SentryModule | null;
    if (!Sentry) {
      console.error(
        `${ALERT_PREFIX} SENTRY_DSN is set but @sentry/nextjs is not installed — see docs/ops.md`,
      );
      return null;
    }
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
    return Sentry;
  } catch (error) {
    // Never let observability setup take down the server.
    console.error(`${ALERT_PREFIX} Sentry init failed:`, error);
    return null;
  }
}

/**
 * Called once per server instance. Initializes Sentry when `SENTRY_DSN` is set
 * (a no-op otherwise) and, in production, audits the soft-required env vars,
 * logging a `[config] WARNING: …` line for each unset one (issue #242).
 */
export async function register(): Promise<void> {
  warnOnMissingSoftRequiredEnv();
  await loadSentry();
}

/**
 * Forward uncaught server errors to Sentry when configured. The existing
 * `[…][ALERT]` console logging remains the baseline signal; this is additive.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  const Sentry = await loadSentry();
  if (!Sentry) return;
  Sentry.captureRequestError(...args);
};
