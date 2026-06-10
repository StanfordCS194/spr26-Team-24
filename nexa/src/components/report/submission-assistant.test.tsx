import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonGet,
  jsonPost,
  renderWithProviders,
  screen,
  server,
  waitFor,
} from "@/test";

import { SubmissionAssistant } from "./submission-assistant";

// The K2 `report_submitted` event is emitted via usePostHog(). PostHogProvider
// no-ops in tests (no NEXT_PUBLIC_POSTHOG_KEY), so mock the hook to expose a
// spyable `capture` and assert on the timed event the assistant emits (#240).
const capture = vi.fn();
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture }),
}));

function submitResponse(
  submitted: boolean,
  extra: Record<string, unknown> = {},
) {
  return {
    success: true,
    data: {
      reportId: "report_abc",
      status: submitted ? "SUBMITTED" : "CONFIRMED",
      submitted,
      ...extra,
    },
  };
}

describe("SubmissionAssistant K2 emit (#240)", () => {
  beforeEach(() => {
    capture.mockClear();
  });

  it("emits report_submitted with time_to_submit_ms on a real agency submission", async () => {
    // Arrange: the orchestrator reports a real API/EMAIL submission.
    server.use(
      jsonPost(
        "*/api/reports/:id/submit",
        submitResponse(true, {
          externalTrackingId: "TRK-1",
        }),
      ),
    );
    const captureStart = Date.now() - 5_000;

    // Act
    renderWithProviders(
      <SubmissionAssistant
        reportId="report_abc"
        issueType="ROAD_DAMAGE"
        captureStartedAt={captureStart}
        hasImage
        hasLocation={false}
      />,
    );

    // Assert: success state + a single timed report_submitted event.
    expect(
      await screen.findByText("Filed with the agency"),
    ).toBeInTheDocument();
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    const [event, props] = capture.mock.calls[0];
    expect(event).toBe("report_submitted");
    expect(props).toMatchObject({
      report_id: "report_abc",
      issue_type: "ROAD_DAMAGE",
      has_image: true,
      has_location: false,
    });
    // Measured from first capture -> now (>= the 5s we backdated the clock).
    expect(props.time_to_submit_ms).toBeGreaterThanOrEqual(5_000);
    expect(props.time_to_submit_ms).toBeLessThan(60_000);
  });

  it("does NOT emit report_submitted for manual-assist (CONFIRMED, not submitted)", async () => {
    // Arrange: WEB_FORM/PHONE agency -> manual assist, report stays CONFIRMED.
    server.use(
      jsonPost("*/api/reports/:id/submit", submitResponse(false)),
      jsonGet("*/api/reports/:id/submission-fields", {
        agency: null,
        fields: [],
      }),
    );

    // Act
    renderWithProviders(
      <SubmissionAssistant reportId="report_abc" issueType="ROAD_DAMAGE" />,
    );

    // Assert: the manual-assist path resolves and no K2 event is emitted.
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your filing details…"),
      ).not.toBeInTheDocument(),
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("falls back to now() for time_to_submit_ms when the clock never started", async () => {
    // Arrange: captureStartedAt omitted (0) — defensive fallback path.
    server.use(jsonPost("*/api/reports/:id/submit", submitResponse(true)));

    // Act
    renderWithProviders(<SubmissionAssistant reportId="report_abc" />);

    // Assert: still emits with a small, non-negative interval.
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    const [event, props] = capture.mock.calls[0];
    expect(event).toBe("report_submitted");
    expect(props.time_to_submit_ms).toBeGreaterThanOrEqual(0);
    expect(props.time_to_submit_ms).toBeLessThan(5_000);
  });
});
