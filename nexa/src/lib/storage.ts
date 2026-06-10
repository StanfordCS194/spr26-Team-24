// ---------------------------------------------------------------------------
// S3 / Cloudflare R2 object storage for report images (issue #30).
//
// The report flow currently stores the photo inline as a base64 data URL in
// `Report.imageUrl`. That works for the MVP but bloats request bodies and the
// database. This module adds an OPTIONAL upload path: when S3-compatible
// storage is configured, the client uploads the (already client-resized) image
// straight to the bucket via a presigned PUT URL and we store the public object
// URL instead of the bytes.
//
// ENV-GATED, SAFE FALLBACK: when storage is NOT configured, callers detect that
// via `isStorageConfigured()` and the app keeps its existing inline base64
// behaviour unchanged. No credentials are required for the app to run — the
// pipeline is "ready to activate" by setting the S3_* env vars.
//
// S3 ⇄ R2: the same six env vars cover both. For Cloudflare R2 set `S3_ENDPOINT`
// to the account R2 gateway and `S3_REGION` is irrelevant (the SDK still wants a
// value, so we default it to "auto"). Everything else is identical.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getS3AccessKeyId,
  getS3Bucket,
  getS3Endpoint,
  getS3PublicBaseUrl,
  getS3Region,
  getS3SecretAccessKey,
} from "@/lib/config";

/** How long a presigned PUT URL stays valid, in seconds. */
const PRESIGN_EXPIRES_SECONDS = 300;

/** Fallback region for S3-compatible providers (R2) that ignore it. */
const DEFAULT_REGION = "auto";

/** The fully-resolved storage config, present only when storage is configured. */
interface StorageConfig {
  bucket: string;
  region: string;
  endpoint: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

/**
 * Resolve the storage config from env, returning `null` when any REQUIRED var
 * is missing. `region` and `endpoint` are not part of the required set —
 * `region` falls back to {@link DEFAULT_REGION} and `endpoint` is optional
 * (AWS S3 needs none; R2 needs one).
 */
function resolveConfig(): StorageConfig | null {
  const bucket = getS3Bucket();
  const accessKeyId = getS3AccessKeyId();
  const secretAccessKey = getS3SecretAccessKey();
  const publicBaseUrl = getS3PublicBaseUrl();

  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    return null;
  }

  return {
    bucket,
    region: getS3Region() ?? DEFAULT_REGION,
    endpoint: getS3Endpoint(),
    accessKeyId,
    secretAccessKey,
    // Trim a trailing slash so URL joins don't produce `//`.
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
}

/**
 * Whether object storage is configured. When `false`, callers MUST keep the
 * existing inline base64/data-URL behaviour — this is the safe fallback that
 * lets the app run without any cloud credentials.
 */
export function isStorageConfigured(): boolean {
  return resolveConfig() !== null;
}

/** Lazily-built S3 client, memoized so we don't reconstruct it per request. */
let cachedClient: { client: S3Client; config: StorageConfig } | null = null;

function getClient(config: StorageConfig): S3Client {
  if (cachedClient && cachedClient.config === config) {
    return cachedClient.client;
  }
  const client = new S3Client({
    region: config.region,
    // Only set `endpoint` when provided; passing `undefined` to the SDK is fine
    // but being explicit keeps AWS-S3 behaviour on the default endpoint.
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    // R2 and most S3-compatibles want path-style addressing; it's also valid
    // for AWS S3, so we use it uniformly to avoid bucket-in-hostname surprises.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClient = { client, config };
  return client;
}

/** Result of a successful presign: where to PUT, and the eventual public URL. */
export interface PresignResult {
  /** The presigned URL the client uploads the image bytes to (HTTP PUT). */
  uploadUrl: string;
  /** The public URL the object is served from — stored as `Report.imageUrl`. */
  objectUrl: string;
  /** The object key within the bucket. */
  key: string;
  /** Content type the client must send on the PUT (must match what was signed). */
  contentType: string;
}

/**
 * Build a storage object key for a new upload. Namespaced under `reports/` and
 * suffixed from the content type so the object has a sensible extension.
 */
function buildKey(contentType: string): string {
  const ext = contentType === "image/png" ? "png" : "jpg";
  return `reports/${randomUUID()}.${ext}`;
}

/**
 * Compute the public URL an object is served from, given its key. Exposed so
 * tests and callers can derive the URL without re-presigning.
 */
export function publicObjectUrl(key: string): string | null {
  const config = resolveConfig();
  if (!config) return null;
  return `${config.publicBaseUrl}/${key}`;
}

/**
 * Create a presigned PUT URL for a new report image and compute the public URL
 * the object will be served from once uploaded.
 *
 * Returns `null` when storage is not configured so callers fall back to inline
 * base64. `contentType` is signed into the URL: the client MUST send the same
 * `Content-Type` header on its PUT or the upload is rejected.
 */
export async function createPresignedUpload(
  contentType = "image/jpeg",
): Promise<PresignResult | null> {
  const config = resolveConfig();
  if (!config) return null;

  const key = buildKey(contentType);
  const client = getClient(config);

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  return {
    uploadUrl,
    objectUrl: `${config.publicBaseUrl}/${key}`,
    key,
    contentType,
  };
}

/** Test-only: drop the memoized client so config changes take effect. */
export function __resetStorageClient(): void {
  cachedClient = null;
}
