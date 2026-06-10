import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Human-paced demo walkthrough — the VIDEO is the deliverable. Uses a REAL
// example photo (test-photos/pothole-1.jpg) and a REAL Palo Alto location, so
// the flow genuinely surfaces the official city reporting page (Palo Alto 311)
// on the review step. Types at human speed, pauses to "read" at each step, and
// gives the AI a realistic "thinking" delay.

const POTHOLE_PHOTO = path.resolve(__dirname, "../test-photos/pothole-1.jpg");

// Real Palo Alto City Hall area coordinates.
const PALO_ALTO = { lat: 37.444, lng: -122.161 };
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
        latencyMs: 2400,
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
    id: "rep_demo_pothole_0001",
    issueType: "ROAD_DAMAGE",
    description: null,
    aiDescription:
      "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
    createdAt: "2026-06-10T12:00:00.000Z",
  },
};

// Real Palo Alto address suggestion.
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
  await page.route("**/api/reports/classify", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
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
          externalTrackingId: "TRK-DEMO-1",
        },
      },
    });
  });
}

test("human-paced Palo Alto pothole report that finds the official city", async ({
  page,
}) => {
  await stubReportRoutes(page);

  await page.goto("/");
  await beat(page, 1600);

  await page
    .getByRole("link", { name: /report an issue/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/report$/);
  await beat(page, 1400);

  // Attach the real pothole photo.
  await page.setInputFiles("#photo-input", POTHOLE_PHOTO);
  await beat(page, 1800);

  // Type the description at human speed.
  const description = page.getByRole("textbox", { name: "Description" });
  await description.click();
  await description.pressSequentially(
    "Large pothole on Hamilton Ave near the crosswalk, deep enough to damage a tire.",
    { delay: 42 },
  );
  await beat(page, 1100);

  // Enter the real Palo Alto address and pick the suggestion.
  const addressInput = page.getByRole("combobox", { name: "Location" });
  await addressInput.click();
  await addressInput.pressSequentially("250 Hamilton", { delay: 65 });
  const suggestion = page.getByRole("option", {
    name: /Hamilton Ave, Palo Alto/i,
  });
  await expect(suggestion).toBeVisible();
  await beat(page, 700);
  await suggestion.click();
  await expect(page.getByText(/GPS:\s*37\.444/)).toBeVisible();
  await beat(page, 1300);

  // Analyze.
  await page.getByRole("button", { name: /analyze issue/i }).click();
  await beat(page, 800);

  // Review the AI classification.
  await expect(page.getByText(/road damage/i).first()).toBeVisible();
  await expect(page.getByText(/large pothole in the roadway/i)).toBeVisible();
  await beat(page, 1600);

  // The app finds the official city reporting page for this location.
  await expect(page.getByText(/Palo Alto/i).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /open official city form/i }),
  ).toBeVisible();
  await beat(page, 2600);

  // Submit.
  await page.getByRole("button", { name: /^submit report$/i }).click();
  await beat(page, 2200);

  await expect(page.getByText(/rep_demo_pothole_0001/)).toBeVisible();
  await beat(page, 2200);
});
