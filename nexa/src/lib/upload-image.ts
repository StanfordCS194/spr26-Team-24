// Client-side image upload via presigned URL (issue #30).
//
// Given an already-resized image data URL (produced by `useImageUpload`), this
// asks the server for a presigned PUT URL and, when storage is configured,
// uploads the bytes directly to S3/R2 and returns the public object URL to
// store as `Report.imageUrl`.
//
// SAFE FALLBACK: returns `null` whenever storage is not configured OR anything
// in the presign/upload path fails. Callers treat `null` as "keep the existing
// inline base64 behaviour", so the report still submits with no storage creds.

import type { ApiResponse } from "@/lib/api/response";

/** Server response shape from `POST /api/uploads/presign`. */
type PresignResponse =
  | { configured: false }
  | {
      configured: true;
      uploadUrl: string;
      objectUrl: string;
      contentType: string;
    };

/**
 * Parse a `data:<mime>;base64,<payload>` URL into a Blob plus its MIME type.
 * Returns `null` for inputs that are not base64 data URLs (e.g. an already
 * remote URL), which the caller treats as "nothing to upload".
 */
function dataUrlToBlob(
  dataUrl: string,
): { blob: Blob; contentType: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;

  const contentType = match[1];
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { blob: new Blob([bytes], { type: contentType }), contentType };
  } catch {
    return null;
  }
}

/** Map an arbitrary image MIME type to one the presign route accepts. */
function normalizeContentType(contentType: string): "image/jpeg" | "image/png" {
  return contentType === "image/png" ? "image/png" : "image/jpeg";
}

/**
 * Upload a resized image to object storage via a presigned URL.
 *
 * @param imageDataUrl the resized `data:image/...;base64,...` URL.
 * @returns the public object URL on success, or `null` to fall back to inline
 *          base64 (storage not configured, non-data-URL input, or any failure).
 */
export async function uploadImageViaPresign(
  imageDataUrl: string,
): Promise<string | null> {
  const parsed = dataUrlToBlob(imageDataUrl);
  if (!parsed) return null;

  const contentType = normalizeContentType(parsed.contentType);

  try {
    const presignRes = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType }),
    });

    if (!presignRes.ok) return null;

    const envelope = (await presignRes.json()) as ApiResponse<PresignResponse>;
    if (!envelope.success || !envelope.data.configured) return null;

    const { uploadUrl, objectUrl } = envelope.data;

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: parsed.blob,
    });
    if (!putRes.ok) return null;

    return objectUrl;
  } catch {
    // Network error, non-JSON response, etc. — fall back to inline base64.
    return null;
  }
}
