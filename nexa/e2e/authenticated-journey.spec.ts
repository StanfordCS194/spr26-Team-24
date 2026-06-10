import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";

// Authenticated-user journey, exercised offline against the Playwright
// webServer. Two things are deterministic and stubbable here:
//
//   1. Proxy auth-gating (src/proxy.ts): a guest hitting a protected route is
//      redirected to /login?redirect=..., and an authenticated user is bounced
//      away from /login. Both are driven by verifyToken() over the session
//      cookie, signed with the SAME JWT_SECRET the webServer boots with.
//   2. The register -> login UI with /api/auth/* stubbed.
//
// NOTE (documented limitation): the dashboard *page* (src/app/dashboard) is a
// server component that queries Prisma/Postgres directly. That DB access is not
// reachable by `page.route` (which only intercepts browser fetches), so a fully
// offline render of the dashboard with seeded reports is out of scope for this
// e2e layer and is covered by integration tests. This spec therefore asserts on
// the auth gating + register/login flow, whose terminal states (the login
// redirect and the post-auth bounce) are explicit acceptance criteria for #119.

// Must match playwright.config.ts -> webServer.env.JWT_SECRET so a token minted
// here verifies inside the app's proxy/verifyToken.
const JWT_SECRET = "e2e-test-secret-do-not-use-in-production";
const SESSION_COOKIE = "nexa-session";

/** Mint a session JWT the app's verifyToken() will accept. */
async function signSession(userId: string, email: string): Promise<string> {
  return new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Install a valid session cookie so the proxy treats the visitor as logged in. */
async function authenticate(page: Page) {
  const token = await signSession("user_e2e_1", "e2e@example.com");
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("guest visiting a protected route is redirected to login (terminal state)", async ({
  page,
}) => {
  // No session cookie -> the proxy redirects /dashboard to the login page,
  // preserving the intended destination in the `redirect` query param.
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();
});

test("registration submits and navigates away from the register form", async ({
  page,
}) => {
  // Stub the account-creation endpoint so no real user is written.
  await page.route("**/api/auth/register", (route) =>
    route.fulfill({
      json: { success: true, data: { id: "user_new", email: "new@example.com" } },
    }),
  );

  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: /create an account/i }),
  ).toBeVisible();

  await page.getByLabel(/email/i).fill("new@example.com");
  // Password >= 8 chars per the issue's registration constraint.
  await page.getByLabel(/password/i).fill("supersecret123");
  await page
    .getByRole("button", { name: /create account/i })
    .click();

  // On success the form routes to the home page; assert we left /register.
  await expect(page).toHaveURL((url) => !url.pathname.startsWith("/register"));
});

test("login sets a session and the proxy then bounces the user off /login", async ({
  page,
}) => {
  // Stub login to succeed AND set a real, correctly-signed session cookie so the
  // subsequent proxy check sees an authenticated user (mirrors the reviewer
  // correction on #119: cookie obtained via the stubbed /api/auth/login).
  const token = await signSession("user_e2e_1", "e2e@example.com");
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      },
      json: {
        success: true,
        data: { id: "user_e2e_1", email: "e2e@example.com" },
      },
    }),
  );

  await page.goto("/login");
  await page.getByLabel(/email/i).fill("e2e@example.com");
  await page.getByLabel(/password/i).fill("supersecret123");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // After login the client navigates to the redirect target (home by default);
  // we left the login form.
  await expect(page).toHaveURL((url) => !url.pathname.startsWith("/login"));

  // The session cookie is now set: re-visiting /login makes the proxy bounce the
  // authenticated user back to home — a deterministic terminal auth state.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$|\/$/);
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toHaveCount(0);
});

test("an authenticated user is bounced from /login by the proxy", async ({
  page,
}) => {
  // Pre-seed a valid session cookie (storageState-style) before any navigation.
  await authenticate(page);

  await page.goto("/login");
  // proxy.ts redirects logged-in users away from auth routes to home.
  await expect(page).toHaveURL((url) => url.pathname === "/");
});
