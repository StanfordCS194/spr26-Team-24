// @vitest-environment jsdom
//
// reports-store is a *client* module: every function reads/writes
// `window.localStorage`. The lib/** glob places this file in the node project,
// so we pin the environment to jsdom (real `window` + the in-memory
// localStorage polyfill from vitest.setup.tsx) to exercise the real CRUD logic.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearReports,
  getReport,
  getReports,
  saveReport,
  seedDemoReports,
  type StoredReport,
} from "./reports-store";

const STORAGE_KEY = "nexa-reports";

// The persisted shape minus the fields saveReport() generates.
type ReportInput = Omit<
  StoredReport,
  "id" | "status" | "createdAt" | "updatedAt"
>;

/** A deterministic, fully-populated saveReport() input. */
function makeReportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    issueType: "ROAD_DAMAGE",
    description: "Pothole on University Ave.",
    aiDescription: "A deep pothole posing a hazard to cyclists.",
    severity: "high",
    address: "University Ave, Palo Alto, CA",
    latitude: 37.4419,
    longitude: -122.143,
    imagePreview: null,
    agency: "Palo Alto Public Works",
    ...overrides,
  };
}

/** A fully-populated StoredReport for seeding localStorage directly. */
function makeStoredReport(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    id: "RPT-FIXED01",
    issueType: "ROAD_DAMAGE",
    description: "Pothole on University Ave.",
    aiDescription: "A deep pothole posing a hazard to cyclists.",
    severity: "high",
    address: "University Ave, Palo Alto, CA",
    latitude: 37.4419,
    longitude: -122.143,
    imagePreview: null,
    status: "SUBMITTED",
    agency: "Palo Alto Public Works",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("getReports", () => {
  it("returns [] when the store is empty", () => {
    // Arrange: nothing written.

    // Act
    const result = getReports();

    // Assert
    expect(result).toEqual([]);
  });

  it("returns [] for malformed JSON without throwing", () => {
    // Arrange
    localStorage.setItem(STORAGE_KEY, "{ not valid json");

    // Act / Assert
    expect(() => getReports()).not.toThrow();
    expect(getReports()).toEqual([]);
  });

  it("round-trips an array stored under STORAGE_KEY", () => {
    // Arrange
    const stored = [makeStoredReport({ id: "RPT-A" })];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    // Act
    const result = getReports();

    // Assert
    expect(result).toEqual(stored);
  });

  it("sorts reports newest-first by createdAt", () => {
    // Arrange: written oldest-first.
    const older = makeStoredReport({
      id: "RPT-OLD",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const newer = makeStoredReport({
      id: "RPT-NEW",
      createdAt: "2025-06-01T00:00:00.000Z",
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([older, newer]));

    // Act
    const result = getReports();

    // Assert
    expect(result.map((r) => r.id)).toEqual(["RPT-NEW", "RPT-OLD"]);
  });
});

describe("getReport", () => {
  it("returns the matching report (hit)", () => {
    // Arrange
    const target = makeStoredReport({ id: "RPT-HIT" });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([makeStoredReport({ id: "RPT-OTHER" }), target]),
    );

    // Act
    const result = getReport("RPT-HIT");

    // Assert
    expect(result).toEqual(target);
  });

  it("returns undefined when no report matches (miss)", () => {
    // Arrange
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([makeStoredReport({ id: "RPT-A" })]),
    );

    // Act
    const result = getReport("RPT-MISSING");

    // Assert
    expect(result).toBeUndefined();
  });

  it("returns undefined when the store is empty", () => {
    // Act / Assert
    expect(getReport("anything")).toBeUndefined();
  });
});

describe("saveReport", () => {
  it("generates id, status, createdAt and updatedAt", () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-15T12:00:00.000Z"));

    // Act
    const saved = saveReport(makeReportInput());

    // Assert
    expect(saved.id).toMatch(/^RPT-/);
    expect(saved.status).toBe("SUBMITTED");
    expect(saved.createdAt).toBe("2025-03-15T12:00:00.000Z");
    expect(saved.updatedAt).toBe(saved.createdAt);
  });

  it("preserves the caller-supplied fields on the returned report", () => {
    // Arrange
    const input = makeReportInput({
      issueType: "STREETLIGHT_OUTAGE",
      severity: "low",
      latitude: null,
      longitude: null,
      agency: null,
    });

    // Act
    const saved = saveReport(input);

    // Assert
    expect(saved).toMatchObject(input);
  });

  it("persists the new report to localStorage under STORAGE_KEY", () => {
    // Act
    const saved = saveReport(makeReportInput());

    // Assert
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([saved]);
  });

  it("appends to existing reports rather than overwriting", () => {
    // Arrange
    const first = saveReport(makeReportInput({ description: "first" }));

    // Act
    const second = saveReport(makeReportInput({ description: "second" }));

    // Assert: both persisted, append order preserved in raw storage.
    const persisted: StoredReport[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) as string,
    );
    expect(persisted.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("round-trips through getReport after saving", () => {
    // Act
    const saved = saveReport(makeReportInput());

    // Assert
    expect(getReport(saved.id)).toEqual(saved);
  });
});

describe("clearReports", () => {
  it("removes the storage key", () => {
    // Arrange
    saveReport(makeReportInput());
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Act
    clearReports();

    // Assert
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getReports()).toEqual([]);
  });
});

describe("seedDemoReports", () => {
  it("writes the deterministic demo dataset when the store is empty", () => {
    // Act
    const seeded = seedDemoReports();

    // Assert
    expect(seeded).toHaveLength(6);
    const persisted: StoredReport[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) as string,
    );
    expect(persisted).toEqual(seeded);
    expect(seeded.map((r) => r.id)).toEqual([
      "RPT-DEMO01",
      "RPT-DEMO02",
      "RPT-DEMO03",
      "RPT-DEMO04",
      "RPT-DEMO05",
      "RPT-DEMO06",
    ]);
  });

  it("produces demo reports matching the StoredReport shape", () => {
    // Act
    const [demo] = seedDemoReports();

    // Assert: every StoredReport key present with the right primitive type.
    expect(typeof demo.id).toBe("string");
    expect(typeof demo.issueType).toBe("string");
    expect(typeof demo.description).toBe("string");
    expect(typeof demo.aiDescription).toBe("string");
    expect(["low", "medium", "high"]).toContain(demo.severity);
    expect(typeof demo.address).toBe("string");
    expect(["SUBMITTED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"]).toContain(
      demo.status,
    );
    expect(["number", "object"]).toContain(typeof demo.latitude); // number | null
    expect(["number", "object"]).toContain(typeof demo.longitude);
    expect(typeof demo.createdAt).toBe("string");
    expect(typeof demo.updatedAt).toBe("string");
    // ISO timestamps are parseable.
    expect(Number.isNaN(Date.parse(demo.createdAt))).toBe(false);
  });

  it("is idempotent: a second call does not overwrite existing data", () => {
    // Arrange
    const first = seedDemoReports();

    // Act
    const second = seedDemoReports();

    // Assert: returns the already-stored array, leaves storage unchanged.
    expect(second).toEqual(first);
    const persisted: StoredReport[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) as string,
    );
    expect(persisted).toHaveLength(6);
  });

  it("does not seed when the store already holds a saved report", () => {
    // Arrange
    const saved = saveReport(makeReportInput());

    // Act
    const result = seedDemoReports();

    // Assert: existing (non-demo) data is returned untouched.
    expect(result).toEqual([saved]);
    expect(result.map((r) => r.id)).not.toContain("RPT-DEMO01");
  });
});
