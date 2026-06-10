import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadImageViaPresign } from "./upload-image";

// A 1x1 JPEG-ish data URL — the exact bytes don't matter, only that it's a
// valid base64 data URL the helper can decode into a Blob.
const DATA_URL = `data:image/jpeg;base64,${btoa("hello-bytes")}`;

function presignResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("uploadImageViaPresign", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for a non-data-URL input (nothing to upload)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await uploadImageViaPresign("https://example.com/x.jpg");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null (fallback to base64) when storage is not configured", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      presignResponse({ success: true, data: { configured: false } }),
    );

    const result = await uploadImageViaPresign(DATA_URL);
    expect(result).toBeNull();
  });

  it("uploads to the presigned URL and returns the object URL when configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        presignResponse({
          success: true,
          data: {
            configured: true,
            uploadUrl: "https://bucket.example.com/reports/abc.jpg?sig",
            objectUrl: "https://cdn.example.com/reports/abc.jpg",
            contentType: "image/jpeg",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await uploadImageViaPresign(DATA_URL);

    expect(result).toBe("https://cdn.example.com/reports/abc.jpg");
    // Second call is the PUT to the presigned URL with the right content type.
    const putCall = fetchSpy.mock.calls[1];
    expect(putCall[0]).toBe("https://bucket.example.com/reports/abc.jpg?sig");
    expect(putCall[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
    });
  });

  it("returns null when the PUT upload fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        presignResponse({
          success: true,
          data: {
            configured: true,
            uploadUrl: "https://bucket.example.com/reports/abc.jpg?sig",
            objectUrl: "https://cdn.example.com/reports/abc.jpg",
            contentType: "image/jpeg",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    const result = await uploadImageViaPresign(DATA_URL);
    expect(result).toBeNull();
  });

  it("returns null when the presign request itself errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const result = await uploadImageViaPresign(DATA_URL);
    expect(result).toBeNull();
  });

  it("derives image/png content type from a PNG data URL", async () => {
    const pngUrl = `data:image/png;base64,${btoa("png-bytes")}`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        presignResponse({ success: true, data: { configured: false } }),
      );

    await uploadImageViaPresign(pngUrl);

    const presignBody = JSON.parse(
      (fetchSpy.mock.calls[0][1]?.body as string) ?? "{}",
    );
    expect(presignBody.contentType).toBe("image/png");
  });
});
