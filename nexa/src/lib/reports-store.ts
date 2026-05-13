const STORAGE_KEY = "nexa-reports";

export interface StoredReport {
  id: string;
  issueType: string;
  description: string;
  aiDescription: string;
  severity: "low" | "medium" | "high";
  address: string;
  latitude: number | null;
  longitude: number | null;
  imagePreview: string | null;
  status: "SUBMITTED" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED";
  agency: string | null;
  createdAt: string;
  updatedAt: string;
}

function readAll(): StoredReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(reports: StoredReport[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function getReports(): StoredReport[] {
  return readAll().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getReport(id: string): StoredReport | undefined {
  return readAll().find((r) => r.id === id);
}

export function saveReport(
  report: Omit<StoredReport, "id" | "status" | "createdAt" | "updatedAt">,
): StoredReport {
  const now = new Date().toISOString();
  const newReport: StoredReport = {
    ...report,
    id: `RPT-${Date.now().toString(36).toUpperCase()}`,
    status: "SUBMITTED",
    createdAt: now,
    updatedAt: now,
  };
  const all = readAll();
  all.push(newReport);
  writeAll(all);
  return newReport;
}

export function clearReports() {
  localStorage.removeItem(STORAGE_KEY);
}

export function seedDemoReports() {
  const existing = readAll();
  if (existing.length > 0) return existing;

  const now = Date.now();
  const DAY = 86_400_000;

  const demoReports: StoredReport[] = [
    {
      id: "RPT-DEMO01",
      issueType: "ROAD_DAMAGE",
      description:
        "Large pothole on University Ave near the Caltrain station, about 3 feet wide. Multiple cars swerving to avoid it.",
      aiDescription:
        "Severe pothole detected on a high-traffic arterial road. Estimated diameter ~3 feet. Flagged as priority repair for Palo Alto Public Works.",
      severity: "high",
      address: "195 University Ave, Palo Alto, CA 94301",
      latitude: 37.4436,
      longitude: -122.163,
      imagePreview: null,
      status: "RESOLVED",
      agency: "Palo Alto Public Works",
      createdAt: new Date(now - 142 * DAY).toISOString(),
      updatedAt: new Date(now - 138 * DAY).toISOString(),
    },
    {
      id: "RPT-DEMO02",
      issueType: "ILLEGAL_DUMPING",
      description:
        "Someone dumped a couch and several bags of trash near the creek behind the parking lot.",
      aiDescription:
        "Illegal dumping of household furniture and waste near a waterway. Flagged for environmental services cleanup and potential water quality impact.",
      severity: "high",
      address: "Adobe Creek, near 3800 Middlefield Rd, Palo Alto, CA",
      latitude: 37.419,
      longitude: -122.111,
      imagePreview: null,
      status: "RESOLVED",
      agency: "Santa Clara County Environmental Services",
      createdAt: new Date(now - 105 * DAY).toISOString(),
      updatedAt: new Date(now - 98 * DAY).toISOString(),
    },
    {
      id: "RPT-DEMO03",
      issueType: "STREETLIGHT_OUTAGE",
      description:
        "Three streetlights out in a row on Embarcadero Road. Very dark and unsafe at night for cyclists.",
      aiDescription:
        "Cluster streetlight outage reported along a bike-heavy corridor. Location flagged for priority electrical inspection by the city's lighting maintenance division.",
      severity: "medium",
      address: "Embarcadero Rd near Greer Park, Palo Alto, CA",
      latitude: 37.438,
      longitude: -122.127,
      imagePreview: null,
      status: "IN_PROGRESS",
      agency: "Palo Alto Utilities — Street Lighting",
      createdAt: new Date(now - 63 * DAY).toISOString(),
      updatedAt: new Date(now - 45 * DAY).toISOString(),
    },
    {
      id: "RPT-DEMO04",
      issueType: "VEHICLE_EMISSIONS",
      description:
        "Diesel bus idling for 20+ minutes at the transit center, thick black exhaust visible.",
      aiDescription:
        "Excessive diesel emissions from a transit vehicle at a public bus stop. Details forwarded to Bay Area Air Quality Management District for follow-up investigation.",
      severity: "low",
      address: "Palo Alto Transit Center, 95 University Ave",
      latitude: 37.4432,
      longitude: -122.1642,
      imagePreview: null,
      status: "ACKNOWLEDGED",
      agency: "Bay Area AQMD",
      createdAt: new Date(now - 30 * DAY).toISOString(),
      updatedAt: new Date(now - 27 * DAY).toISOString(),
    },
    {
      id: "RPT-DEMO05",
      issueType: "ROAD_DAMAGE",
      description:
        "Cracked pavement and raised tree roots making the sidewalk impassable for wheelchairs on Alma St.",
      aiDescription:
        "Sidewalk damage from tree root intrusion. ADA accessibility issue — flagged for priority repair by Public Works.",
      severity: "medium",
      address: "Alma St near Churchill Ave, Palo Alto, CA",
      latitude: 37.4299,
      longitude: -122.1588,
      imagePreview: null,
      status: "SUBMITTED",
      agency: "Palo Alto Public Works",
      createdAt: new Date(now - 7 * DAY).toISOString(),
      updatedAt: new Date(now - 7 * DAY).toISOString(),
    },
    {
      id: "RPT-DEMO06",
      issueType: "ILLEGAL_DUMPING",
      description:
        "Mattress and construction debris dumped on the trail entrance. Blocking the path.",
      aiDescription:
        "Illegal dumping of construction materials and a mattress at a public trail entrance. Flagged for cleanup by county environmental services.",
      severity: "high",
      address: "Stevens Creek Trail entrance, Mountain View",
      latitude: 37.394,
      longitude: -122.076,
      imagePreview: null,
      status: "SUBMITTED",
      agency: "Mountain View Public Works",
      createdAt: new Date(now - 2 * DAY).toISOString(),
      updatedAt: new Date(now - 2 * DAY).toISOString(),
    },
  ];

  writeAll(demoReports);
  return demoReports;
}
