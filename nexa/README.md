# Nexa — Next.js Application

This is the Next.js application for Nexa. Full documentation — features,
architecture, environment variables, testing, and CI — lives in the
[project README](../README.md) at the repository root.

## Quick start

```bash
npm install
npx prisma generate          # generate the Prisma client (also after schema changes)
cp .env.example .env.local   # fill in keys — see ../README.md for the full table
npm run dev                  # http://localhost:3000
```

## Common commands

```bash
npm test               # Vitest unit + integration suite
npm run test:coverage  # same suite with the coverage-threshold gate
npm run test:e2e       # Playwright end-to-end specs
npm run eval:routing   # offline routing-accuracy eval (see eval/README.md)
npm run lint           # ESLint
npm run build          # production build
```

## More docs

- [Project README](../README.md) — setup, features, env vars, CI
- [VERCEL_SETUP.md](VERCEL_SETUP.md) — production deployment
- [eval/README.md](eval/README.md) — evaluation harnesses
- [e2e/README.md](e2e/README.md) — end-to-end tests
- [src/test/README.md](src/test/README.md) — unit/integration testing + coverage gate
