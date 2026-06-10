import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Human-paced FULL-WORKFLOW walkthrough — the VIDEO is the deliverable. It walks
// the whole "Report an Issue" loop the way a person would, slowly enough to read
// on camera, and deliberately surfaces every input modality the product offers:
//
//   1. Homepage -> Report an Issue.
//   2. Attach a real example photo; the AI auto-analyses and pre-fills the
//      description (the "Analyzing photo…" state is given a realistic ~2s beat).
//   3. The THREE description paths, each shown on camera: (a) the AI suggestion
//      populated, (b) a human edit typed into the field, (c) the dictate/narrate
//      control toggled into its "Listening…" state and back.
//   4. Location BOTH ways: type an address + pick the autocomplete suggestion,
//      THEN auto-detect via a stubbed Palo Alto geolocation, THEN drag the map
//      pin and watch the GPS coordinates update on screen.
//   5. Analyze -> review, routed to a real served agency (Palo Alto 311).
//   6. Submit -> SUBMITTED with a tracking id -> confirmation.
//
// Fully deterministic + offline: every network route the flow touches is stubbed
// (auth, classify, agency candidates, official-form lookup, address suggest,
// reverse-geocode, reports POST, reports/*/submit). Speech recognition (absent in
// headless Chromium) is stubbed in the page so the dictate control renders and its
// "Listening…" state is genuinely exercised.

const POTHOLE_PHOTO = path.resolve(__dirname, "../test-photos/pothole-1.jpg");

// Real Palo Alto City Hall area — used for the picked address suggestion.
const PALO_ALTO = { lat: 37.444, lng: -122.161 };
// A distinct, real Palo Alto coordinate for the auto-detect path, so the GPS
// readout visibly changes from the address-picked one when "Detect" is clicked.
const PALO_ALTO_DETECT = { lat: 37.4419, lng: -122.143 };

const PALO_ALTO_311_URL =
  "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311";

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
        latencyMs: 2000,
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

const CREATED_REPORT = {
  success: true,
  data: {
    id: "rep_demo_workflow_0001",
    issueType: "ROAD_DAMAGE",
    description: null,
    aiDescription:
      "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
    createdAt: "2026-06-10T12:00:00.000Z",
  },
};

// Real Palo Alto address suggestion returned by /api/location/suggest.
const ADDRESS_SUGGESTIONS = {
  success: true,
  data: {
    suggestions: [
      {
        displayName: "250 Hamilton Ave, Palo Alto, CA",
        latitude: PALO_ALTO.lat,
        longitude: PALO_ALTO.lng,
      },
    ],
  },
};

// The official-city lookup result the app surfaces for this Palo Alto location:
// the real Palo Alto 311 reporting page.
const OFFICIAL_FORM_FOUND = {
  success: true,
  data: {
    status: "found",
    cityName: "Palo Alto",
    formUrl: PALO_ALTO_311_URL,
    confidence: "high",
    reason:
      "Palo Alto 311 is the city's unified Report-an-Issue portal for this location.",
  },
};

const beat = (page: Page, ms = 1100) => page.waitForTimeout(ms);

async function stubReportRoutes(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { success: false, error: "guest" } }),
  );
  // Realistic ~2s "thinking" delay so the "Analyzing photo…" state is visible.
  await page.route("**/api/reports/classify", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    return route.fulfill({ json: CLASSIFY_RESULT });
  });
  await page.route("**/api/reports/agency-candidates", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          candidates: [
            {
              id: "agency_palo_alto_311",
              name: "Palo Alto 311",
              jurisdiction: "Palo Alto",
            },
          ],
          ambiguous: false,
        },
      },
    }),
  );
  // The official-city lookup: return the real Palo Alto 311 page so the review
  // step shows that an official city reporting page was found.
  await page.route("**/api/reports/form-link**", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    return route.fulfill({ json: OFFICIAL_FORM_FOUND });
  });
  await page.route("**/api/location/suggest**", (route) =>
    route.fulfill({ json: ADDRESS_SUGGESTIONS }),
  );
  await page.route("**/api/reports", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: CREATED_REPORT })
      : route.continue(),
  );
  await page.route("**/api/reports/*/submit", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    return route.fulfill({
      json: {
        success: true,
        data: {
          reportId: CREATED_REPORT.data.id,
          status: "SUBMITTED",
          submitted: true,
          externalTrackingId: "TRK-WORKFLOW-1",
        },
      },
    });
  });
  // Detect + pin-drag reverse-geocode the coordinates via Nominatim. Stub it so
  // the flow stays offline and the address field fills with a real Palo Alto
  // street rather than a raw coordinate fallback.
  await page.route("**nominatim.openstreetmap.org/reverse**", (route) =>
    route.fulfill({
      json: { display_name: "Forest Ave, Palo Alto, CA 94301" },
    }),
  );
}

// Headless Chromium has no SpeechRecognition, so the Dictate control would not
// render. Inject a minimal stub that supports the start/stop + onend lifecycle
// the hook drives, so the control appears and its "Listening…" state is real.
// It captures no audio (none is needed): start() simply flips to listening, and
// stop() fires onend to return to idle — exactly what we want to film.
async function stubSpeechRecognition(page: Page) {
  await page.addInitScript(() => {
    class StubSpeechRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        /* listening begins; no audio is captured in the recording */
      }
      stop() {
        this.onend?.();
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      StubSpeechRecognition;
    (
      window as unknown as { webkitSpeechRecognition: unknown }
    ).webkitSpeechRecognition = StubSpeechRecognition;
  });
}

