import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the storage layer so the route can be exercised in both the configured
// and not-configured modes with no AWS credentials. `vi.hoisted` lets the
// hoisted `vi.mock` factory reference the spies without a TDZ error.
const { isStorageConfigured, createPresignedUpload } = vi.hoisted(() => ({
  isStorageConfigured: vi.fn(),
  createPresignedUpload: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  isStorageConfigured,
  createPresignedUpload,
}));

import { POST } from "./route";
import { __resetRateLimitStore } from "@/lib/rate-limit";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/uploads/presign", () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns configured:false (200) when storage is not configured, so the client falls back", async () => {
    isStorageConfigured.mockReturnValue(false);

    const response = await POST(request({ contentType: "image/jpeg" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { configured: false } });
    expect(createPresignedUpload).not.toHaveBeenCalled();
  });

  it("returns the presigned + object URLs when storage is configured", async () => {
    isStorageConfigured.mockReturnValue(true);
    createPresignedUpload.mockResolvedValue({
      uploadUrl: "https://bucket.example.com/reports/abc.jpg?X-Amz-Signature=x",
      objectUrl: "https://cdn.example.com/reports/abc.jpg",
      key: "reports/abc.jpg",
      contentType: "image/jpeg",
    });

    const response = await POST(request({ contentType: "image/jpeg" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      configured: true,
      uploadUrl: expect.stringContaining("X-Amz-Signature="),
      objectUrl: "https://cdn.example.com/reports/abc.jpg",
      contentType: "image/jpeg",
    });
    expect(createPresignedUpload).toHaveBeenCalledWith("image/jpeg");
  });

  it("defaults the content type to image/jpeg when omitted", async () => {
    isStorageConfigured.mockReturnValue(true);
    createPresignedUpload.mockResolvedValue({
      uploadUrl: "https://bucket.example.com/reports/abc.jpg?sig",
      objectUrl: "https://cdn.example.com/reports/abc.jpg",
      key: "reports/abc.jpg",
      contentType: "image/jpeg",
    });

    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(createPresignedUpload).toHaveBeenCalledWith("image/jpeg");
  });

  it("rejects an unsupported content type with a 400 envelope", async () => {
    isStorageConfigured.mockReturnValue(true);

    const response = await POST(request({ contentType: "image/gif" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(createPresignedUpload).not.toHaveBeenCalled();
  });

  it("falls back to configured:false when presign unexpectedly yields null", async () => {
    isStorageConfigured.mockReturnValue(true);
    createPresignedUpload.mockResolvedValue(null);

    const response = await POST(request({ contentType: "image/png" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { configured: false } });
  });

  it("returns a 500 envelope when presigning throws", async () => {
    isStorageConfigured.mockReturnValue(true);
    createPresignedUpload.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request({ contentType: "image/jpeg" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    errorSpy.mockRestore();
  });
});
