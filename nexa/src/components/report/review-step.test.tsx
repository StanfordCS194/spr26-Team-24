import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "@/test";

import { ReviewStep } from "./review-step";

type OfficialForm = Parameters<typeof ReviewStep>[0]["officialForm"];

function baseProps() {
  return {
    classification: {
      issueType: "ROAD_DAMAGE" as const,
      aiDescription: "A deep pothole in the road.",
      severity: "high" as "low" | "medium" | "high",
      confidence: 0.92,
    },
    imagePreview: null as string | null,
    description: "Big pothole",
    address: "University Ave, Palo Alto",
    submitting: false,
    submitError: null as string | null,
    officialForm: null as OfficialForm,
    officialFormLoading: false,
    onDescriptionChange: vi.fn(),
    onAddressChange: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe("ReviewStep", () => {
  it("renders the classified issue label and AI description", () => {
    // Arrange / Act
    renderWithProviders(<ReviewStep {...baseProps()} />);

    // Assert: issue.ROAD_DAMAGE label + the AI description text.
    expect(screen.getByText("Road Damage")).toBeInTheDocument();
    expect(screen.getByText("A deep pothole in the road.")).toBeInTheDocument();
  });

  it.each([
    ["high", /bg-red-50/],
    ["medium", /bg-yellow-50/],
    ["low", /bg-ep-green-light/],
  ] as const)("colors the %s severity badge", (severity, classPattern) => {
    // Arrange / Act
    const props = baseProps();
    props.classification.severity = severity;
    renderWithProviders(<ReviewStep {...props} />);

    // Assert
    const badge = screen.getByText(severity, { selector: "span" });
    expect(badge.className).toMatch(classPattern);
  });

  it("shows the image preview when provided", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep {...baseProps()} imagePreview="blob:pic" />,
    );

    // Assert
    expect(screen.getByAltText("Issue preview")).toHaveAttribute(
      "src",
      "blob:pic",
    );
  });

  it("forwards edits to the description and address fields", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<ReviewStep {...props} />);

    // Act
    await user.type(screen.getByDisplayValue("Big pothole"), "!");
    await user.type(screen.getByDisplayValue("University Ave, Palo Alto"), "!");

    // Assert
    expect(props.onDescriptionChange).toHaveBeenCalledWith("Big pothole!");
    expect(props.onAddressChange).toHaveBeenCalledWith(
      "University Ave, Palo Alto!",
    );
  });

  it("shows a loading state while the official form is being looked up", () => {
    // Arrange / Act
    renderWithProviders(<ReviewStep {...baseProps()} officialFormLoading />);

    // Assert
    expect(
      screen.getByText("Finding official city form..."),
    ).toBeInTheDocument();
  });

  it("renders a found official form with link, city, confidence and reason", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep
        {...baseProps()}
        officialForm={{
          status: "found",
          cityName: "Palo Alto",
          formUrl: "https://paloalto.gov/report",
          reason: "Matched the city jurisdiction.",
          confidence: "high",
        }}
      />,
    );

    // Assert
    const link = screen.getByRole("link", {
      name: /Open official city form/,
    });
    expect(link).toHaveAttribute("href", "https://paloalto.gov/report");
    expect(
      screen.getByText("Official city website for Palo Alto"),
    ).toBeInTheDocument();
    expect(screen.getByText("Confidence: high")).toBeInTheDocument();
    expect(
      screen.getByText("Matched the city jurisdiction."),
    ).toBeInTheDocument();
  });

  it("renders the not-found message when no official form is available", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep
        {...baseProps()}
        officialForm={{
          status: "not_found",
          cityName: null,
          message: "irrelevant",
          reason: "Outside any known jurisdiction.",
        }}
      />,
    );

    // Assert
    expect(
      screen.getByText("No official city form found."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Outside any known jurisdiction."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open official city form/ }),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<ReviewStep {...props} />);

    // Act
    await user.click(screen.getByRole("button", { name: /Back/ }));

    // Assert
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("calls onSubmit when the submit button is clicked", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<ReviewStep {...props} />);

    // Act
    await user.click(screen.getByRole("button", { name: /Submit Report/ }));

    // Assert
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the submit button and shows submitting text while submitting", () => {
    // Arrange / Act
    renderWithProviders(<ReviewStep {...baseProps()} submitting />);

    // Assert
    const submitting = screen.getByText("Submitting...");
    expect(submitting.closest("button")).toBeDisabled();
  });

  it("renders a submit error banner", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep {...baseProps()} submitError="Submission failed" />,
    );

    // Assert
    expect(screen.getByText("Submission failed")).toBeInTheDocument();
  });
});
