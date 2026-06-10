import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test";

import { DescribeStep } from "./describe-step";
import type { LocationSource } from "@/hooks/use-geolocation";

// The real LocationMap pulls in Leaflet (touches `window` at import). Replace it
// with a marker we can assert on so "map renders only when lat+lon set" is
// testable without a real map.
vi.mock("./location-map", () => ({
  __esModule: true,
  default: ({
    latitude,
    longitude,
  }: {
    latitude: number;
    longitude: number;
  }) => (
    <div data-testid="location-map">
      map:{latitude},{longitude}
    </div>
  ),
}));

// Speech-recognition hook is mocked per-test so we control supported/listening.
const speechMock = {
  supported: true,
  listening: false,
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock("@/hooks/use-speech-recognition", () => ({
  useSpeechRecognition: () => speechMock,
}));

function baseProps() {
  return {
    imagePreview: null,
    description: "",
    address: "",
    latitude: null as number | null,
    longitude: null as number | null,
    accuracy: null as number | null,
    locationSource: null as LocationSource,
    locationLoading: false,
    locationSuggesting: false,
    addressSuggestions: [] as string[],
    locationError: null as string | null,
    classifying: false,
    classifyError: null as string | null,
    autoSuggesting: false,
    detectedIssueType: null as string | null,
    descriptionIsAiSuggestion: false,
    canSubmit: false,
    onImageClick: vi.fn(),
    onDrop: vi.fn(),
    onClearImage: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClearDescription: vi.fn(),
    onAddressChange: vi.fn(),
    onDetectLocation: vi.fn(),
    onLocationChange: vi.fn(),
    onClassify: vi.fn(),
  };
}

describe("DescribeStep", () => {
  beforeEach(() => {
    speechMock.supported = true;
    speechMock.listening = false;
    speechMock.error = null;
    speechMock.start = vi.fn();
    speechMock.stop = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the upload prompt when there is no image preview", () => {
    // Arrange / Act
    renderWithProviders(<DescribeStep {...baseProps()} />);

    // Assert
    expect(screen.getByText("Upload a photo")).toBeInTheDocument();
    expect(screen.queryByAltText("Issue preview")).not.toBeInTheDocument();
  });

  it("opens the photo chooser via onImageClick when the upload area is clicked", async () => {
    // Arrange: a single unified control. On a phone the native chooser behind
    // it offers both "Take Photo" and the photo library; on desktop it's the
    // file picker. There is no separate second button.
    const props = baseProps();
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.click(screen.getByText("Upload a photo"));

    // Assert
    expect(props.onImageClick).toHaveBeenCalledTimes(1);
  });

  it("shows a preview image and clear button when an image is set", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep {...baseProps()} imagePreview="blob:preview" />,
    );

    // Assert
    const preview = screen.getByAltText("Issue preview");
    expect(preview).toHaveAttribute("src", "blob:preview");
    expect(
      screen.getByRole("button", { name: "Remove image" }),
    ).toBeInTheDocument();
  });

  it("calls onClearImage (and not onImageClick) when the clear button is clicked", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(
      <DescribeStep {...props} imagePreview="blob:preview" />,
    );

    // Act
    await user.click(screen.getByRole("button", { name: "Remove image" }));

    // Assert: stopPropagation keeps the container click handler from firing.
    expect(props.onClearImage).toHaveBeenCalledTimes(1);
    expect(props.onImageClick).not.toHaveBeenCalled();
  });

  it("forwards description edits to onDescriptionChange", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.type(screen.getByLabelText("Description"), "x");

    // Assert
    expect(props.onDescriptionChange).toHaveBeenCalledWith("x");
  });

  it("hides the clear-description control when the field is empty", () => {
    // Arrange / Act: empty description -> nothing to clear.
    renderWithProviders(<DescribeStep {...baseProps()} description="" />);

    // Assert
    expect(
      screen.queryByRole("button", { name: "Clear description" }),
    ).not.toBeInTheDocument();
  });

  it("shows the clear-description control when the field has content", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep {...baseProps()} description="A large pothole." />,
    );

    // Assert
    expect(
      screen.getByRole("button", { name: "Clear description" }),
    ).toBeInTheDocument();
  });

  it("calls onClearDescription when the clear control is clicked", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(
      <DescribeStep
        {...props}
        descriptionIsAiSuggestion
        description="A large pothole in the roadway."
      />,
    );

    // Act
    await user.click(screen.getByRole("button", { name: "Clear description" }));

    // Assert: one-tap clear delegates to the parent; description state is owned
    // there, so the component only forwards the intent.
    expect(props.onClearDescription).toHaveBeenCalledTimes(1);
    expect(props.onDescriptionChange).not.toHaveBeenCalled();
  });

  it("starts dictation through the mic toggle when supported", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.click(
      screen.getByRole("button", { name: "Dictate description" }),
    );

    // Assert
    expect(speechMock.start).toHaveBeenCalledTimes(1);
    expect(speechMock.stop).not.toHaveBeenCalled();
  });

  it("stops dictation when already listening", async () => {
    // Arrange
    speechMock.listening = true;
    const props = baseProps();
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.click(screen.getByRole("button", { name: "Stop dictation" }));

    // Assert
    expect(speechMock.stop).toHaveBeenCalledTimes(1);
    expect(speechMock.start).not.toHaveBeenCalled();
  });

  it("shows a translated speech error message", () => {
    // Arrange / Act
    speechMock.error = "speech.denied";
    renderWithProviders(<DescribeStep {...baseProps()} />);

    // Assert: the i18n value for speech.denied is rendered, not the raw key.
    expect(screen.queryByText("speech.denied")).not.toBeInTheDocument();
    expect(
      screen.getByText(/microphone access|denied|allow/i),
    ).toBeInTheDocument();
  });

  it("hides the mic toggle when speech recognition is unsupported", () => {
    // Arrange / Act
    speechMock.supported = false;
    renderWithProviders(<DescribeStep {...baseProps()} />);

    // Assert
    expect(
      screen.queryByRole("button", { name: /dictate|stop dictation/i }),
    ).not.toBeInTheDocument();
  });

  it("opens address suggestions on focus and selects one on click", async () => {
    // Arrange
    const props = baseProps();
    props.addressSuggestions = ["123 Main St", "456 Oak Ave"];
    const { user } = renderWithProviders(<DescribeStep {...props} />);
    const input = screen.getByRole("combobox");

    // Act: focus opens the listbox.
    await user.click(input);

    // Assert: options visible.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const optionButton = screen
      .getByRole("option", { name: /123 Main St/ })
      .querySelector("button")!;

    // Act: selection runs on mousedown (the component preventDefaults it to keep
    // focus); fire mousedown explicitly to match real interaction.
    await user.pointer({ keys: "[MouseLeft>]", target: optionButton });

    // Assert: selection bubbles up and closes the list.
    expect(props.onAddressChange).toHaveBeenCalledWith("123 Main St");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });

  it("closes suggestions on an outside click", async () => {
    // Arrange
    const props = baseProps();
    props.addressSuggestions = ["123 Main St"];
    const { user } = renderWithProviders(
      <div>
        <DescribeStep {...props} />
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Act
    await user.click(screen.getByRole("button", { name: "outside" }));

    // Assert
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });

  it("disables the detect button while location is loading", () => {
    // Arrange / Act
    renderWithProviders(<DescribeStep {...baseProps()} locationLoading />);

    // Assert
    expect(
      screen.getByRole("button", { name: "Detect my location" }),
    ).toBeDisabled();
  });

  it("calls onDetectLocation when the detect button is clicked", async () => {
    // Arrange
    const props = baseProps();
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.click(
      screen.getByRole("button", { name: "Detect my location" }),
    );

    // Assert
    expect(props.onDetectLocation).toHaveBeenCalledTimes(1);
  });

  it.each([
    [10, /bg-ep-green-light/],
    [50, /bg-yellow-50/],
    [250, /bg-red-50/],
  ])(
    "renders an accuracy badge colored by accuracy=%s meters",
    (accuracy, classPattern) => {
      // Arrange / Act
      renderWithProviders(
        <DescribeStep
          {...baseProps()}
          latitude={37.4}
          longitude={-122.1}
          accuracy={accuracy}
        />,
      );

      // Assert
      const badge = screen.getByText(`±${Math.round(accuracy)}m`);
      expect(badge.className).toMatch(classPattern);
    },
  );

  it("renders the map only when both latitude and longitude are set", () => {
    // Arrange / Act: only latitude -> no map.
    const { rerender } = renderWithProviders(
      <DescribeStep {...baseProps()} latitude={37.4} longitude={null} />,
    );

    // Assert
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();

    // Act: both set -> map renders.
    rerender(
      <DescribeStep {...baseProps()} latitude={37.4} longitude={-122.1} />,
    );

    // Assert
    expect(screen.getByTestId("location-map")).toBeInTheDocument();
  });

  it("shows the photo-EXIF source hint only when locationSource is exif", () => {
    // Arrange / Act: a user-sourced location shows no "from photo" hint.
    const { rerender } = renderWithProviders(
      <DescribeStep
        {...baseProps()}
        latitude={40.5}
        longitude={-74.2}
        locationSource="user"
      />,
    );

    // Assert
    expect(screen.queryByText("From photo")).not.toBeInTheDocument();

    // Act: an EXIF-sourced location surfaces the hint + override guidance.
    rerender(
      <DescribeStep
        {...baseProps()}
        latitude={40.5}
        longitude={-74.2}
        locationSource="exif"
      />,
    );

    // Assert
    expect(screen.getByText("From photo")).toBeInTheDocument();
    expect(
      screen.getByText(/Location set from the photo's GPS data/),
    ).toBeInTheDocument();
  });

  it("disables the classify button when canSubmit is false", () => {
    // Arrange / Act
    renderWithProviders(<DescribeStep {...baseProps()} canSubmit={false} />);

    // Assert
    expect(
      screen.getByRole("button", { name: /Analyze Issue/ }),
    ).toBeDisabled();
  });

  it("calls onClassify when the analyze button is clicked and enabled", async () => {
    // Arrange
    const props = baseProps();
    props.canSubmit = true;
    const { user } = renderWithProviders(<DescribeStep {...props} />);

    // Act
    await user.click(screen.getByRole("button", { name: /Analyze Issue/ }));

    // Assert
    expect(props.onClassify).toHaveBeenCalledTimes(1);
  });

  it("shows the analyzing spinner state while classifying", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep {...baseProps()} canSubmit classifying />,
    );

    // Assert
    expect(screen.getByText("Analyzing with AI...")).toBeInTheDocument();
    expect(
      screen.getByText("Analyzing with AI...").closest("button"),
    ).toBeDisabled();
  });

  it("renders an error banner when classifyError is set", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep {...baseProps()} classifyError="Classification failed" />,
    );

    // Assert
    expect(screen.getByText("Classification failed")).toBeInTheDocument();
  });

  it("shows the 'Analyzing photo...' indicator while auto-suggesting", () => {
    // Arrange / Act
    renderWithProviders(<DescribeStep {...baseProps()} autoSuggesting />);

    // Assert
    expect(screen.getByText("Analyzing photo...")).toBeInTheDocument();
  });

  it("badges the description as an AI suggestion and shows the editable hint", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep
        {...baseProps()}
        descriptionIsAiSuggestion
        description="A large pothole in the roadway."
      />,
    );

    // Assert: the badge and the "you can edit/clear it" hint are both shown.
    expect(screen.getByText("AI suggestion")).toBeInTheDocument();
    expect(screen.getByText(/edit or clear it/i)).toBeInTheDocument();
  });

  it("surfaces the detected issue type as a hint", () => {
    // Arrange / Act
    renderWithProviders(
      <DescribeStep {...baseProps()} detectedIssueType="ROAD_DAMAGE" />,
    );

    // Assert: the localized issue label is rendered next to the "Detected issue:" hint.
    expect(screen.getByText("Detected issue:")).toBeInTheDocument();
    expect(screen.getByText("Road Damage")).toBeInTheDocument();
  });

  it("hides the AI-suggestion badge while auto-suggesting is in flight", () => {
    // Arrange / Act: the in-flight indicator takes precedence over the badge.
    renderWithProviders(
      <DescribeStep
        {...baseProps()}
        autoSuggesting
        descriptionIsAiSuggestion
        description="draft"
      />,
    );

    // Assert
    expect(screen.getByText("Analyzing photo...")).toBeInTheDocument();
    expect(screen.queryByText("AI suggestion")).not.toBeInTheDocument();
  });
});
