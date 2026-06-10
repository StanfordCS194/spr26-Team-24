import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOLLOW_UP_REMINDER_STALE_DAYS,
  getReportFollowUpState,
  isReportEligibleForFollowUpReminder,
  type FollowUpReportLike,
} from "./follow-up";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A fixed "now" well clear of the epoch so day-arithmetic can't accidentally
// land on 0 and mask a sign error.
const NOW = new Date("2026-06-09T12:00:00.000Z");

// Helper: a report whose last activity is `days` (+ optional ms) before NOW.
function reportAgedDays(
  days: number,
  extraMs = 0,
  overrides: Partial<FollowUpReportLike> = {},
): FollowUpReportLike {
  const lastActivity = new Date(NOW.getTime() - days * MS_PER_DAY - extraMs);
  return {
    status: "CONFIRMED",
    createdAt: lastActivity,
    updatedAt: lastActivity,
    ...overrides,
  };
}

describe("getReportFollowUpState", () => {
  describe("activity timestamp selection", () => {
    it("prefers updatedAt over createdAt when present", () => {
      const createdAt = new Date(NOW.getTime() - 30 * MS_PER_DAY);
      const updatedAt = new Date(NOW.getTime() - 2 * MS_PER_DAY);
      const state = getReportFollowUpState(
        { status: "CONFIRMED", createdAt, updatedAt },
        NOW,
      );
      expect(state.lastActivityAt).toBe(updatedAt);
      expect(state.ageDays).toBe(2);
    });

    it("falls back to createdAt when updatedAt is null", () => {
      const createdAt = new Date(NOW.getTime() - 5 * MS_PER_DAY);
      const state = getReportFollowUpState(
        { status: "CONFIRMED", createdAt, updatedAt: null },
        NOW,
      );
      expect(state.lastActivityAt).toBe(createdAt);
      expect(state.ageDays).toBe(5);
    });

    it("falls back to createdAt when updatedAt is undefined", () => {
      const createdAt = new Date(NOW.getTime() - 5 * MS_PER_DAY);
      const state = getReportFollowUpState(
        { status: "CONFIRMED", createdAt },
        NOW,
      );
      expect(state.lastActivityAt).toBe(createdAt);
    });
  });

  describe("ageDays computation", () => {
    it("floors a partial day", () => {
      const state = getReportFollowUpState(
        reportAgedDays(3, MS_PER_DAY / 2),
        NOW,
      );
      expect(state.ageDays).toBe(3);
    });

    it("clamps a future last-activity timestamp to 0 (never negative)", () => {
      const future = new Date(NOW.getTime() + 10 * MS_PER_DAY);
      const state = getReportFollowUpState(
        { status: "CONFIRMED", createdAt: future, updatedAt: future },
        NOW,
      );
      expect(state.ageDays).toBe(0);
    });
  });

  describe("resolved/closed reports", () => {
    it.each(["RESOLVED", "CLOSED"])(
      "labels a %s report as Resolved and never stale",
      (status) => {
        const state = getReportFollowUpState(
          reportAgedDays(60, 0, { status }),
          NOW,
        );
        expect(state.isUnresolved).toBe(false);
        expect(state.isStale).toBe(false);
        expect(state.label).toBe("Resolved");
        expect(state.description).toContain("resolved or closed");
      },
    );
  });

  describe("unresolved reports + stale window", () => {
    it("labels a fresh unresolved report Awaiting response", () => {
      const state = getReportFollowUpState(reportAgedDays(1), NOW);
      expect(state.isUnresolved).toBe(true);
      expect(state.isStale).toBe(false);
      expect(state.label).toBe("Awaiting response");
      expect(state.description).toContain("app-side tracking only");
    });

    it("is NOT stale one day before the staleDays threshold", () => {
      const state = getReportFollowUpState(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS - 1),
        NOW,
      );
      expect(state.isStale).toBe(false);
      expect(state.label).toBe("Awaiting response");
    });

    it("becomes stale exactly AT the staleDays threshold (>= is inclusive)", () => {
      const state = getReportFollowUpState(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS),
        NOW,
      );
      expect(state.isStale).toBe(true);
      expect(state.label).toBe("Follow-up recommended");
      expect(state.description).toContain("app-side tracking only");
    });

    it("is stale well past the threshold", () => {
      const state = getReportFollowUpState(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS + 30),
        NOW,
      );
      expect(state.isStale).toBe(true);
      expect(state.label).toBe("Follow-up recommended");
    });
  });

  describe("custom staleDays override", () => {
    it("honors a tighter window", () => {
      const report = reportAgedDays(5);
      expect(getReportFollowUpState(report, NOW, 7).isStale).toBe(false);
      expect(getReportFollowUpState(report, NOW, 5).isStale).toBe(true);
    });
  });

  describe("default now (real clock) via fake timers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses the current time when `now` is omitted", () => {
      const state = getReportFollowUpState(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS),
      );
      expect(state.isStale).toBe(true);
    });

    it("advancing the clock past the window flips a report to stale", () => {
      const report = reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS - 1);
      expect(getReportFollowUpState(report).isStale).toBe(false);

      // Advance just over one more day so the report crosses the threshold.
      vi.setSystemTime(new Date(NOW.getTime() + MS_PER_DAY + 1));
      expect(getReportFollowUpState(report).isStale).toBe(true);
    });
  });
});

describe("isReportEligibleForFollowUpReminder", () => {
  it("is true exactly when the report is stale (delegates to getReportFollowUpState)", () => {
    expect(
      isReportEligibleForFollowUpReminder(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS),
        NOW,
      ),
    ).toBe(true);
    expect(
      isReportEligibleForFollowUpReminder(
        reportAgedDays(FOLLOW_UP_REMINDER_STALE_DAYS - 1),
        NOW,
      ),
    ).toBe(false);
  });

  it("is false for a resolved report no matter how old", () => {
    expect(
      isReportEligibleForFollowUpReminder(
        reportAgedDays(365, 0, { status: "RESOLVED" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("respects a custom staleDays threshold", () => {
    const report = reportAgedDays(10);
    expect(isReportEligibleForFollowUpReminder(report, NOW, 14)).toBe(false);
    expect(isReportEligibleForFollowUpReminder(report, NOW, 10)).toBe(true);
  });
});
