import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control the storage config getters so we can exercise the configured and
// not-configured branches without any real AWS credentials. `vi.hoisted` lets
// the hoisted `vi.mock` factory reference the spies without a TDZ error.
const {
  getS3Bucket,
  getS3Region,
  getS3Endpoint,
  getS3AccessKeyId,
  getS3SecretAccessKey,
  getS3PublicBaseUrl,
} = vi.hoisted(() => ({
  getS3Bucket: vi.fn(),
  getS3Region: vi.fn(),
  getS3Endpoint: vi.fn(),
  getS3AccessKeyId: vi.fn(),
  getS3SecretAccessKey: vi.fn(),
  getS3PublicBaseUrl: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getS3Bucket,
    getS3Region,
    getS3Endpoint,
    getS3AccessKeyId,
    getS3SecretAccessKey,
    getS3PublicBaseUrl,
  };
});

import {
  __resetStorageClient,
  createPresignedUpload,
  isStorageConfigured,
  publicObjectUrl,
} from "./storage";

/** Set every required var so storage is considered configured. */
function configureStorage(overrides: Partial<Record<string, string>> = {}) {
  getS3Bucket.mockReturnValue(overrides.bucket ?? "my-bucket");
  getS3Region.mockReturnValue(overrides.region ?? "us-east-1");
  getS3Endpoint.mockReturnValue(overrides.endpoint);
  getS3AccessKeyId.mockReturnValue(overrides.accessKeyId ?? "AKIA_TEST");
  getS3SecretAccessKey.mockReturnValue(overrides.secret ?? "secret-test");
  getS3PublicBaseUrl.mockReturnValue(
    overrides.publicBaseUrl ?? "https://cdn.example.com",
  );
}

describe("storage — not configured (safe fallback)", () => {
  beforeEach(() => {
    // Every getter returns undefined: no storage env at all.
    getS3Bucket.mockReturnValue(undefined);
    getS3Region.mockReturnValue(undefined);
    getS3Endpoint.mockReturnValue(undefined);
    getS3AccessKeyId.mockReturnValue(undefined);
    getS3SecretAccessKey.mockReturnValue(undefined);
    getS3PublicBaseUrl.mockReturnValue(undefined);
    __resetStorageClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports storage as not configured", () => {
    expect(isStorageConfigured()).toBe(false);
  });

  it("createPresignedUpload returns null so callers fall back to base64", async () => {
    await expect(createPresignedUpload("image/jpeg")).resolves.toBeNull();
  });

  it("publicObjectUrl returns null when not configured", () => {
    expect(publicObjectUrl("reports/whatever.jpg")).toBeNull();
  });

  it("stays not-configured when only some vars are present", () => {
    // Bucket + keys set, but no public base URL → still not configured.
    getS3Bucket.mockReturnValue("my-bucket");
    getS3AccessKeyId.mockReturnValue("AKIA_TEST");
    getS3SecretAccessKey.mockReturnValue("secret-test");
    getS3PublicBaseUrl.mockReturnValue(undefined);
    expect(isStorageConfigured()).toBe(false);
  });
});

describe("storage — configured", () => {
  beforeEach(() => {
    __resetStorageClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports storage as configured when all required vars are set", () => {
    configureStorage();
    expect(isStorageConfigured()).toBe(true);
  });

  it("publicObjectUrl joins the base URL and key, trimming a trailing slash", () => {
    configureStorage({ publicBaseUrl: "https://cdn.example.com/" });
    expect(publicObjectUrl("reports/abc.jpg")).toBe(
      "https://cdn.example.com/reports/abc.jpg",
    );
  });

  it("createPresignedUpload yields an upload URL and matching object URL", async () => {
    configureStorage({ publicBaseUrl: "https://cdn.example.com" });

    const result = await createPresignedUpload("image/png");
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.contentType).toBe("image/png");
    expect(result.key).toMatch(/^reports\/[0-9a-f-]+\.png$/);
    expect(result.objectUrl).toBe(`https://cdn.example.com/${result.key}`);
    // A presigned URL is a real, signed HTTPS URL carrying the SigV4 params.
    expect(result.uploadUrl).toContain(result.key);
    expect(result.uploadUrl).toMatch(/X-Amz-Signature=/);
  });

  it("defaults the content type to image/jpeg", async () => {
    configureStorage();
    const result = await createPresignedUpload();
    expect(result?.contentType).toBe("image/jpeg");
    expect(result?.key).toMatch(/\.jpg$/);
  });
});
