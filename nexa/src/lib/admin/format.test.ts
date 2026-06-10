import { describe, expect, it } from "vitest";

import { formatDurationSeconds, formatPercent } from "./format";

describe("formatPercent", () => {
  it("formats a fraction with one decimal", () => {
    expect(formatPercent(0.8423)).toBe("84.2%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("clamps non-finite input to 0.0%", () => {
    expect(formatPercent(NaN)).toBe("0.0%");
    expect(formatPercent(Infinity)).toBe("0.0%");
  });
});

describe("formatDurationSeconds", () => {
  it("renders an em dash for null/negative/non-finite", () => {
    expect(formatDurationSeconds(null)).toBe("—");
    expect(formatDurationSeconds(-5)).toBe("—");
    expect(formatDurationSeconds(NaN)).toBe("—");
  });

  it("uses seconds under a minute", () => {
    expect(formatDurationSeconds(0)).toBe("0s");
    expect(formatDurationSeconds(45)).toBe("45s");
  });

  it("uses minutes under an hour", () => {
    expect(formatDurationSeconds(90)).toBe("2m"); // rounds
    expect(formatDurationSeconds(600)).toBe("10m");
  });

  it("uses hours under a day", () => {
    expect(formatDurationSeconds(3600)).toBe("1.0h");
    expect(formatDurationSeconds(5400)).toBe("1.5h");
  });

  it("uses days beyond 24h", () => {
    expect(formatDurationSeconds(86400)).toBe("1.0d");
    expect(formatDurationSeconds(129600)).toBe("1.5d");
  });
});
