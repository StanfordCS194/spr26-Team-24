import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  makeUser,
  renderWithProviders,
  screen,
  server,
  waitFor,
} from "@/test";

import { Navbar } from "./navbar";

// Stable router + controllable pathname.
const push = vi.fn();
const refresh = vi.fn();
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

function stubMe(user: unknown, status = 200) {
  server.use(
    http.get("*/api/auth/me", () =>
      user === null
        ? new HttpResponse(null, { status: status === 200 ? 401 : status })
        : HttpResponse.json(user),
    ),
  );
}

describe("Navbar", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    pathname = "/";
  });

  it("renders the logo and primary nav links", async () => {
    // Arrange
    stubMe(null);

    // Act
    renderWithProviders(<Navbar />);

    // Assert
    expect(screen.getByText("Nexa")).toBeInTheDocument();
    expect(screen.getByText("How It Works")).toBeInTheDocument();
    // Let the me-fetch settle so there are no act() warnings.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Sign in/ })).toBeInTheDocument(),
    );
  });

  it("shows the loading placeholder before the auth check resolves", () => {
    // Arrange: a never-resolving me request keeps user === undefined.
    server.use(
      http.get(
        "*/api/auth/me",
        () => new Promise<HttpResponse<null>>(() => {}),
      ),
    );

    // Act
    renderWithProviders(<Navbar />);

    // Assert: neither the signed-in CTA nor the sign-in link is shown yet.
    expect(
      screen.queryByRole("link", { name: /Sign in/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open account menu" }),
    ).not.toBeInTheDocument();
  });

  it("renders the signed-out state (Sign in) when not authenticated", async () => {
    // Arrange
    stubMe(null);

    // Act
    renderWithProviders(<Navbar />);

    // Assert
    expect(
      await screen.findByRole("link", { name: /Sign in/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open account menu" }),
    ).not.toBeInTheDocument();
  });

  it("renders the signed-in state with the account menu and dashboard link", async () => {
    // Arrange
    stubMe(makeUser({ name: "Ada Lovelace", email: "ada@example.com" }));

    // Act
    renderWithProviders(<Navbar />);

    // Assert: account menu trigger appears once authenticated.
    expect(
      await screen.findByRole("button", { name: "Open account menu" }),
    ).toBeInTheDocument();
    // The Dashboard nav link is shown for signed-in users.
    expect(
      screen.getAllByRole("link", { name: "Dashboard" }).length,
    ).toBeGreaterThan(0);
  });

  it("derives initials from the user's name", async () => {
    // Arrange
    stubMe(makeUser({ name: "Ada Lovelace", email: "ada@example.com" }));

    // Act
    renderWithProviders(<Navbar />);

    // Assert: trigger shows "AL".
    const trigger = await screen.findByRole("button", {
      name: "Open account menu",
    });
    expect(trigger).toHaveTextContent("AL");
  });

  it("opens the account menu and signs out", async () => {
    // Arrange
    stubMe(makeUser({ name: "Ada Lovelace", email: "ada@example.com" }));
    let logoutCalled = false;
    server.use(
      http.post("*/api/auth/logout", () => {
        logoutCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderWithProviders(<Navbar />);
    const trigger = await screen.findByRole("button", {
      name: "Open account menu",
    });

    // Act: open the menu, then click Sign out.
    await user.click(trigger);
    const signOut = await screen.findByText("Sign out");
    await user.click(signOut);

    // Assert: logout POSTed and navigation refreshed home.
    await waitFor(() => expect(logoutCalled).toBe(true));
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-fetches the auth state when the pathname changes", async () => {
    // Arrange: first render signed out.
    let meCalls = 0;
    server.use(
      http.get("*/api/auth/me", () => {
        meCalls += 1;
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const { rerender } = renderWithProviders(<Navbar />);
    await waitFor(() => expect(meCalls).toBe(1));

    // Act: change pathname and re-render (the effect depends on pathname).
    pathname = "/dashboard";
    rerender(<Navbar />);

    // Assert
    await waitFor(() => expect(meCalls).toBe(2));
  });

  it("marks the Dashboard link as current when on the dashboard", async () => {
    // Arrange
    pathname = "/dashboard";
    stubMe(makeUser({ name: "Ada", email: "ada@example.com" }));
    const { user } = renderWithProviders(<Navbar />);

    // Act: open menu to reveal the menu's Dashboard link with aria-current.
    const trigger = await screen.findByRole("button", {
      name: "Open account menu",
    });
    await user.click(trigger);

    // Assert: the menu's Dashboard item is marked as the current page.
    const dashboardItem = await screen.findByRole("menuitem", {
      name: /Dashboard/,
    });
    expect(dashboardItem).toHaveAttribute("aria-current", "page");
  });
});
