import { describe, expect, it } from "vitest";

import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

import { findDuplicateReport } from "./dedup";

// Default radius is 50m and the default look-back window is 24h (env unset in
// the test runner). A point ~12m east of the Stanford default coordinates.
const LAT = 37.4419;
const LON = -122.143;
const NEAR_LON = -122.1428; // ~17m east at this latitude — inside 50m.
const FAR_LON = -122.142; // ~88m east — outside 50m.

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
