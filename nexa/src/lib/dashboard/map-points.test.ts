import { describe, expect, it } from "vitest";

import { buildReportMapPoints, type MappableReportInput } from "./map-points";

// Reports as the dashboard queries them: newest-first.
function report(
  id: string,
  overrides: Partial<MappableReportInput> = {},
): MappableReportInput {
  return {
    id,
    issueType: "ROAD_DAMAGE",
    status: "CONFIRMED",
    address: "1 Main St, Palo Alto, CA",
    latitude: 37.44,
    longitude: -122.16,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildReportMapPoints", () => {
  it("numbers pins by filing order (#1 = earliest)", () => {
    // newest-first input: d (newest) .. a (oldest)
    const points = buildReportMapPoints([
      report("d"),
      report("c"),
      report("b"),
      report("a"),
    ]);
    const orderById = Object.fromEntries(points.map((p) => [p.id, p.order]));
    expect(orderById).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it("re-sequences contiguously after a report is deleted (1·2·3·4, delete 2 -> 1·2·3)", () => {
    // Start with a,b,c,d (orders 1,2,3,4). Delete "b" (the #2) and rebuild from
    // the remaining reports — the pins must become 1·2·3, never 1·3·4.
    const remaining = [report("d"), report("c"), report("a")]; // newest-first, no "b"
    const points = buildReportMapPoints(remaining);
    const orderById = Object.fromEntries(points.map((p) => [p.id, p.order]));
    expect(orderById).toEqual({ a: 1, c: 2, d: 3 });
    // No gaps: the orders are exactly 1..N.
    expect(points.map((p) => p.order).sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });

  it("drops reports without valid coordinates before numbering", () => {
    const points = buildReportMapPoints([
      report("withGeo"),
      report("noGeo", { latitude: null, longitude: null }),
      report("oldest"),
    ]);
    expect(points.map((p) => p.id)).toEqual(["withGeo", "oldest"]);
    // Only the two mappable reports are numbered, contiguously.
    expect(points.map((p) => p.order)).toEqual([2, 1]);
  });
});
