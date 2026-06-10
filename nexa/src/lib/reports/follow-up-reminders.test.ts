import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { FOLLOW_UP_REMINDER_STALE_DAYS } from "./follow-up";
import {
  findStaleUnresolvedReportsForFollowUp,
  type StaleReportReminderCandidate,
} from "./follow-up-reminders";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_MS = FOLLOW_UP_REMINDER_STALE_DAYS * MS_PER_DAY;

// Fixed "now" so the cutoff and per-report ages are fully deterministic.
const NOW = new Date("2026-06-09T12:00:00.000Z");

let seq = 0;

// The module selects a narrow projection, so the resolved rows are
// `StaleReportReminderCandidate[]`, not full `Report[]`. The deep mock's
// signature is the full row type; cast at the boundary to drive it with the
// real (narrower) query shape.
function mockReturns(rows: StaleReportReminderCandidate[]): void {
  prismaMock.report.findMany.mockResolvedValue(
    rows as unknown as Awaited<ReturnType<typeof prismaMock.report.findMany>>,
  );
}

// A query-result row shaped like the `select` in the module. Defaults are an
// unresolved report whose updatedAt sits exactly on the stale cutoff.
function makeCandidate(
  overrides: Partial<StaleReportReminderCandidate> = {},
): StaleReportReminderCandidate {
  seq += 1;
  const updatedAt = new Date(NOW.getTime() - STALE_MS);
  return {
    id: `report_${seq}`,
    issueType: "ROAD_DAMAGE",
    status: "CONFIRMED",
    description: "Pothole",
    aiDescription: null,
    address: "100 Main St",
    externalTrackingId: null,
    createdAt: updatedAt,
    updatedAt,
    user: { email: "reporter@example.com", name: "Reporter" },
    ...overrides,
  };
}

describe("findStaleUnresolvedReportsForFollowUp", () => {
  describe("Prisma query construction", () => {
    it("excludes resolved/closed, requires a user with an email, and gates on the cutoff", async () => {
      prismaMock.report.findMany.mockResolvedValue([]);

      await findStaleUnresolvedReportsForFollowUp({ now: NOW });

      const args = prismaMock.report.findMany.mock.calls[0][0];
      expect(args?.where).toMatchObject({
        status: { notIn: ["RESOLVED", "CLOSED"] },
        userId: { not: null },
        user: { is: { email: { not: "" } } },
      });
      expect(args?.orderBy).toEqual({ updatedAt: "asc" });
    });

    it("computes the cutoff as now minus the default stale window", async () => {
      prismaMock.report.findMany.mockResolvedValue([]);

      await findStaleUnresolvedReportsForFollowUp({ now: NOW });

      const where = prismaMock.report.findMany.mock.calls[0][0]?.where as {
        updatedAt: { lte: Date };
      };
      expect(where.updatedAt.lte.getTime()).toBe(NOW.getTime() - STALE_MS);
    });

    it("honors a custom staleDays window in the cutoff", async () => {
      prismaMock.report.findMany.mockResolvedValue([]);

      await findStaleUnresolvedReportsForFollowUp({ now: NOW, staleDays: 30 });

      const where = prismaMock.report.findMany.mock.calls[0][0]?.where as {
        updatedAt: { lte: Date };
      };
      expect(where.updatedAt.lte.getTime()).toBe(
        NOW.getTime() - 30 * MS_PER_DAY,
      );
    });

    it("falls back to the current clock when `now` is omitted", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      try {
        prismaMock.report.findMany.mockResolvedValue([]);
        await findStaleUnresolvedReportsForFollowUp();
        const where = prismaMock.report.findMany.mock.calls[0][0]?.where as {
          updatedAt: { lte: Date };
        };
        expect(where.updatedAt.lte.getTime()).toBe(NOW.getTime() - STALE_MS);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("post-query eligibility filter", () => {
    it("keeps a report whose updatedAt is exactly on the cutoff (>= stale is inclusive)", async () => {
      const onEdge = makeCandidate({
        id: "report_on_edge",
        updatedAt: new Date(NOW.getTime() - STALE_MS),
      });
      mockReturns([onEdge]);

      const result = await findStaleUnresolvedReportsForFollowUp({ now: NOW });
      expect(result.map((r) => r.id)).toEqual(["report_on_edge"]);
    });

    it("drops a borderline row the DB returned but that is not yet stale", async () => {
      // 1ms short of the full stale window → ageDays floors below the threshold,
      // so the in-memory eligibility check must reject it even though the (less
      // precise, day-granular) DB cutoff let it through.
      const notQuiteStale = makeCandidate({
        id: "report_borderline",
        updatedAt: new Date(NOW.getTime() - STALE_MS + 1),
      });
      mockReturns([notQuiteStale]);

      const result = await findStaleUnresolvedReportsForFollowUp({ now: NOW });
      expect(result).toEqual([]);
    });

    it("returns all rows when every candidate is genuinely stale", async () => {
      const a = makeCandidate({
        id: "a",
        updatedAt: new Date(NOW.getTime() - STALE_MS - MS_PER_DAY),
      });
      const b = makeCandidate({
        id: "b",
        updatedAt: new Date(NOW.getTime() - STALE_MS - 10 * MS_PER_DAY),
      });
      mockReturns([a, b]);

      const result = await findStaleUnresolvedReportsForFollowUp({ now: NOW });
      expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("returns an empty array when the query yields nothing", async () => {
      prismaMock.report.findMany.mockResolvedValue([]);
      const result = await findStaleUnresolvedReportsForFollowUp({ now: NOW });
      expect(result).toEqual([]);
    });
  });
});
