"use client";

import { useState, useCallback } from "react";
import {
  getReports,
  getReport,
  saveReport,
  seedDemoReports,
  type StoredReport,
} from "@/lib/reports-store";

export function useReports() {
  const [reports, setReports] = useState<StoredReport[]>(() => {
    if (typeof window === "undefined") return [];
    return getReports();
  });

  const refresh = useCallback(() => {
    setReports(getReports());
  }, []);

  const addReport = useCallback(
    (report: Parameters<typeof saveReport>[0]) => {
      const created = saveReport(report);
      refresh();
      return created;
    },
    [refresh],
  );

  const seed = useCallback(() => {
    seedDemoReports();
    refresh();
  }, [refresh]);

  return { reports, addReport, seed, refresh, getReport };
}
