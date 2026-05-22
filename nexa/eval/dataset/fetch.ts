/**
 * Build the eval dataset by querying Wikimedia Commons for civic-issue photos.
 *
 * Usage:
 *   npx tsx eval/dataset/fetch.ts                     # update cases.json
 *   npx tsx eval/dataset/fetch.ts --download          # also pre-download to _cache/
 *
 * We use one combined `generator=categorymembers + prop=imageinfo` request
 * per category so we get titles + URLs + EXIF + license metadata in a single
 * round trip. This keeps us well under Wikimedia's rate limits.
 *
 * All images are CC-BY-SA or public-domain via Wikimedia Commons. The manifest
 * is checked into git, the cached image bytes (eval/dataset/_cache/) are not.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { IssueType } from "../../src/lib/classify/types";

const API = "https://commons.wikimedia.org/w/api.php";
const PER_CATEGORY = 50;
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 20 * 1024;
const REQUEST_DELAY_MS = 1500;

interface CategoryConfig {
  category: string;
  expected: IssueType;
}

const CATEGORIES: CategoryConfig[] = [
  // ROAD_DAMAGE
  { category: "Potholes", expected: "ROAD_DAMAGE" },
  { category: "Damaged roads", expected: "ROAD_DAMAGE" },
  { category: "Road damage", expected: "ROAD_DAMAGE" },
  { category: "Cracks in pavement", expected: "ROAD_DAMAGE" },
  { category: "Damaged pavements", expected: "ROAD_DAMAGE" },
  { category: "Damaged sidewalks", expected: "ROAD_DAMAGE" },
  { category: "Sinkholes", expected: "ROAD_DAMAGE" },
  { category: "Subsidence", expected: "ROAD_DAMAGE" },
  { category: "Flood damage", expected: "ROAD_DAMAGE" },
  // STREETLIGHT_OUTAGE
  { category: "Damaged street lights", expected: "STREETLIGHT_OUTAGE" },
  { category: "Broken street lamps", expected: "STREETLIGHT_OUTAGE" },
  { category: "Broken lamp posts", expected: "STREETLIGHT_OUTAGE" },
  { category: "Damaged lamp posts", expected: "STREETLIGHT_OUTAGE" },
  { category: "Fallen lamp posts", expected: "STREETLIGHT_OUTAGE" },
  { category: "Vandalized street furniture", expected: "STREETLIGHT_OUTAGE" },
  // ILLEGAL_DUMPING
  { category: "Illegal dumping", expected: "ILLEGAL_DUMPING" },
  { category: "Litter", expected: "ILLEGAL_DUMPING" },
  { category: "Garbage on the ground", expected: "ILLEGAL_DUMPING" },
  { category: "Roadside litter", expected: "ILLEGAL_DUMPING" },
  { category: "Fly tipping", expected: "ILLEGAL_DUMPING" },
  { category: "Abandoned mattresses", expected: "ILLEGAL_DUMPING" },
  { category: "Abandoned furniture", expected: "ILLEGAL_DUMPING" },
  { category: "Garbage piles", expected: "ILLEGAL_DUMPING" },
  { category: "Trash on streets", expected: "ILLEGAL_DUMPING" },
  { category: "Dumping sites", expected: "ILLEGAL_DUMPING" },
  // VEHICLE_EMISSIONS
  { category: "Exhaust smoke", expected: "VEHICLE_EMISSIONS" },
  { category: "Exhaust fumes", expected: "VEHICLE_EMISSIONS" },
  { category: "Air pollution by vehicles", expected: "VEHICLE_EMISSIONS" },
  { category: "Vehicles emitting smoke", expected: "VEHICLE_EMISSIONS" },
  { category: "Diesel smoke", expected: "VEHICLE_EMISSIONS" },
  { category: "Diesel exhaust", expected: "VEHICLE_EMISSIONS" },
  { category: "Truck exhaust", expected: "VEHICLE_EMISSIONS" },
  { category: "Black smoke from vehicles", expected: "VEHICLE_EMISSIONS" },
];

interface CombinedResponse {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: Array<{
          url: string;
          size: number;
          mime: string;
          width: number;
          height: number;
          extmetadata?: {
            LicenseShortName?: { value: string };
            Artist?: { value: string };
            Credit?: { value: string };
            ImageDescription?: { value: string };
            GPSLatitude?: { value: string };
            GPSLongitude?: { value: string };
          };
        }>;
      }
    >;
  };
}

export interface DatasetCase {
  id: string;
  source: "wikimedia-commons" | "local";
  url: string;
  title: string;
  expected: IssueType;
  category: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  license: string;
  attribution: string;
  exifGps: { latitude: number; longitude: number } | null;
  caption: string | null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(url: string, retries = 4): Promise<T> {
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1));
      process.stdout.write(` (retry ${attempt} in ${backoff}ms)`);
      await sleep(backoff);
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Nexa-Eval/1.0 (Stanford CS194 spr26 Team 24; classification eval harness; https://github.com/StanfordCS194/spr26-Team-24)",
        Accept: "application/json",
      },
    });
    if (res.ok) return (await res.json()) as T;
    lastErr = `HTTP ${res.status}`;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`${lastErr} for ${url}`);
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchCategory(cfg: CategoryConfig): Promise<DatasetCase[]> {
  const url =
    `${API}?action=query&format=json&formatversion=2` +
    `&generator=categorymembers` +
    `&gcmtitle=${encodeURIComponent(`Category:${cfg.category}`)}` +
    `&gcmtype=file&gcmlimit=${PER_CATEGORY * 3}` +
    `&prop=imageinfo` +
    `&iiprop=url%7Csize%7Cmime%7Cextmetadata`;

  const data = await fetchJson<CombinedResponse>(url);
  const pages = Object.values(data.query?.pages ?? {});
  const out: DatasetCase[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (!["image/jpeg", "image/png"].includes(info.mime)) continue;
    if (info.size < MIN_BYTES || info.size > MAX_BYTES) continue;

    const meta = info.extmetadata ?? {};
    const lat = parseNum(meta.GPSLatitude?.value);
    const lng = parseNum(meta.GPSLongitude?.value);

    out.push({
      id: page.title.replace(/^File:/, "").replace(/[^A-Za-z0-9._-]+/g, "_"),
      source: "wikimedia-commons",
      url: info.url,
      title: page.title,
      expected: cfg.expected,
      category: cfg.category,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: info.size,
      license: stripHtml(meta.LicenseShortName?.value ?? "unknown"),
      attribution: stripHtml(
        meta.Artist?.value ?? meta.Credit?.value ?? "Wikimedia Commons",
      ),
      exifGps:
        lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
      caption: meta.ImageDescription
        ? stripHtml(meta.ImageDescription.value)
        : null,
    });
    if (out.length >= PER_CATEGORY) break;
  }
  return out;
}

async function downloadCase(
  c: DatasetCase,
  cacheDir: string,
  retries = 4,
): Promise<void> {
  const ext = c.mime === "image/png" ? ".png" : ".jpg";
  const target = path.join(cacheDir, `${c.id}${ext}`);
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(20000, 2000 * 2 ** (attempt - 1));
      await sleep(backoff);
    }
    const res = await fetch(c.url, {
      headers: {
        "User-Agent":
          "Nexa-Eval/1.0 (Stanford CS194 spr26 Team 24; classification eval harness; https://github.com/StanfordCS194/spr26-Team-24)",
      },
    });
    if (res.ok && res.body) {
      await pipeline(
        res.body as unknown as NodeJS.ReadableStream,
        createWriteStream(target),
      );
      return;
    }
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`download failed for ${c.url}: HTTP ${lastStatus}`);
}

async function main() {
  const shouldDownload = process.argv.includes("--download");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outFile = path.join(here, "cases.json");
  const cacheDir = path.join(here, "_cache");
  if (shouldDownload) await mkdir(cacheDir, { recursive: true });

  const cases: DatasetCase[] = [];
  const seen = new Set<string>();

  for (const cfg of CATEGORIES) {
    process.stdout.write(`Category:${cfg.category} …`);
    try {
      const found = await fetchCategory(cfg);
      let kept = 0;
      for (const c of found) {
        if (seen.has(c.title)) continue;
        cases.push(c);
        seen.add(c.title);
        kept++;
      }
      console.log(` ${kept} kept (of ${found.length} candidates)`);
    } catch (err) {
      console.log(` FAILED: ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Include the team's existing test-photos as ground-truth anchors.
  const local: DatasetCase[] = [
    {
      id: "local_pothole-1",
      source: "local",
      url: "test-photos/pothole-1.jpg",
      title: "pothole-1.jpg",
      expected: "ROAD_DAMAGE",
      category: "team-test-photos",
      mime: "image/jpeg",
      width: 0,
      height: 0,
      bytes: 0,
      license: "internal",
      attribution: "Nexa team test photos",
      exifGps: null,
      caption: null,
    },
    {
      id: "local_illegal-dumping-1",
      source: "local",
      url: "test-photos/illegal-dumping-1.jpg",
      title: "illegal-dumping-1.jpg",
      expected: "ILLEGAL_DUMPING",
      category: "team-test-photos",
      mime: "image/jpeg",
      width: 0,
      height: 0,
      bytes: 0,
      license: "internal",
      attribution: "Nexa team test photos",
      exifGps: null,
      caption: null,
    },
    {
      id: "local_exhaust-smoke-1",
      source: "local",
      url: "test-photos/exhaust-smoke-1.jpg",
      title: "exhaust-smoke-1.jpg",
      expected: "VEHICLE_EMISSIONS",
      category: "team-test-photos",
      mime: "image/jpeg",
      width: 0,
      height: 0,
      bytes: 0,
      license: "internal",
      attribution: "Nexa team test photos",
      exifGps: null,
      caption: null,
    },
  ];
  cases.push(...local);

  await writeFile(outFile, JSON.stringify(cases, null, 2) + "\n");
  console.log(`\nWrote ${cases.length} cases → ${outFile}`);

  if (shouldDownload) {
    const remote = cases.filter((c) => c.source === "wikimedia-commons");
    console.log(`Downloading ${remote.length} files to ${cacheDir} …`);
    let ok = 0;
    let i = 0;
    for (const c of remote) {
      i++;
      try {
        await downloadCase(c, cacheDir);
        ok++;
        process.stdout.write(`  [${i}/${remote.length}] ${c.id}\n`);
      } catch (err) {
        console.error(
          `  ! [${i}/${remote.length}] ${c.id}: ${(err as Error).message}`,
        );
      }
      await sleep(800); // be polite to upload.wikimedia.org
    }
    console.log(`Downloaded ${ok}/${remote.length}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