test("human-paced full report workflow — every input path, routed to Palo Alto 311", async ({
  page,
  context,
}) => {
  await stubSpeechRecognition(page);
  await stubReportRoutes(page);

  // 1. Homepage -> Report an Issue.
  await page.goto("/");
  await beat(page, 1600);

  await page
    .getByRole("link", { name: /report an issue/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/report$/);
  await beat(page, 1400);

  // 2. Attach the real pothole photo. The AI auto-analyses on upload; the
  // "Analyzing photo…" indicator shows during the ~2s classify delay, then the
  // description field auto-populates with the AI suggestion (badged "AI suggestion").
  await page.setInputFiles("#photo-input", POTHOLE_PHOTO);
  await expect(page.getByText(/analyzing photo/i)).toBeVisible();
  await beat(page, 1200);

  const description = page.getByRole("textbox", { name: "Description" });
  // (a) AI suggestion populated.
  await expect(description).toHaveValue(/large pothole in the roadway/i);
  await expect(page.getByText(/ai suggestion/i).first()).toBeVisible();
  await beat(page, 1800);

  // (b) The user can edit/type — append a small human edit to the AI text.
  await description.click();
  // Place the caret at the end before typing the human addendum.
  await description.press("End");
  await description.pressSequentially(
    " It is near the crosswalk on Hamilton Ave and deep enough to damage a tire.",
    { delay: 38 },
  );
  await beat(page, 1300);

  // (c) The dictate / narrate option — toggle the mic into "Listening…", hold,
  // then stop it. (Speech captures no audio headlessly; we show the control + state.)
  const dictate = page.getByRole("button", { name: /dictate description/i });
  await expect(dictate).toBeVisible();
  await dictate.click();
  await expect(
    page.getByRole("button", { name: /stop dictation/i }),
  ).toBeVisible();
  await expect(page.getByText(/listening/i)).toBeVisible();
  await beat(page, 1900);
  await page.getByRole("button", { name: /stop dictation/i }).click();
  await expect(dictate).toBeVisible();
  await beat(page, 1200);

  // 3. Location, path one: type the real Palo Alto address and pick the suggestion.
  const addressInput = page.getByRole("combobox", { name: "Location" });
  await addressInput.click();
  await addressInput.pressSequentially("250 Hamilton", { delay: 60 });
  const suggestion = page.getByRole("option", {
    name: /Hamilton Ave, Palo Alto/i,
  });
  await expect(suggestion).toBeVisible();
  await beat(page, 800);
  await suggestion.click();
  await expect(page.getByText(/GPS:\s*37\.444000/)).toBeVisible();
  await beat(page, 1600);

  // Location, path two: auto-detect via a stubbed Palo Alto geolocation. Grant
  // the permission and pin a distinct real coordinate so the GPS readout visibly
  // jumps from the address-picked location to the detected one.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: PALO_ALTO_DETECT.lat,
    longitude: PALO_ALTO_DETECT.lng,
  });
  await page.getByRole("button", { name: /detect my location/i }).click();
  await expect(page.getByText(/GPS:\s*37\.441900/)).toBeVisible();
  await beat(page, 1800);

  // Location, path three: drag the map pin a little and watch the GPS update.
  // Leaflet's draggable marker is an <img class="leaflet-marker-icon">. Capture
  // the coordinates before the drag so we can assert they actually changed.
  const gpsLine = page.locator("text=/GPS:\\s*-?\\d+\\.\\d+/").first();
  const beforeGps = (await gpsLine.textContent())?.trim() ?? "";
  const marker = page.locator("img.leaflet-marker-icon").first();
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  if (!box) throw new Error("Leaflet marker has no bounding box");
  const startX = box.x + box.width / 2;
  // Leaflet anchors the marker icon at its bottom tip, so grab it near the bottom.
  const startY = box.y + box.height - 4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in small steps so the drag reads as a deliberate human nudge on camera.
  await page.mouse.move(startX + 24, startY + 6, { steps: 8 });
  await beat(page, 350);
  await page.mouse.move(startX + 48, startY + 14, { steps: 8 });
  await beat(page, 350);
  await page.mouse.up();
  // The pin-drag must visibly update the on-screen coordinates.
  await expect(gpsLine).not.toHaveText(beforeGps, { timeout: 5000 });
  await beat(page, 1800);

  // 4. Analyze -> review.
  await page.getByRole("button", { name: /analyze issue/i }).click();
  await beat(page, 900);

  // The AI classification is shown.
  await expect(page.getByText(/road damage/i).first()).toBeVisible();
  await expect(page.getByText(/large pothole in the roadway/i)).toBeVisible();
  await beat(page, 1600);

  // The review visibly shows where it will be filed: the official Palo Alto 311 page.
  await expect(page.getByText(/Palo Alto/i).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /open official city form/i }),
  ).toBeVisible();
  await beat(page, 2600);

  // 5. Submit -> SUBMITTED with a tracking id -> confirmation.
  await page.getByRole("button", { name: /^submit report$/i }).click();
  await beat(page, 2200);

  await expect(page.getByText(/rep_demo_workflow_0001/)).toBeVisible();
  await beat(page, 2400);
});
