import { expect, test, type Page } from "@playwright/test";

// Dedicated end-to-end WALKTHROUGH for #220. The point of this spec is the
// VIDEO it records — the `full-workflow-video` project in playwright.config.ts
// runs it with `video: "on"`, so a runnable `npm run test:e2e` always emits a
// webm of the complete guest report loop:
//
//   home -> "Report an Issue" -> /report
//        -> describe (text + stubbed photo + stubbed address/location)
//        -> Analyze Issue (classify) -> review classification
//        -> Submit Report -> confirmation / submission step.
//
// Every network call the browser makes is intercepted with `page.route`, so the
// run is fully deterministic and offline: no real LLM consensus, no
// Google/Nominatim geocoding, no agency routing, no Open311 submission, no
// database. We assert only on rendered screen state (text/roles/urls), never on
// internal server logic. Selectors mirror the proven ones in
// anonymous-report.spec.ts so this walkthrough stays in lock-step with the UI.
//
// The artifact lands at:
//   test-results/full-workflow-*/video.webm
// (one folder per test; the project name "full-workflow-video" is encoded in
// the path). See e2e/README.md for how to view it.

// --- Deterministic stub payloads -------------------------------------------

const CLASSIFY_RESULT = {
  success: true,
  data: {
    winner: {
      issueType: "ROAD_DAMAGE",
      aiDescription:
        "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
      severity: "high",
      confidence: 0.95,
    },
    allResults: [
      {
        provider: "stub-model",
        latencyMs: 12,
        issueType: "ROAD_DAMAGE",
        aiDescription:
          "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
        severity: "high",
        confidence: 0.95,
      },
    ],
    consensus: true,
    method: "unanimous",
  },
};

// The created report row echoed back by POST /api/reports. The confirmation
// screen renders this id, so we assert on it as the terminal state.
const CREATED_REPORT = {
  success: true,
  data: {
    id: "rep_e2e_video_0001",
    issueType: "ROAD_DAMAGE",
    description: null,
    aiDescription:
      "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
    createdAt: "2026-06-09T12:00:00.000Z",
  },
};

const ADDRESS_SUGGESTIONS = {
  success: true,
  data: {
    suggestions: [
      {
        displayName: "123 Main St, Springfield",
        latitude: 37.422,
        longitude: -122.084,
      },
    ],
  },
};

/**
 * Register every client-side route stub the report flow touches. Routes are
 * matched by URL so minor UI changes (selectors/text) never break the network
 * layer. Mirrors anonymous-report.spec.ts, plus an explicit stub for the
 * agency-candidates lookup the page fires on classify success — so the review
 * step renders without any external routing call.
 */
async function stubReportRoutes(page: Page) {
  // Guest session check — the report page calls this on mount.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      json: { success: false, error: "Not authenticated" },
    }),
  );

  // LLM classification consensus — stubbed winner + single provider result.
  await page.route("**/api/reports/classify", (route) =>
    route.fulfill({ json: CLASSIFY_RESULT }),
  );

  // Official-form lookup fires after a successful classify. Return a benign
  // "not found" so the review step renders without an external Places/Nominatim
  // call. The exact body is non-load-bearing for this happy path.
  await page.route("**/api/reports/form-link", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          status: "not_found",
          cityName: null,
          message: "No official form found.",
          reason: "Stubbed for e2e.",
        },
      },
    }),
  );

  // Agency routing also fires on classify success. Collapse it to a single,
  // unambiguous candidate so the review step never asks the user to disambiguate
  // and the offline run stays deterministic.
  await page.route("**/api/reports/agency-candidates", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          candidates: [
            {
              id: "agency_e2e_stub",
              name: "City Public Works",
              jurisdiction: "Springfield",
            },
          ],
          ambiguous: false,
        },
      },
    }),
  );

  // Address suggestions (Google -> Nominatim fallback on the server) collapsed
  // to one deterministic result so selecting it sets coordinates offline.
  await page.route("**/api/location/suggest**", (route) =>
    route.fulfill({ json: ADDRESS_SUGGESTIONS }),
  );

  // Report creation — the row whose id the confirmation page shows.
  await page.route("**/api/reports", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: CREATED_REPORT });
    }
    return route.continue();
  });

  // The confirmation screen's SubmissionAssistant POSTs here on mount. Report a
  // successful automated filing so it lands in a stable "submitted" state.
  await page.route("**/api/reports/*/submit", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          reportId: CREATED_REPORT.data.id,
          status: "SUBMITTED",
          submitted: true,
          externalTrackingId: "TRK-STUB-1",
        },
      },
    }),
  );
}

test("records the full guest report workflow end to end", async ({ page }) => {
  await stubReportRoutes(page);

  // --- Home -> /report -------------------------------------------------------
  // Enter via the homepage CTA so the video opens on the real landing page and
  // exercises the actual navigation a first-time visitor takes.
  await page.goto("/");
  await page
    .getByRole("link", { name: /report an issue/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/report$/);

  // --- Describe step ---------------------------------------------------------
  // The mic toggle also carries a "...description" aria-label, so target the
  // textbox by its exact accessible name rather than a substring match.
  const description = page.getByRole("textbox", { name: "Description" });
  await description.fill(
    "Large pothole on Main St near the crosswalk, deep enough to damage a tire.",
  );

  // Stubbed photo: attach a tiny in-memory PNG to the hidden file input so the
  // capture includes an image without reading from disk. The page wires the
  // file input's change handler through use-image-upload; a valid PNG keeps that
  // pipeline happy while staying fully offline.
  const onePngPixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.setInputFiles("#photo-input", {
    name: "pothole.png",
    mimeType: "image/png",
    buffer: onePngPixel,
  });

  // Type a partial address to trigger the (stubbed) suggestion dropdown, then
  // pick the suggestion — selecting it sets latitude/longitude offline. A
  // language <select> in the nav is also a combobox, so scope to the address
  // input by its accessible name ("Location").
  const addressInput = page.getByRole("combobox", { name: "Location" });
  await addressInput.fill("123 Main");
  const suggestion = page.getByRole("option", { name: /123 Main St/i });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  // GPS coordinates from the selected suggestion now render on the describe step.
  await expect(page.getByText(/GPS:\s*37\.422/)).toBeVisible();

  // Trigger classification (stubbed) -> advances to the review step.
  await page.getByRole("button", { name: /analyze issue/i }).click();

  // --- Review step -----------------------------------------------------------
  // The classified issue type + AI description are rendered for the user to confirm.
  await expect(page.getByText(/road damage/i).first()).toBeVisible();
  await expect(page.getByText(/large pothole in the roadway/i)).toBeVisible();

  // Confirm and submit (stubbed POST /api/reports).
  await page.getByRole("button", { name: /^submit report$/i }).click();

  // --- Confirmed / submission step (terminal state) --------------------------
  // Acceptance: the confirmation screen shows the created report id, and the
  // SubmissionAssistant (stubbed /submit) has run. This is the final frame of
  // the recorded walkthrough.
  await expect(page.getByText(/report submitted!/i)).toBeVisible();
  await expect(page.getByText(CREATED_REPORT.data.id)).toBeVisible();
});
