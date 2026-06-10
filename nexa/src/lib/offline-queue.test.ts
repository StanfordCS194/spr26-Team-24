// @vitest-environment jsdom
//
// offline-queue is a *client* module: it reads/writes `window.localStorage`,
// checks `navigator.onLine`, and (on a successful replay) emits the K2
// `report_submitted` PostHog event (#237). The lib/** glob places this file in
// the node project, so we pin jsdom (real `window` + the in-memory localStorage
// polyfill from vitest.setup.tsx) to exercise the real queue/replay logic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import posthog from "posthog-js";
import { flushQueue, getQueuedCount, queueReport } from "./offline-queue";

const STORAGE_KEY = "nexa:offline-report-queue";

// PostHog is mocked so we can assert what the replay emits without a live
// project. `__loaded` is true so the instrumentation runs (it no-ops otherwise).
vi.mock("posthog-js", () => ({
  default: { __loaded: true, capture: vi.fn() },
}));

const captureMock = vi.mocked(posthog.capture);

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

/** A representative create-route success body (used as the replay response). */
function createdReportResponse(id = "rep_replayed_1"): Response {
  return new Response(JSON.stringify({ success: true, data: { id } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PAYLOAD = {
  description: "Pothole on Main St",
  issueType: "ROAD_DAMAGE",
  latitude: 37.4,
  longitude: -122.1,
  imageUrl: "data:image/png;base64,abc",
};

describe("offline-queue", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOnline(true);
    captureMock.mockClear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("queueReport", () => {
    it("persists the payload and the capture-start timestamp", () => {
      queueReport(PAYLOAD, 1000);
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].payload).toMatchObject(PAYLOAD);
      expect(stored[0].captureStartedAt).toBe(1000);
      expect(typeof stored[0].queuedAt).toBe("number");
    });

    it("omits captureStartedAt when it is absent or 0 (clock never started)", () => {
      queueReport(PAYLOAD, 0);
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      );
      expect("captureStartedAt" in stored[0]).toBe(false);
    });
  });

  describe("flushQueue", () => {
    it("does nothing while offline", async () => {
      queueReport(PAYLOAD, 1000);
      setOnline(false);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const flushed = await flushQueue();

      expect(flushed).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getQueuedCount()).toBe(1);
    });

    it("emits report_submitted with time_to_submit_ms + offline:true on a successful replay", async () => {
      const captureStart = Date.now() - 5_000; // first capture 5s before replay
      queueReport(PAYLOAD, captureStart);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        createdReportResponse("rep_replayed_1"),
      );

      const flushed = await flushQueue();

      expect(flushed).toBe(1);
      // Replayed item removed from the queue.
      expect(getQueuedCount()).toBe(0);

      expect(captureMock).toHaveBeenCalledTimes(1);
      const [event, props] = captureMock.mock.calls[0];
      expect(event).toBe("report_submitted");
      expect(props).toMatchObject({
        report_id: "rep_replayed_1",
        issue_type: "ROAD_DAMAGE",
        has_image: true,
        has_location: true,
        offline: true,
      });
      // Measured first-capture -> replay; ~5s here, allow scheduling slack.
      expect(props?.time_to_submit_ms).toBeGreaterThanOrEqual(5_000);
      expect(props?.time_to_submit_ms).toBeLessThan(10_000);
    });

    it("falls back to queuedAt for timing when no captureStartedAt was persisted", async () => {
      queueReport(PAYLOAD); // no capture timestamp (legacy / unstarted clock)
      vi.spyOn(globalThis, "fetch").mockResolvedValue(createdReportResponse());

      await flushQueue();

      expect(captureMock).toHaveBeenCalledTimes(1);
      const props = captureMock.mock.calls[0][1];
      // queuedAt is "now", so the interval is small but present and non-negative.
      expect(props?.offline).toBe(true);
      expect(props?.time_to_submit_ms).toBeGreaterThanOrEqual(0);
      expect(props?.time_to_submit_ms).toBeLessThan(5_000);
    });

    it("does NOT emit and keeps the item when the replay POST fails (non-ok)", async () => {
      queueReport(PAYLOAD, 1000);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: false }), { status: 500 }),
      );

      const flushed = await flushQueue();

      expect(flushed).toBe(0);
      expect(captureMock).not.toHaveBeenCalled();
      expect(getQueuedCount()).toBe(1);
    });

    it("does NOT emit and keeps the item when the replay fetch throws", async () => {
      queueReport(PAYLOAD, 1000);
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

      const flushed = await flushQueue();

      expect(flushed).toBe(0);
      expect(captureMock).not.toHaveBeenCalled();
      expect(getQueuedCount()).toBe(1);
    });

    it("still emits (without report_id) when the create succeeds but the body is unparseable", async () => {
      queueReport(PAYLOAD, Date.now() - 3_000);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not json", { status: 200 }),
      );

      const flushed = await flushQueue();

      expect(flushed).toBe(1);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const props = captureMock.mock.calls[0][1];
      expect(props).toMatchObject({ offline: true, issue_type: "ROAD_DAMAGE" });
      expect("report_id" in (props ?? {})).toBe(false);
    });

    it("does not emit when PostHog is not loaded (instrumentation no-op)", async () => {
      queueReport(PAYLOAD, 1000);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(createdReportResponse());
      const loaded = posthog.__loaded;
      posthog.__loaded = false;

      const flushed = await flushQueue();

      expect(flushed).toBe(1);
      expect(captureMock).not.toHaveBeenCalled();

      posthog.__loaded = loaded;
    });
  });
});
