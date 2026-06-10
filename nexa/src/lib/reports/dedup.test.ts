import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

import { findDuplicateReport } from "./dedup";

// Default radius is 50m and the default look-back window is 24h (env unset in
// the test runner). A point ~12m east of the Stanford default coordinates.
const LAT = 37.4419;
const LON = -122.143;
const NEAR_LON = -122.1428; // ~17m east at this latitude — inside 50m.
const FAR_LON = -122.142; // ~88m east — outside 50m.

// Defaults from src/lib/config.ts (env unset in the test runner).
const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
const RADIUS_METERS = 50;

describe("findDuplicateReport", () => {
  it("returns null when the report has no issue type", async () => {
    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: null,
      latitude: LAT,
      longitude: LON,
    });
    expect(match).toBeNull();
    expect(prismaMock.report.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the report has no location", async () => {
    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: null,
      longitude: null,
    });
    expect(match).toBeNull();
    expect(prismaMock.report.findMany).not.toHaveBeenCalled();
  });

  it("flags an existing same-user, same-type report within the radius", async () => {
    const existing = makeReport({
      id: "report_existing",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
    });
    prismaMock.report.findMany.mockResolvedValue([existing]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match).not.toBeNull();
    expect(match?.reportId).toBe("report_existing");
    expect(match?.distanceMeters).toBeLessThanOrEqual(50);
  });

  it("scopes the query to the reporter when signed in", async () => {
    prismaMock.report.findMany.mockResolvedValue([]);

    await findDuplicateReport({
      userId: "user_42",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    const where = prismaMock.report.findMany.mock.calls[0][0]?.where;
    expect(where).toMatchObject({
      userId: "user_42",
      issueType: "ROAD_DAMAGE",
    });
  });

  it("omits the user filter for anonymous reports", async () => {
    prismaMock.report.findMany.mockResolvedValue([]);

    await findDuplicateReport({
      userId: null,
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    const where = prismaMock.report.findMany.mock.calls[0][0]?.where;
    expect(where).not.toHaveProperty("userId");
  });

  it("ignores candidates outside the radius (distinct nearby reports)", async () => {
    const far = makeReport({
      id: "report_far",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: FAR_LON,
    });
    // The bounding box is generous enough that a just-outside report can be
    // returned by the prefilter; the haversine refinement must still reject it.
    prismaMock.report.findMany.mockResolvedValue([far]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match).toBeNull();
  });

  it("returns the closest candidate when several match", async () => {
    const nearer = makeReport({
      id: "report_nearer",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });
    const farther = makeReport({
      id: "report_farther",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
    });
    prismaMock.report.findMany.mockResolvedValue([farther, nearer]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match?.reportId).toBe("report_nearer");
  });
});

// ---------------------------------------------------------------------------
// Deterministic time-window (stale-window cutoff) and radius-boundary tests
// (#207). Time is frozen with vitest fake timers so the `since` cutoff derived
// from `Date.now()` inside findDuplicateReport is fully deterministic — no real
// clock, no sleeps.
//
// findDuplicateReport delegates the createdAt >= since filter to Prisma, which
// is deep-mocked here. To genuinely exercise the boundary we drive the mock as
// the real database would: it returns only candidates whose createdAt satisfies
// the `where.createdAt.gte` the function actually computed. A report stamped
// just INSIDE the window survives the filter (→ duplicate); one stamped just
// OUTSIDE is filtered out (→ not a duplicate).
// ---------------------------------------------------------------------------
describe("findDuplicateReport — stale-window boundary (#207)", () => {
  // A fixed, arbitrary "now" well clear of the epoch so subtraction can't
  // accidentally land on 0 and mask a sign error.
  const NOW = new Date("2026-06-09T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Drive the Prisma mock the way the real DB would: only return candidates
   * whose createdAt is >= the `since` cutoff the function passed in `where`.
   * Returns the call args so tests can also assert the cutoff directly.
   */
  function mockFilteredByWindow(
    allCandidates: ReturnType<typeof makeReport>[],
  ) {
    prismaMock.report.findMany.mockImplementation((async (args: {
      where?: { createdAt?: { gte?: Date } };
    }) => {
      const since = args.where?.createdAt?.gte;
      if (!since) return allCandidates;
      return allCandidates.filter(
        (c) => c.createdAt.getTime() >= since.getTime(),
      );
    }) as typeof prismaMock.report.findMany);
  }

  it("computes the look-back cutoff as now minus the 24h window", async () => {
    prismaMock.report.findMany.mockResolvedValue([]);

    await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    const where = prismaMock.report.findMany.mock.calls[0][0]?.where as {
      createdAt: { gte: Date };
    };
    expect(where.createdAt.gte.getTime()).toBe(NOW - WINDOW_MS);
  });

  it("flags a report created just INSIDE the stale window as a duplicate", async () => {
    // 1ms newer than the cutoff → must survive the createdAt filter.
    const justInside = makeReport({
      id: "report_just_inside",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
      createdAt: new Date(NOW - WINDOW_MS + 1),
    });
    mockFilteredByWindow([justInside]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match?.reportId).toBe("report_just_inside");
  });

  it("treats a report exactly ON the cutoff as in-window (gte is inclusive)", async () => {
    const exactlyOnEdge = makeReport({
      id: "report_on_edge",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
      createdAt: new Date(NOW - WINDOW_MS),
    });
    mockFilteredByWindow([exactlyOnEdge]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match?.reportId).toBe("report_on_edge");
  });

  it("does NOT flag a report created just OUTSIDE the stale window", async () => {
    // 1ms older than the cutoff → the DB filter excludes it, so no duplicate.
    const justOutside = makeReport({
      id: "report_just_outside",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
      createdAt: new Date(NOW - WINDOW_MS - 1),
    });
    mockFilteredByWindow([justOutside]);

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match).toBeNull();
  });

  it("advancing past the window edge turns a once-duplicate into a non-duplicate", async () => {
    // A report stamped exactly at the original NOW.
    const report = makeReport({
      id: "report_aging",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: NEAR_LON,
      createdAt: new Date(NOW),
    });
    mockFilteredByWindow([report]);

    // At NOW it is in-window → duplicate.
    expect(
      (
        await findDuplicateReport({
          userId: "user_1",
          issueType: "ROAD_DAMAGE",
          latitude: LAT,
          longitude: LON,
        })
      )?.reportId,
    ).toBe("report_aging");

    // Advance just past the window: the same report is now stale.
    vi.setSystemTime(NOW + WINDOW_MS + 1);
    expect(
      await findDuplicateReport({
        userId: "user_1",
        issueType: "ROAD_DAMAGE",
        latitude: LAT,
        longitude: LON,
      }),
    ).toBeNull();
  });
});

describe("findDuplicateReport — radius boundary (#207)", () => {
  // The haversine refinement is the load-bearing boundary; time is irrelevant
  // here, but we freeze it anyway for total determinism.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));
    prismaMock.report.findMany.mockImplementation(
      (async () => candidates) as typeof prismaMock.report.findMany,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Mutable holder the mock above reads from, set per-test.
  let candidates: ReturnType<typeof makeReport>[] = [];

  // Longitude offset (degrees) for a target distance in metres, due east, at
  // LAT — mirrors the METERS_PER_DEGREE_LAT model the prefilter uses so the
  // crafted points sit predictably either side of the 50m radius.
  function lonOffsetForMeters(meters: number): number {
    const metersPerDegLon = 111_320 * Math.cos((LAT * Math.PI) / 180);
    return meters / metersPerDegLon;
  }

  it("flags a candidate just INSIDE the radius", async () => {
    candidates = [
      makeReport({
        id: "report_inside_radius",
        issueType: "ROAD_DAMAGE",
        latitude: LAT,
        longitude: LON + lonOffsetForMeters(RADIUS_METERS - 1),
      }),
    ];

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match?.reportId).toBe("report_inside_radius");
    expect(match?.distanceMeters).toBeLessThanOrEqual(RADIUS_METERS);
  });

  it("does NOT flag a candidate just OUTSIDE the radius", async () => {
    candidates = [
      makeReport({
        id: "report_outside_radius",
        issueType: "ROAD_DAMAGE",
        latitude: LAT,
        longitude: LON + lonOffsetForMeters(RADIUS_METERS + 2),
      }),
    ];

    const match = await findDuplicateReport({
      userId: "user_1",
      issueType: "ROAD_DAMAGE",
      latitude: LAT,
      longitude: LON,
    });

    expect(match).toBeNull();
  });
});
