import { expect, test, type Page } from "@playwright/test";

// End-to-end of the core report loop a *guest* (no account) can complete:
//   home -> /report -> describe (text + stubbed address suggestion) ->
//   Analyze Issue -> review classification -> Submit -> confirmation page.
//
// Every network call the client makes is intercepted with `page.route` so the
// run is deterministic and offline: no real LLM consensus, no Nominatim/Google
// geocoding, no Open311 submission, no database. We assert on rendered screen
// state (text/roles/urls) per the issue — never on internal server logic.

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
    id: "rep_e2e_stub_0001",
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
 * Register all client-side route stubs for the report flow. Routes are matched
 * by URL so minor UI changes (selectors/text) don't break the network layer.
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

test("guest completes the core report loop and reaches the confirmation page", async ({
  page,
}) => {
  await stubReportRoutes(page);

  // Enter via the homepage CTA so we exercise the real navigation, not a deep
  // link, matching how a first-time visitor arrives.
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

  // Type a partial address to trigger the (stubbed) suggestion dropdown, then
  // pick the suggestion — selecting it sets latitude/longitude offline.
  // A language <select> in the nav is also a combobox, so scope to the address
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

  // --- Confirmed step (terminal state) --------------------------------------
  // Acceptance: the confirmation screen shows the created report id.
  await expect(page.getByText(/report submitted!/i)).toBeVisible();
  await expect(page.getByText(CREATED_REPORT.data.id)).toBeVisible();
});

test("classification failure shows the error banner and stays on the describe step", async ({
  page,
}) => {
  await stubReportRoutes(page);
  // Override classify with a server failure for this spec only.
  await page.route("**/api/reports/classify", (route) =>
    route.fulfill({
      status: 500,
      json: { success: false, error: "Classifier unavailable" },
    }),
  );

  await page.goto("/report");
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Streetlight out on the corner of 4th and Elm.");
  await page.getByRole("button", { name: /analyze issue/i }).click();

  // The hook surfaces the server's error message in the inline banner and the
  // flow does not advance to review (the Submit Report button never appears).
  // Scope to <main> so the dev-mode Next error overlay (which echoes the same
  // console.error text) doesn't create a strict-mode ambiguity.
  await expect(
    page.getByRole("main").getByText(/classifier unavailable/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^submit report$/i }),
  ).toHaveCount(0);
});
