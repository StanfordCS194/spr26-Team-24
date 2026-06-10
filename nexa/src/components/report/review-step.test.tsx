import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "@/test";

import { ReviewStep } from "./review-step";

type OfficialForm = Parameters<typeof ReviewStep>[0]["officialForm"];
type Candidates = Parameters<typeof ReviewStep>[0]["agencyCandidates"];

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
    agencyCandidates: null as Candidates,
    agencyCandidatesLoading: false,
    agencyCandidatesError: false,
    onRetryAgencyCandidates: vi.fn(),
    selectedAgencyId: null as string | null,
    onSelectAgency: vi.fn(),
    customAgencyUrl: "",
    onCustomAgencyUrlChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onAddressChange: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
  };
}

/** Two agencies covering the same Menlo Park spot — the canonical ambiguity. */
const AMBIGUOUS_CANDIDATES: Candidates = {
  agencyId: null,
  candidates: [
    {
      id: "agency-act",
      name: "Menlo Park ACT",
      jurisdiction: "city-menlo-park",
      intakeMethod: "WEB_FORM",
    },
    {
      id: "agency-open311",
      name: "Menlo Park SeeClickFix (Open311)",
      jurisdiction: "city-menlo-park",
      intakeMethod: "API",
    },
  ],
  disambiguation:
    "More than one office handles this here. Which should we file your report with?",
};

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

  it("marks the description field as optional", () => {
    // Arrange / Act
    renderWithProviders(<ReviewStep {...baseProps()} />);

    // Assert: the user knows they can lean on the photo + AI instead of typing.
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("adopts the AI description into the editable field in one tap", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<ReviewStep {...props} />);

    // Act
    await user.click(
      screen.getByRole("button", { name: "Use this description" }),
    );

    // Assert: the AI suggestion is copied into the editable description.
    expect(props.onDescriptionChange).toHaveBeenCalledWith(
      "A deep pothole in the road.",
    );
  });

  it("hides the adopt button once the description already matches the AI text", () => {
    // Arrange / Act: editable description equals the AI suggestion.
    const props = baseProps();
    props.description = props.classification.aiDescription;
    renderWithProviders(<ReviewStep {...props} />);

    // Assert: nothing left to adopt.
    expect(
      screen.queryByRole("button", { name: "Use this description" }),
    ).not.toBeInTheDocument();
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

  it("renders candidate agencies and the disambiguating question when ambiguous", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep {...baseProps()} agencyCandidates={AMBIGUOUS_CANDIDATES} />,
    );

    // Assert: question + both candidates (name, jurisdiction, intake method).
    expect(
      screen.getByText(AMBIGUOUS_CANDIDATES.disambiguation as string),
    ).toBeInTheDocument();
    expect(screen.getByText("Menlo Park ACT")).toBeInTheDocument();
    expect(
      screen.getByText("Menlo Park SeeClickFix (Open311)"),
    ).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
  });

  it("calls onSelectAgency with the chosen candidate id", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(
      <ReviewStep {...props} agencyCandidates={AMBIGUOUS_CANDIDATES} />,
    );

    // Act: pick the Open311 agency (the Menlo Park unblock case).
    await user.click(screen.getByText("Menlo Park SeeClickFix (Open311)"));

    // Assert
    expect(props.onSelectAgency).toHaveBeenCalledWith("agency-open311");
  });

  it("disables submit until the user picks an agency when ambiguous", () => {
    // Arrange / Act: ambiguous, nothing selected yet.
    const { rerender } = renderWithProviders(
      <ReviewStep
        {...baseProps()}
        agencyCandidates={AMBIGUOUS_CANDIDATES}
        selectedAgencyId={null}
      />,
    );

    // Assert: submit is blocked until a choice is made.
    expect(
      screen.getByRole("button", { name: /Submit Report/ }),
    ).toBeDisabled();

    // Act: once selected, submit unlocks.
    rerender(
      <ReviewStep
        {...baseProps()}
        agencyCandidates={AMBIGUOUS_CANDIDATES}
        selectedAgencyId="agency-open311"
      />,
    );

    // Assert
    expect(
      screen.getByRole("button", { name: /Submit Report/ }),
    ).not.toBeDisabled();
  });

  it("shows no disambiguation prompt for an unambiguous single candidate", () => {
    // Arrange / Act
    renderWithProviders(
      <ReviewStep
        {...baseProps()}
        agencyCandidates={{
          agencyId: "agency-act",
          candidates: [
            {
              id: "agency-act",
              name: "Menlo Park ACT",
              jurisdiction: "city-menlo-park",
              intakeMethod: "WEB_FORM",
            },
          ],
          disambiguation: null,
        }}
      />,
    );

    // Assert: no picker, no regression to the submit button.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Submit Report/ }),
    ).not.toBeDisabled();
  });

  it("shows an error message and a retry when the candidate fetch fails", async () => {
    // Arrange: fetch failed (no candidates), error flagged.
    const props = baseProps();
    const { user } = renderWithProviders(
      <ReviewStep {...props} agencyCandidates={null} agencyCandidatesError />,
    );

    // Assert: informative error + retry, and submission is NOT blocked (the
    // user is never stuck — the create route still routes server-side).
    expect(
      screen.getByText(/We couldn't load filing options/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Submit Report/ }),
    ).not.toBeDisabled();

    // Act: retry re-runs the lookup.
    await user.click(screen.getByRole("button", { name: /^Retry$/ }));

    // Assert
    expect(props.onRetryAgencyCandidates).toHaveBeenCalledTimes(1);
  });

  it("disables the retry button and shows retrying text while reloading", () => {
    // Arrange / Act: error flagged and a retry already in flight.
    renderWithProviders(
      <ReviewStep
        {...baseProps()}
        agencyCandidates={null}
        agencyCandidatesError
        agencyCandidatesLoading
      />,
    );

    // Assert
    const retrying = screen.getByText("Retrying...");
    expect(retrying.closest("button")).toBeDisabled();
  });

  it("renders the wrong-agency override field with its label and helper text", () => {
    // Arrange / Act
    renderWithProviders(<ReviewStep {...baseProps()} />);

    // Assert: the override section is present at the bottom of the form.
    expect(screen.getByText("Filing somewhere else?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "If we routed to the wrong agency, paste the correct agency's link here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("https://city.gov/report"),
    ).toBeInTheDocument();
  });

  it("forwards edits to the custom agency URL field", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<ReviewStep {...props} />);

    // Act
    await user.type(
      screen.getByPlaceholderText("https://city.gov/report"),
      "x",
    );

    // Assert
    expect(props.onCustomAgencyUrlChange).toHaveBeenCalledWith("x");
  });

  it("shows an informative message when the candidate list is empty", () => {
    // Arrange / Act: fetch succeeded but no agency covers this spot.
    renderWithProviders(
      <ReviewStep
        {...baseProps()}
        agencyCandidates={{
          agencyId: null,
          candidates: [],
          disambiguation: null,
        }}
      />,
    );

    // Assert: no picker, an informative message, submission unblocked.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No specific agency matched this location/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Submit Report/ }),
    ).not.toBeDisabled();
  });
});
