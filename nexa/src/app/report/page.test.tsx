// @vitest-environment jsdom
//
// This page is a client component (DOM render + userEvent), so it overrides the
// node default the `src/app/**` glob otherwise applies (that glob exists for API
// route tests). The orchestration under test — auto-classify on photo upload,
// the no-overwrite-user-text guard, and the single-classify cache — lives in
// this page, so it must be exercised in jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test";

// The report page is a thick orchestrator. We replace the heavy presentational
// steps with thin probes that render the props this feature cares about
// (description text, AI-suggestion flag, detected issue, auto-suggesting) and
// expose buttons to drive the page's callbacks. The auto-suggest-on-upload
// orchestration in page.tsx is exercised for real against a stubbed classify
// route via the real useImageUpload + useReportSubmission hooks.

vi.mock("@/components/report/describe-step", () => ({
  DescribeStep: (props: {
    description: string;
    descriptionIsAiSuggestion: boolean;
    autoSuggesting: boolean;
    detectedIssueType: string | null;
    onDescriptionChange: (v: string) => void;
    onClassify: () => void;
  }) => (
    <div>
      <div data-testid="description">{props.description}</div>
      <div data-testid="is-ai">{String(props.descriptionIsAiSuggestion)}</div>
      <div data-testid="auto-suggesting">{String(props.autoSuggesting)}</div>
      <div data-testid="detected">{props.detectedIssueType ?? ""}</div>
      <button onClick={() => props.onDescriptionChange("user typed")}>
        type
      </button>
      <button onClick={() => props.onClassify()}>analyze</button>
    </div>
  ),
}));

vi.mock("@/components/report/review-step", () => ({
  ReviewStep: () => <div data-testid="review-step" />,
}));
vi.mock("@/components/report/confirmed-step", () => ({
  ConfirmedStep: () => <div data-testid="confirmed-step" />,
}));
vi.mock("@/components/report/stepper", () => ({
  Stepper: () => null,
}));

// Geolocation / lookups are inert for this feature; stub them to no-ops so the
// page mounts without GPS, maps, or network address lookups.
vi.mock("@/hooks/use-geolocation", () => ({
  useGeolocation: () => ({
    latitude: null,
    longitude: null,
    accuracy: null,
    address: "",
    source: null,
    loading: false,
    error: null,
    detect: vi.fn(),
    movePin: vi.fn(),
    setAddress: vi.fn(),
    setCoordinates: vi.fn(),
    applyExifFallback: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-address-lookup", () => ({
  useAddressLookup: () => ({
    suggestions: [],
    suggesting: false,
    lookup: vi.fn(),
    setSuggestions: vi.fn(),
    setSuggesting: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-form-lookup", () => ({
  useFormLookup: () => ({
    officialForm: null,
    loading: false,
    lookup: vi.fn(),
    setOfficialForm: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-agency-candidates", () => ({
  useAgencyCandidates: () => ({
    result: null,
    loading: false,
    error: false,
    lookup: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
  }),
}));

// Drive the image hook directly so a test can "upload" a photo.
let setImage: (base64: string | null) => void = () => {};
vi.mock("@/hooks/use-image-upload", async () => {
  const { useState } = await import("react");
  return {
    useImageUpload: () => {
      const [imageBase64, set] = useState<string | null>(null);
      setImage = set;
      return {
        imagePreview: imageBase64,
        imageBase64,
        handleFileInput: vi.fn(),
        handleDrop: vi.fn(),
        clearImage: () => set(null),
      };
    },
  };
});

import ReportPage from "./page";

const WINNER = {
  issueType: "ROAD_DAMAGE",
  aiDescription: "A large pothole in the roadway.",
  severity: "high",
  confidence: 0.95,
};
const PAYLOAD = {
  success: true,
  data: {
    winner: WINNER,
    allResults: [{ provider: "stub", latencyMs: 5, ...WINNER }],
    consensus: true,
    method: "unanimous",
    preprocess: null,
    locationUsed: null,
  },
};

function stubFetch() {
  const classify = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(PAYLOAD),
  });
  const fetchMock = vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/reports/classify")) {
      return classify(url);
    }
    // /api/auth/me and anything else: benign ok.
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return classify;
}

describe("ReportPage auto-suggest on upload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setImage = () => {};
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-fills an empty description with the AI suggestion + detected issue", async () => {
    // Arrange
    stubFetch();
    renderWithProviders(<ReportPage />);

    // Act: upload a photo.
    setImage("data:image/jpeg;base64,AAAA");

    // Assert: the empty field is populated, badged AI, and the issue surfaced.
    await waitFor(() =>
      expect(screen.getByTestId("description")).toHaveTextContent(
        WINNER.aiDescription,
      ),
    );
    expect(screen.getByTestId("is-ai")).toHaveTextContent("true");
    expect(screen.getByTestId("detected")).toHaveTextContent("ROAD_DAMAGE");
  });

  it("never overwrites text the user has already typed", async () => {
    // Arrange
    stubFetch();
    const { user } = renderWithProviders(<ReportPage />);

    // Act: user types first, then uploads a photo.
    await user.click(screen.getByText("type"));
    setImage("data:image/jpeg;base64,AAAA");

    // Assert: classification still runs (detected issue shows) but the user's
    // text is preserved and not badged as an AI suggestion.
    await waitFor(() =>
      expect(screen.getByTestId("detected")).toHaveTextContent("ROAD_DAMAGE"),
    );
    expect(screen.getByTestId("description")).toHaveTextContent("user typed");
    expect(screen.getByTestId("is-ai")).toHaveTextContent("false");
  });

  it("does not classify twice when proceeding to review with unchanged inputs", async () => {
    // Arrange
    const classify = stubFetch();
    const { user } = renderWithProviders(<ReportPage />);

    // Act: upload (auto-classify) then click Analyze with the same inputs.
    setImage("data:image/jpeg;base64,AAAA");
    await waitFor(() =>
      expect(screen.getByTestId("description")).toHaveTextContent(
        WINNER.aiDescription,
      ),
    );
    await user.click(screen.getByText("analyze"));

    // Assert: Analyze advanced to review using the cached result — classify
    // route was POSTed exactly once.
    await waitFor(() =>
      expect(screen.getByTestId("review-step")).toBeInTheDocument(),
    );
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully when classification fails", async () => {
    // Arrange: classify route errors (e.g. no AI keys).
    const failing = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/reports/classify")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () =>
            JSON.stringify({ success: false, error: "no keys" }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", failing);
    renderWithProviders(<ReportPage />);

    // Act
    setImage("data:image/jpeg;base64,AAAA");

    // Assert: no suggestion, no detected issue, field left empty for the user.
    await waitFor(() =>
      expect(screen.getByTestId("auto-suggesting")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("description")).toHaveTextContent("");
    expect(screen.getByTestId("is-ai")).toHaveTextContent("false");
    expect(screen.getByTestId("detected")).toHaveTextContent("");
  });
});
