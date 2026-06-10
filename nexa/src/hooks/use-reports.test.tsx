import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@/test";

import type { StoredReport } from "@/lib/reports-store";

// Mock the persistence layer so the hook is exercised in isolation: every
// reports-store export is a vi.fn we can drive and assert against.
vi.mock("@/lib/reports-store", () => ({
  getReports: vi.fn(),
  getReport: vi.fn(),
  saveReport: vi.fn(),
  seedDemoReports: vi.fn(),
}));

import {
  getReport,
  getReports,
  saveReport,
  seedDemoReports,
} from "@/lib/reports-store";
import { useReports } from "./use-reports";

const mockGetReports = vi.mocked(getReports);
const mockGetReport = vi.mocked(getReport);
const mockSaveReport = vi.mocked(saveReport);
const mockSeed = vi.mocked(seedDemoReports);

function makeStored(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    id: "RPT-1",
    issueType: "ROAD_DAMAGE",
    description: "desc",
    aiDescription: "ai desc",
    severity: "low",
    address: "123 Main St",
    latitude: 1,
    longitude: 2,
    imagePreview: null,
    status: "SUBMITTED",
    agency: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useReports", () => {
  beforeEach(() => {
    mockGetReports.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes reports from getReports() on mount", () => {
    // Arrange
    const initial = [makeStored({ id: "RPT-A" })];
    mockGetReports.mockReturnValue(initial);

    // Act
    const { result } = renderHook(() => useReports());

    // Assert
    expect(result.current.reports).toEqual(initial);
    expect(mockGetReports).toHaveBeenCalled();
  });

  it("refresh() re-reads the store into state", () => {
    // Arrange
    mockGetReports.mockReturnValue([]);
    const { result } = renderHook(() => useReports());
    const updated = [makeStored({ id: "RPT-B" })];
    mockGetReports.mockReturnValue(updated);

    // Act
    act(() => {
      result.current.refresh();
    });

    // Assert
    expect(result.current.reports).toEqual(updated);
  });

  it("addReport() saves via saveReport, refreshes, and returns the created report", () => {
    // Arrange
    const created = makeStored({ id: "RPT-NEW" });
    mockSaveReport.mockReturnValue(created);
    mockGetReports.mockReturnValue([]);
    const { result } = renderHook(() => useReports());
    mockGetReports.mockReturnValue([created]);

    const input = {
      issueType: "ROAD_DAMAGE",
      description: "desc",
      aiDescription: "ai",
      severity: "low" as const,
      address: "addr",
      latitude: 1,
      longitude: 2,
      imagePreview: null,
      agency: null,
    };

    // Act
    let returned: StoredReport | undefined;
    act(() => {
      returned = result.current.addReport(input);
    });

    // Assert
    expect(mockSaveReport).toHaveBeenCalledWith(input);
    expect(returned).toEqual(created);
    expect(result.current.reports).toEqual([created]);
  });

  it("seed() seeds demo data then refreshes the list", () => {
    // Arrange
    mockGetReports.mockReturnValue([]);
    const { result } = renderHook(() => useReports());
    const seeded = [makeStored({ id: "RPT-DEMO" })];
    mockGetReports.mockReturnValue(seeded);

    // Act
    act(() => {
      result.current.seed();
    });

    // Assert
    expect(mockSeed).toHaveBeenCalledTimes(1);
    expect(result.current.reports).toEqual(seeded);
  });

  it("exposes getReport passthrough from the store", () => {
    // Arrange
    const one = makeStored({ id: "RPT-X" });
    mockGetReport.mockReturnValue(one);
    const { result } = renderHook(() => useReports());

    // Act
    const found = result.current.getReport("RPT-X");

    // Assert
    expect(mockGetReport).toHaveBeenCalledWith("RPT-X");
    expect(found).toEqual(one);
  });
});
