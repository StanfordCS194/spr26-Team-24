import { expect, test } from "@playwright/test";

// e2e smoke test: the homepage loads, has the expected title, and renders its
// hero call-to-action. Runs against the Playwright webServer (next dev).
test("homepage loads and shows expected content", async ({ page }) => {
  await page.goto("/");

  // Title from src/app/layout.tsx metadata.
  await expect(page).toHaveTitle(/Nexa/);

  // The hero CTA links to the report flow (i18n key home.reportAnIssue).
  await expect(
    page.getByRole("link", { name: /report an issue/i }).first(),
  ).toBeVisible();
});
