import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  renderWithProviders,
  screen,
  server,
} from "@/test";

import { DeleteReportButton } from "./delete-report-button";

// Capture a stable router so push/refresh assertions survive across renders
// (the global mock in vitest.setup.tsx returns a fresh router each call).
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

describe("DeleteReportButton", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a confirmation click before deleting", async () => {
    // Arrange
    let called = false;
    server.use(
      http.delete("*/api/reports/:id", () => {
        called = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { user } = renderWithProviders(<DeleteReportButton reportId="r1" />);

    // Act: first click only arms the confirm state.
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Assert: no request yet; the confirm affordance appears.
    expect(called).toBe(false);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("issues a DELETE to /api/reports/{id} and refreshes on success", async () => {
    // Arrange
    let requestedUrl: string | null = null;
    let method: string | null = null;
    server.use(
      http.delete("*/api/reports/:id", ({ request }) => {
        requestedUrl = request.url;
        method = request.method;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { user } = renderWithProviders(<DeleteReportButton reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // Assert
    expect(method).toBe("DELETE");
    expect(requestedUrl).toContain("/api/reports/r1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects instead of refreshing when redirectTo is set", async () => {
    // Arrange
    server.use(
      http.delete(
        "*/api/reports/:id",
        () => new HttpResponse(null, { status: 200 }),
      ),
    );
    const { user } = renderWithProviders(
      <DeleteReportButton reportId="r1" redirectTo="/dashboard" />,
    );

    // Act
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // Assert
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the server error message when the delete fails", async () => {
    // Arrange
    server.use(
      http.delete("*/api/reports/:id", () =>
        HttpResponse.json({ error: "Not allowed" }, { status: 403 }),
      ),
    );
    const { user } = renderWithProviders(<DeleteReportButton reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // Assert
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders the Edit link by default and hides it while confirming", async () => {
    // Arrange
    const { user } = renderWithProviders(<DeleteReportButton reportId="r1" />);

    // Assert: edit link present before confirming.
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute(
      "href",
      "/dashboard/reports/r1/edit",
    );

    // Act: entering confirm mode hides edit.
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Assert
    expect(
      screen.queryByRole("link", { name: /Edit/ }),
    ).not.toBeInTheDocument();
  });

  it("omits the Edit link when showEdit is false", () => {
    // Arrange / Act
    renderWithProviders(<DeleteReportButton reportId="r1" showEdit={false} />);

    // Assert
    expect(
      screen.queryByRole("link", { name: /Edit/ }),
    ).not.toBeInTheDocument();
  });
});
