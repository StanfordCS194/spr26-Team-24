import { describe, expect, it } from "vitest";

import { renderWithProviders, screen } from "@/test";

import { Stepper } from "./stepper";

// Component test (jsdom project): renders a real component through the app
// providers via renderWithProviders.
describe("Stepper", () => {
  it("renders all three step labels", () => {
    // Arrange / Act
    renderWithProviders(<Stepper current="describe" />);

    // Assert: i18n labels for the three steps are present.
    expect(screen.getByText(/describe/i)).toBeInTheDocument();
    expect(screen.getByText(/review/i)).toBeInTheDocument();
    // The "confirmed" step renders the "done" label.
    expect(screen.getByText(/done|confirm/i)).toBeInTheDocument();
  });

  it("shows the step number for the active step", () => {
    // Arrange / Act
    renderWithProviders(<Stepper current="describe" />);

    // Assert: the first (active) step shows its number, not a check icon.
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
