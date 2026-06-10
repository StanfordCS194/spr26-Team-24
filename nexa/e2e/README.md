# End-to-end tests (Playwright)

These specs run against the Playwright `webServer` (`next dev`, booted with a
fixed test env from `playwright.config.ts`). All network calls the browser makes
are intercepted with `page.route`, so the suite is deterministic and offline —
no real LLM, geocoding, agency routing, Open311 submission, or database.

Run the whole suite:

```bash
npm run test:e2e
```

## Specs

| Spec                            | What it covers                                          |
| ------------------------------- | ------------------------------------------------------- |
| `smoke.spec.ts`                 | Homepage loads, title + hero CTA render.                |
| `anonymous-report.spec.ts`      | Guest report loop + classification-failure error path.  |
| `authenticated-journey.spec.ts` | Proxy auth gating + register/login flow.                |
| `full-workflow.spec.ts`         | **Dedicated end-to-end video walkthrough** (see below). |

## Video walkthrough (`full-workflow.spec.ts`, #220)

`full-workflow.spec.ts` walks the complete guest workflow end to end:

> home → "Report an Issue" → `/report` → describe (text + stubbed photo +
> stubbed address/location) → Analyze Issue (classify) → review → Submit Report
> → confirmation / submission step.

It runs under the dedicated `full-workflow-video` Playwright **project** in
`playwright.config.ts`, which sets `use.video: "on"` — so a webm is **always**
recorded for this spec, pass or fail. The rest of the suite keeps the default
`video: "retain-on-failure"`, so the existing CI e2e behaviour is unchanged.

### Where the video lands

After `npm run test:e2e`, the recording is written under `test-results/`:

```
test-results/full-workflow-records-the-full-guest-report-workflow-end-to-end-full-workflow-video/video.webm
```

(One folder per test; the folder name is derived from the spec name, the test
title, and the project name `full-workflow-video`.) To find it regardless of the
exact slug:

```bash
find test-results -name video.webm
```

### How to view it

- macOS: `open <path-to>/video.webm`
- Any OS: open the file in a browser (Chrome/Firefox play `.webm`), or
- `npx playwright show-report` — the HTML report (generated in CI) embeds the
  video alongside the trace.

> Note: `test-results/` is a Playwright output directory and is git-ignored; the
> video is an artifact produced by running the suite, not a committed file.
