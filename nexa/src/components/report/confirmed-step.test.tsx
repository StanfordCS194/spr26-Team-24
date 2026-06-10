import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonGet, renderWithProviders, screen, server, waitFor } from "@/test";

import { ConfirmedStep } from "./confirmed-step";

// ConfirmedStep mounts <SubmissionAssistant>, which fetches submission fields on
// mount. Stub it (no agency -> the assistant renders nothing) so these tests
// stay offline and focused on the confirmation panel itself.
function stubSubmissionFields() {
  server.use(
    jsonGet("*/api/reports/:id/submission-fields", {
      agency: null,
      fields: [],
    }),
  );
}

function baseReport() {
  return {
    id: "report_abc",
    issueType: "ROAD_DAMAGE",
    aiDescription: "A deep pothole in the road.",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("ConfirmedStep", () => {
  beforeEach(() => {
    stubSubmissionFields();
  });

  it("renders the success heading and report id", () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={vi.fn()} />,
    );

    // Assert
    expect(screen.getByText("Report submitted!")).toBeInTheDocument();
    expect(screen.getByText("report_abc")).toBeInTheDocument();
  });

  it("renders the translated issue label", () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={vi.fn()} />,
    );

    // Assert
    expect(screen.getByText("Road Damage")).toBeInTheDocument();
  });

  it("falls back to the unknown label when issueType is null", () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep
        report={{ ...baseReport(), issueType: null }}
        onReportAnother={vi.fn()}
      />,
    );

    // Assert
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders a machine-readable submitted timestamp", () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={vi.fn()} />,
    );

    // Assert: the <time> carries the ISO datetime regardless of relative wording.
    const time = screen.getByText(
      (_, el) => el?.tagName === "TIME",
    ) as HTMLTimeElement;
    expect(time).toHaveAttribute("datetime", "2025-01-01T00:00:00.000Z");
  });

  it("shows the AI summary only when present", () => {
    // Arrange / Act: present.
    const { rerender } = renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={vi.fn()} />,
    );
    expect(screen.getByText("A deep pothole in the road.")).toBeInTheDocument();

    // Act: absent -> the summary section disappears.
    rerender(
      <ConfirmedStep
        report={{ ...baseReport(), aiDescription: null }}
        onReportAnother={vi.fn()}
      />,
    );

    // Assert
    expect(
      screen.queryByText("A deep pothole in the road."),
    ).not.toBeInTheDocument();
  });

  it("links to the dashboard", () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={vi.fn()} />,
    );

    // Assert
    expect(
      screen.getByRole("link", { name: "View Dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("calls onReportAnother when the report-another button is clicked", async () => {
    // Arrange
    const onReportAnother = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmedStep report={baseReport()} onReportAnother={onReportAnother} />,
    );

    // Act
    await user.click(
      screen.getByRole("button", { name: /Report Another Issue/ }),
    );

    // Assert
    expect(onReportAnother).toHaveBeenCalledTimes(1);
  });

  it("renders the offline saved state and skips the submission assistant", async () => {
    // Arrange / Act
    renderWithProviders(
      <ConfirmedStep report={baseReport()} offline onReportAnother={vi.fn()} />,
    );

    // Assert: offline copy is shown; assistant (which would show a loader) is not.
    expect(screen.getByText("Saved offline")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your filing details…"),
      ).not.toBeInTheDocument(),
    );
  });
});
