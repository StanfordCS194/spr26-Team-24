import { describe, expect, it } from "vitest";

import { ReportStatus } from "@/generated/prisma/enums";
import {
  STATUS_RANK,
  USER_RESOLVABLE_FROM,
  TERMINAL_STATUSES,
  canTransition,
  isForwardTransition,
  assertTransition,
  InvalidStatusTransitionError,
} from "./status-machine";

// The forward "happy path" every report follows. Each adjacent pair must be a
// legal transition; this is the contract the mutation sites depend on.
const HAPPY_PATH: ReportStatus[] = [
  ReportStatus.DRAFT,
  ReportStatus.CLASSIFYING,
  ReportStatus.CONFIRMED,
  ReportStatus.SUBMITTING,
  ReportStatus.SUBMITTED,
  ReportStatus.ACKNOWLEDGED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.RESOLVED,
  ReportStatus.CLOSED,
];

describe("STATUS_RANK", () => {
  it("ranks the lifecycle strictly monotonically", () => {
    for (let i = 1; i < HAPPY_PATH.length; i++) {
      expect(STATUS_RANK[HAPPY_PATH[i]]).toBeGreaterThan(
        STATUS_RANK[HAPPY_PATH[i - 1]],
      );
    }
  });

  it("assigns a distinct rank to every status", () => {
    const ranks = Object.values(STATUS_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("canTransition", () => {
  it("allows every adjacent step of the happy path", () => {
    for (let i = 1; i < HAPPY_PATH.length; i++) {
      expect(canTransition(HAPPY_PATH[i - 1], HAPPY_PATH[i])).toBe(true);
    }
  });

  it("treats staying in the same status as a no-op (always allowed)", () => {
    for (const status of HAPPY_PATH) {
      expect(canTransition(status, status)).toBe(true);
    }
  });

  it("rejects skipping submission: pre-submission states cannot jump to RESOLVED", () => {
    for (const from of [
      ReportStatus.DRAFT,
      ReportStatus.CLASSIFYING,
      ReportStatus.CONFIRMED,
      ReportStatus.SUBMITTING,
    ]) {
      expect(canTransition(from, ReportStatus.RESOLVED)).toBe(false);
    }
  });

  it("allows RESOLVED from each user-resolvable post-submission state", () => {
    for (const from of [
      ReportStatus.SUBMITTED,
      ReportStatus.ACKNOWLEDGED,
      ReportStatus.IN_PROGRESS,
    ]) {
      expect(canTransition(from, ReportStatus.RESOLVED)).toBe(true);
    }
  });

  it("treats CLOSED as terminal", () => {
    for (const to of HAPPY_PATH) {
      if (to === ReportStatus.CLOSED) continue;
      expect(canTransition(ReportStatus.CLOSED, to)).toBe(false);
    }
  });

  it("allows the orchestrator rollback SUBMITTING -> CONFIRMED", () => {
    expect(canTransition(ReportStatus.SUBMITTING, ReportStatus.CONFIRMED)).toBe(
      true,
    );
  });

  it("allows the agency to reopen RESOLVED -> IN_PROGRESS", () => {
    expect(canTransition(ReportStatus.RESOLVED, ReportStatus.IN_PROGRESS)).toBe(
      true,
    );
  });

  it("rejects regressing a confirmed report back to draft", () => {
    expect(canTransition(ReportStatus.CONFIRMED, ReportStatus.DRAFT)).toBe(
      false,
    );
  });
});

describe("isForwardTransition", () => {
  it("is true only when the target ranks strictly higher", () => {
    expect(
      isForwardTransition(ReportStatus.SUBMITTED, ReportStatus.IN_PROGRESS),
    ).toBe(true);
    expect(
      isForwardTransition(ReportStatus.IN_PROGRESS, ReportStatus.SUBMITTED),
    ).toBe(false);
    expect(
      isForwardTransition(ReportStatus.SUBMITTED, ReportStatus.SUBMITTED),
    ).toBe(false);
  });
});

describe("assertTransition", () => {
  it("does not throw on a legal transition", () => {
    expect(() =>
      assertTransition(ReportStatus.CONFIRMED, ReportStatus.SUBMITTING),
    ).not.toThrow();
  });

  it("throws InvalidStatusTransitionError on an illegal transition", () => {
    expect(() =>
      assertTransition(ReportStatus.DRAFT, ReportStatus.RESOLVED),
    ).toThrow(InvalidStatusTransitionError);
  });
});

describe("constants", () => {
  it("USER_RESOLVABLE_FROM contains exactly the post-submission, non-closed states", () => {
    expect(new Set(USER_RESOLVABLE_FROM)).toEqual(
      new Set([
        ReportStatus.SUBMITTED,
        ReportStatus.ACKNOWLEDGED,
        ReportStatus.IN_PROGRESS,
        ReportStatus.RESOLVED,
      ]),
    );
  });

  it("TERMINAL_STATUSES are RESOLVED and CLOSED", () => {
    expect(new Set(TERMINAL_STATUSES)).toEqual(
      new Set([ReportStatus.RESOLVED, ReportStatus.CLOSED]),
    );
  });
});
