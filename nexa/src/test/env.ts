// Required env defaults for the test runtime. Loaded by vitest.setup.tsx before
// any test runs so modules that read these at import time (e.g. src/lib/auth.ts,
// which throws without JWT_SECRET) work without a real .env.
//
// Convention: put non-secret test overrides in a committed `.env.test` if you
// need more than this; secrets must never be required by the unit/integration
// suite (network and DB are mocked). NEXT_PUBLIC_POSTHOG_* are intentionally
// left unset — the app tolerates their absence (PostHogProvider no-ops).

process.env.JWT_SECRET ??= "test-secret-do-not-use-in-production";
// NODE_ENV is typed read-only by @types/node; assign through a widened view.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= "test";

// A syntactically-valid placeholder so anything that reads DATABASE_URL at
// import time doesn't crash. No real connection is ever made — Prisma is
// deep-mocked (see src/test/prisma-mock.ts).
process.env.DATABASE_URL ??=
  "postgresql://test:test@localhost:5432/test?schema=public";

export {};
