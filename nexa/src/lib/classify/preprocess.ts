import sharp from "sharp";
import exifr from "exifr";

export interface PreprocessedImage {
  // base64 data URL ready to be passed to VLMs as image_url
  dataUrl: string;
  // raw base64 (no data: prefix), kept for providers that want it that way
  base64: string;
  // bytes of the re-encoded image
  byteLength: number;
  // GPS extracted from EXIF, if present
  exifGps: { latitude: number; longitude: number } | null;
  // image dimensions after preprocessing
  width: number;
  height: number;
  // original dimensions before preprocessing
  originalWidth: number | null;
  originalHeight: number | null;
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 80;

/**
 * Strip a `data:image/...;base64,` prefix if present and return the raw base64
 * payload.
 */
function stripDataUrlPrefix(input: string): string {
  const comma = input.indexOf(",");
  if (input.startsWith("data:") && comma !== -1) {
    return input.slice(comma + 1);
  }
  return input;
}

/**
 * Normalize a user-supplied image for downstream classification:
 *
 *   1. Decode the (possibly data-URL-wrapped) base64 input.
 *   2. Pull GPS out of EXIF before we touch the bytes — `sharp.rotate()`
 *      strips orientation metadata, which on some encoders also drops GPS.
 *   3. Auto-rotate based on EXIF orientation so the image is upright.
 *   4. Downscale so neither dimension exceeds MAX_DIMENSION (preserves aspect).
 *   5. Re-encode as JPEG at JPEG_QUALITY.
 *
 * Returns the re-encoded image plus any GPS we extracted. The output is
 * meaningfully smaller than typical phone photos (3-5MB → 100-300KB), which
 * cuts token cost and latency on every VLM call.
 */
export async function preprocessImage(
  input: string,
): Promise<PreprocessedImage> {
  const raw = stripDataUrlPrefix(input);
  const buffer = Buffer.from(raw, "base64");

  let exifGps: PreprocessedImage["exifGps"] = null;
  try {
    const gps = await exifr.gps(buffer);
    if (
      gps &&
      typeof gps.latitude === "number" &&
      typeof gps.longitude === "number" &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude)
    ) {
      exifGps = { latitude: gps.latitude, longitude: gps.longitude };
    }
  } catch {
    // exifr throws on images with no EXIF block — that's fine, just leave GPS null.
  }

  const pipeline = sharp(buffer, { failOn: "none" });
  const original = await pipeline.metadata();

  const resized = await pipeline
    .rotate() // auto-orient based on EXIF orientation tag
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const outBase64 = resized.data.toString("base64");
  return {
    dataUrl: `data:image/jpeg;base64,${outBase64}`,
    base64: outBase64,
    byteLength: resized.data.byteLength,
    exifGps,
    width: resized.info.width,
    height: resized.info.height,
    originalWidth: original.width ?? null,
    originalHeight: original.height ?? null,
  };
}
