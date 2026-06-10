import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  renderWithProviders,
  screen,
  server,
} from "@/test";

import { ResolutionPrompt } from "./resolution-prompt";

// Stable router so refresh assertions hold across renders.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

describe("ResolutionPrompt", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it('POSTs resolved=true to the resolution endpoint when "Yes, fixed" is clicked', async () => {
    // Arrange
    let body: unknown = null;
    let url: string | null = null;
    server.use(
      http.post("*/api/reports/:id/resolution", async ({ request }) => {
        url = request.url;
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderWithProviders(<ResolutionPrompt reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Yes, fixed/ }));

    // Assert
    expect(url).toContain("/api/reports/r1/resolution");
    expect(body).toEqual({ resolved: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('POSTs resolved=false when "Not yet" is clicked', async () => {
    // Arrange
    let body: unknown = null;
    server.use(
      http.post("*/api/reports/:id/resolution", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = renderWithProviders(<ResolutionPrompt reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Not yet/ }));

    // Assert
    expect(body).toEqual({ resolved: false });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and does not refresh on failure", async () => {
    // Arrange
    server.use(
      http.post("*/api/reports/:id/resolution", () =>
        HttpResponse.json({ error: "Update failed" }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(<ResolutionPrompt reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Yes, fixed/ }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent("Update failed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables both buttons while a submission is in flight", async () => {
    // Arrange: a handler that never resolves keeps the submitting state active.
    server.use(
      http.post(
        "*/api/reports/:id/resolution",
        () => new Promise<HttpResponse<null>>(() => {}),
      ),
    );
    const { user } = renderWithProviders(<ResolutionPrompt reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Yes, fixed/ }));

    // Assert
    expect(screen.getByRole("button", { name: /Yes, fixed/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Not yet/ })).toBeDisabled();
  });
});
