import { describe, expect, it } from "vitest";

import { renderWithProviders, screen } from "@/test";

import { ReportCard, type DashboardReport } from "./report-card";

// The expand/collapse control is a role="button" whose accessible name is its
// own text content (issue label, location, status…), so query it by its stable
// aria-controls hook instead of by name.
function getToggle(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[aria-controls^="report-"]');
  if (!el) throw new Error("toggle not found");
  return el;
}

function makeDashboardReport(
  overrides: Partial<DashboardReport> = {},
): DashboardReport {
  return {
    id: "report_1",
    issueType: "ROAD_DAMAGE",
    status: "CONFIRMED",
    description: "Big pothole on the corner.",
    aiDescription: "A deep pothole posing a hazard.",
    address:
      "Coupa Cafe, 538, Ramona Street, Palo Alto, Santa Clara County, California, 94301, United States",
    imageUrl: "https://example.com/photo.jpg",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    externalTrackingId: null,
    userResolved: null,
    ...overrides,
  };
}

describe("ReportCard (collapsed)", () => {
  it("renders the issue label, shortened location and status pill", () => {
    // Arrange / Act
    renderWithProviders(<ReportCard report={makeDashboardReport()} />);

    // Assert: shortenAddress reduces the long address to "City, ST".
    expect(screen.getByText("Road Damage")).toBeInTheDocument();
    expect(screen.getByText("Palo Alto, CA")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("colors the status pill by status", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard report={makeDashboardReport({ status: "SUBMITTED" })} />,
    );

    // Assert
    const pill = screen.getByText("Submitted");
    expect(pill.className).toMatch(/bg-ep-purple-light/);
  });

  it("uses the uncategorized label when there is no issue type", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard report={makeDashboardReport({ issueType: null })} />,
    );

    // Assert
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  it("shows a relative-time tooltip carrying the ISO datetime", () => {
    // Arrange / Act
    renderWithProviders(<ReportCard report={makeDashboardReport()} />);

    // Assert
    const time = screen.getByText(
      (_, el) => el?.tagName === "TIME",
    ) as HTMLTimeElement;
    expect(time).toHaveAttribute("datetime", "2025-01-01T00:00:00.000Z");
  });

  it("renders a delete button without expanding the card", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard report={makeDashboardReport()} />,
    );
    const region = getToggle();

    // Act: clicking delete must not toggle the card (stopPropagation).
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Assert: still collapsed.
    expect(region).toHaveAttribute("aria-expanded", "false");
  });
});

describe("ReportCard (expand/collapse)", () => {
  it("expands to show the photo and description on click", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard report={makeDashboardReport()} />,
    );
    const toggle = getToggle();

    // Act
    await user.click(toggle);

    // Assert
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Photo")).toBeInTheDocument();
    expect(screen.getByAltText(/Road Damage/)).toHaveAttribute(
      "src",
      "https://example.com/photo.jpg",
    );
    expect(screen.getByText("Big pothole on the corner.")).toBeInTheDocument();
  });

  it("toggles via the Enter key", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard report={makeDashboardReport()} />,
    );
    const toggle = getToggle();
    toggle.focus();

    // Act
    await user.keyboard("{Enter}");

    // Assert
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles via the Space key", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard report={makeDashboardReport()} />,
    );
    const toggle = getToggle();
    toggle.focus();

    // Act
    await user.keyboard("[Space]");

    // Assert
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the ImageOff placeholder when there is no photo", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard report={makeDashboardReport({ imageUrl: null })} />,
    );

    // Act
    await user.click(getToggle());

    // Assert
    expect(screen.getByText("No photo attached")).toBeInTheDocument();
  });

  it("falls back to a no-description message when both descriptions are empty", async () => {
    // Arrange
    const { user } = renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          description: null,
          aiDescription: null,
        })}
      />,
    );

    // Act
    await user.click(getToggle());

    // Assert
    expect(
      screen.getByText("No description was provided for this report."),
    ).toBeInTheDocument();
  });
});

describe("ReportCard resolution prompt visibility", () => {
  // A report old enough (>=14d) and unresolved should surface the prompt.
  const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  it("shows the resolution prompt for a stale, unresolved, non-external report", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          status: "SUBMITTED",
          createdAt: stale,
          updatedAt: stale,
        })}
      />,
    );

    // Assert
    expect(screen.getByText("Yes, fixed")).toBeInTheDocument();
  });

  it("hides the prompt when the report has an external tracking id", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          status: "SUBMITTED",
          createdAt: stale,
          updatedAt: stale,
          externalTrackingId: "EXT-123",
        })}
      />,
    );

    // Assert
    expect(screen.queryByText("Yes, fixed")).not.toBeInTheDocument();
  });

  it("hides the prompt when the user already answered", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          status: "SUBMITTED",
          createdAt: stale,
          updatedAt: stale,
          userResolved: false,
        })}
      />,
    );

    // Assert
    expect(screen.queryByText("Yes, fixed")).not.toBeInTheDocument();
  });

  it("hides the prompt when the report is too recent", () => {
    // Arrange / Act: default report is recent (createdAt 2025-01-01 is far past
    // but updatedAt is also fixed; use a fresh date to be unambiguous).
    const recent = new Date();
    renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          status: "SUBMITTED",
          createdAt: recent,
          updatedAt: recent,
        })}
      />,
    );

    // Assert
    expect(screen.queryByText("Yes, fixed")).not.toBeInTheDocument();
  });

  it("hides the prompt for a hiding status (RESOLVED) even when stale", () => {
    // Arrange / Act
    renderWithProviders(
      <ReportCard
        report={makeDashboardReport({
          status: "RESOLVED",
          createdAt: stale,
          updatedAt: stale,
        })}
      />,
    );

    // Assert
    expect(screen.queryByText("Yes, fixed")).not.toBeInTheDocument();
  });
});
