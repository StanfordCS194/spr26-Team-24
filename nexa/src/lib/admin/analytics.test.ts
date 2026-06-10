import { describe, expect, it, type Mock } from "vitest";

import { prismaMock } from "@/test/prisma-mock";
import { ReportStatus } from "@/generated/prisma/enums";

// `report.groupBy` is an overloaded generic on the Prisma client, so the deep
// mock proxy's static type doesn't surface `mockImplementation`. It IS a vi mock
// at runtime; we narrow to `Mock` to stub it by the `by` argument.
const groupByMock = prismaMock.report.groupBy as unknown as Mock;

import {
  computeAdminAnalytics,
  computeSubmissionRates,
  computeTimeToSubmit,
  percentile,
  rate,
} from "./analytics";

describe("rate", () => {
  it("divides numerator by denominator", () => {
    expect(rate(3, 4)).toBe(0.75);
  });

  it("returns 0 (not NaN) when the denominator is 0", () => {
    expect(rate(0, 0)).toBe(0);
    expect(rate(5, 0)).toBe(0);
  });
});

describe("percentile", () => {
  it("returns null for an empty array", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("returns the only value for a single-element array", () => {
    expect(percentile([42], 90)).toBe(42);
  });

  it("computes the median of an odd-length set", () => {
    expect(percentile([1, 2, 3], 50)).toBe(2);
  });

  it("interpolates between ranks for an even-length set", () => {
    // type-7 median of [1,2,3,4] = 2.5
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it("computes p90 with interpolation regardless of input order", () => {
    const values = [10, 1, 5, 2, 8, 3, 9, 4, 7, 6];
    // sorted 1..10, p90 rank = 0.9*9 = 8.1 -> 9 + 0.1*(10-9) = 9.1
    expect(percentile(values, 90)).toBeCloseTo(9.1, 5);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    percentile(input, 50);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("computeSubmissionRates", () => {
  it("counts SUBMITTED-or-later as submitted and CONFIRMED/SUBMITTING as stuck", () => {
    const counts = new Map<ReportStatus, number>([
      [ReportStatus.DRAFT, 5], // excluded from the denominator
      [ReportStatus.CONFIRMED, 2],
      [ReportStatus.SUBMITTING, 1],
      [ReportStatus.SUBMITTED, 4],
      [ReportStatus.ACKNOWLEDGED, 1],
      [ReportStatus.IN_PROGRESS, 1],
      [ReportStatus.RESOLVED, 1],
      [ReportStatus.CLOSED, 1],
    ]);
    const result = computeSubmissionRates(counts);
    expect(result.submitted).toBe(8); // 4+1+1+1+1
    expect(result.stuck).toBe(3); // 2+1
    expect(result.total).toBe(11);
    expect(result.successRate).toBeCloseTo(8 / 11, 5);
    expect(result.failureRate).toBeCloseTo(3 / 11, 5);
  });

  it("yields zero rates with no ready-to-file reports", () => {
    const result = computeSubmissionRates(new Map([[ReportStatus.DRAFT, 3]]));
    expect(result.total).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.failureRate).toBe(0);
  });
});

describe("computeTimeToSubmit", () => {
  const base = new Date("2026-01-01T00:00:00.000Z");
  const plus = (seconds: number) => new Date(base.getTime() + seconds * 1000);

  it("returns nulls and zero count for no rows", () => {
    expect(computeTimeToSubmit([])).toEqual({
      count: 0,
      medianSeconds: null,
      p90Seconds: null,
    });
  });

  it("computes rounded median and p90 seconds from createdAt..updatedAt", () => {
    const rows = [10, 20, 30, 40].map((s) => ({
      createdAt: base,
      updatedAt: plus(s),
    }));
    const result = computeTimeToSubmit(rows);
    expect(result.count).toBe(4);
    expect(result.medianSeconds).toBe(25); // median of 10,20,30,40
    expect(result.p90Seconds).toBe(37); // 0.9*3=2.7 -> 30+0.7*10=37
  });

  it("drops negative durations (updatedAt before createdAt)", () => {
    const rows = [
      { createdAt: plus(100), updatedAt: base }, // negative -> dropped
      { createdAt: base, updatedAt: plus(50) },
    ];
    const result = computeTimeToSubmit(rows);
    expect(result.count).toBe(1);
    expect(result.medianSeconds).toBe(50);
  });
});

describe("computeAdminAnalytics", () => {
  it("aggregates counts, breakdowns, timing, and ambiguity via Prisma", async () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const updated = new Date("2026-01-01T00:01:00.000Z"); // +60s

    prismaMock.report.count.mockImplementation((args?: { where?: unknown }) => {
      // No-args call => total; { where: { agencyId: null } } => no-agency count.
      if (args?.where) return Promise.resolve(2) as never;
      return Promise.resolve(10) as never;
    });

    groupByMock.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes("status")) {
        return Promise.resolve([
          { status: ReportStatus.SUBMITTED, _count: { _all: 6 } },
          { status: ReportStatus.CONFIRMED, _count: { _all: 4 } },
        ]) as never;
      }
      if (args.by.includes("issueType")) {
        return Promise.resolve([
          { issueType: "ROAD_DAMAGE", _count: { _all: 7 } },
          { issueType: null, _count: { _all: 3 } },
        ]) as never;
      }
      // agencyId
      return Promise.resolve([
        { agencyId: "agency-1", _count: { _all: 8 } },
        { agencyId: null, _count: { _all: 2 } },
      ]) as never;
    });

    prismaMock.report.findMany.mockResolvedValue([
      { createdAt: created, updatedAt: updated },
    ] as never);

    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-1", name: "Public Works" },
    ] as never);

    const result = await computeAdminAnalytics();

    expect(result.totalReports).toBe(10);

    // submission rates: submitted 6 / stuck 4 (CONFIRMED) => total 10
    expect(result.submission.submitted).toBe(6);
    expect(result.submission.stuck).toBe(4);
    expect(result.submission.successRate).toBeCloseTo(0.6, 5);

    // status distribution sorted by count desc
    expect(result.statusDistribution[0]).toEqual({
      status: ReportStatus.SUBMITTED,
      count: 6,
    });

    // issue-type breakdown maps a null issueType to "UNCATEGORIZED"
    expect(result.byIssueType).toContainEqual({
      issueType: "UNCATEGORIZED",
      count: 3,
    });

    // agency breakdown resolves the name and labels the null bucket UNROUTED
    expect(result.byAgency).toContainEqual({
      agencyId: "agency-1",
      name: "Public Works",
      count: 8,
    });
    expect(result.byAgency).toContainEqual({
      agencyId: null,
      name: "UNROUTED",
      count: 2,
    });

    // time-to-submit: single 60s sample
    expect(result.timeToSubmit.count).toBe(1);
    expect(result.timeToSubmit.medianSeconds).toBe(60);
    expect(result.timeToSubmit.p90Seconds).toBe(60);

    // ambiguity: 2 of 10 had no agency
    expect(result.ambiguity.noAgency).toBe(2);
    expect(result.ambiguity.noAgencyRate).toBeCloseTo(0.2, 5);
  });

  it("falls back to UNKNOWN when an agency id has no matching name row", async () => {
    prismaMock.report.count.mockResolvedValue(1 as never);
    groupByMock.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes("agencyId")) {
        return Promise.resolve([
          { agencyId: "missing", _count: { _all: 1 } },
        ]) as never;
      }
      return Promise.resolve([]) as never;
    });
    prismaMock.report.findMany.mockResolvedValue([] as never);
    prismaMock.agency.findMany.mockResolvedValue([] as never);

    const result = await computeAdminAnalytics();
    expect(result.byAgency).toContainEqual({
      agencyId: "missing",
      name: "UNKNOWN",
      count: 1,
    });
  });
});
