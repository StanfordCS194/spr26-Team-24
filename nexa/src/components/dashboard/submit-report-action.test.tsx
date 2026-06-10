import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  http,
  HttpResponse,
  renderWithProviders,
  screen,
  server,
} from "@/test";

import { SubmitReportAction } from "./submit-report-action";

// Stable router so refresh assertions hold across the success path.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

describe("SubmitReportAction", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("POSTs to the submit endpoint and refreshes on an automated submission", async () => {
    // Arrange
    let url: string | null = null;
    let method: string | null = null;
    server.use(
      http.post("*/api/reports/:id/submit", ({ request }) => {
        url = request.url;
        method = request.method;
        return HttpResponse.json({
          success: true,
          data: {
            reportId: "r1",
            status: "SUBMITTED",
            submitted: true,
            externalTrackingId: "SR-42",
          },
        });
      }),
    );
    const { user } = renderWithProviders(<SubmitReportAction reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit to agency/ }));

    // Assert: reused endpoint, and the success path hands off to a route refresh
    // (the server re-renders the card with the new status + tracking id).
    expect(url).toContain("/api/reports/r1/submit");
    expect(method).toBe("POST");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("surfaces the official intake link on a manual-assist result", async () => {
    // Arrange
    server.use(
      http.post("*/api/reports/:id/submit", () =>
        HttpResponse.json({
          success: true,
          data: {
            reportId: "r1",
            status: "CONFIRMED",
            submitted: false,
            manualAssist: {
              intakeMethod: "WEB_FORM",
              agencyName: "Public Works",
              intakeUrl: "https://city.example/form",
              intakeEmail: null,
            },
          },
        }),
      ),
    );
    const { user } = renderWithProviders(<SubmitReportAction reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit to agency/ }));

    // Assert
    expect(await screen.findByText(/Public Works/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open official form/ }),
    ).toHaveAttribute("href", "https://city.example/form");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a mailto link when manual-assist has only an email", async () => {
    // Arrange
    server.use(
      http.post("*/api/reports/:id/submit", () =>
        HttpResponse.json({
          success: true,
          data: {
            reportId: "r1",
            status: "CONFIRMED",
            submitted: false,
            manualAssist: {
              intakeMethod: "EMAIL",
              agencyName: "Sanitation Dept",
              intakeUrl: null,
              intakeEmail: "intake@city.example",
            },
          },
        }),
      ),
    );
    const { user } = renderWithProviders(<SubmitReportAction reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit to agency/ }));

    // Assert
    expect(
      await screen.findByRole("link", { name: /Open official form/ }),
    ).toHaveAttribute("href", "mailto:intake@city.example");
  });

  it("shows the server error with a retry on failure", async () => {
    // Arrange
    server.use(
      http.post("*/api/reports/:id/submit", () =>
        HttpResponse.json(
          { success: false, error: "Submission failed: agency offline" },
          { status: 502 },
        ),
      ),
    );
    const { user } = renderWithProviders(<SubmitReportAction reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit to agency/ }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Submission failed: agency offline",
    );
    expect(
      screen.getByRole("button", { name: /Try again/ }),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables the button while a submission is in flight", async () => {
    // Arrange: a handler that never resolves keeps the submitting state active.
    server.use(
      http.post(
        "*/api/reports/:id/submit",
        () => new Promise<HttpResponse<null>>(() => {}),
      ),
    );
    const { user } = renderWithProviders(<SubmitReportAction reportId="r1" />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit to agency/ }));

    // Assert
    expect(
      await screen.findByRole("button", { name: /Submitting/ }),
    ).toBeDisabled();
  });
});
