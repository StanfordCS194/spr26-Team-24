import { describe, expect, it } from "vitest";

import { renderWithProviders, screen } from "@/test";

import { ProcessSection } from "./process-section";

describe("ProcessSection", () => {
  it("renders the three workflow step titles", () => {
    // Act
    renderWithProviders(<ProcessSection />);

    // Assert
    expect(screen.getByText("Snap and describe")).toBeInTheDocument();
    expect(screen.getByText("AI classifies & routes")).toBeInTheDocument();
    expect(screen.getByText("Report filed")).toBeInTheDocument();
  });

  it("renders the embedded demo video under the steps", () => {
    // Act
    renderWithProviders(<ProcessSection />);

    // Assert
    const video = screen.getByTestId("demo-video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", "/demo-workflow.mp4");
    expect(
      screen.getByText("Watch the full flow — from photo to a filed report."),
    ).toBeInTheDocument();
  });
});
