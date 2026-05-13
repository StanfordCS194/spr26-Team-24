"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getReports,
  getReport,
  saveReport,
  seedDemoReports,
  type StoredReport,
} from "@/lib/reports-store";

export function useReports() {
  const [reports, setReports] = useState<StoredReport[]>([]);

  const refresh = useCallback(() => {
    setReports(getReports());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
