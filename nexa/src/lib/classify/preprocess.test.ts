import { beforeEach, describe, expect, it, vi } from "vitest";

import { preprocessImage } from "./preprocess";

// `stripDataUrlPrefix` is private; it is exercised through `preprocessImage`,
// where we assert on the bytes handed to `sharp`/`exifr`. `sharp` and `exifr`
// are mocked so no real image decoding or filesystem/network access occurs.

// --- sharp mock -----------------------------------------------------------
// sharp(buffer, opts) -> chainable pipeline. We capture the buffer it was
// called with, let .metadata() resolve to configurable original dims, and let
// .toBuffer({resolveWithObject}) resolve to configurable output bytes/dims.
const sharpCalls: { buffer: Buffer; opts: unknown }[] = [];
let metadataValue: { width?: number; height?: number };
let toBufferValue: { data: Buffer; info: { width: number; height: number } };
const rotateMock = vi.fn();
const resizeMock = vi.fn();
const jpegMock = vi.fn();

vi.mock("sharp", () => {
  const sharpFn = vi.fn((buffer: Buffer, opts: unknown) => {
    sharpCalls.push({ buffer, opts });
    const pipeline = {
      metadata: vi.fn(() => Promise.resolve(metadataValue)),
      rotate: rotateMock,
      resize: resizeMock,
      jpeg: jpegMock,
      toBuffer: vi.fn(() => Promise.resolve(toBufferValue)),
    };
    rotateMock.mockReturnValue(pipeline);
    resizeMock.mockReturnValue(pipeline);
    jpegMock.mockReturnValue(pipeline);
    return pipeline;
  });
  return { default: sharpFn };
});

// --- exifr mock -----------------------------------------------------------
const gpsMock = vi.fn();
vi.mock("exifr", () => ({
  default: { gps: (...args: unknown[]) => gpsMock(...args) },
}));

const OUT_BYTES = Buffer.from("re-encoded-jpeg-bytes");

beforeEach(() => {
  sharpCalls.length = 0;
  metadataValue = { width: 4000, height: 3000 };
  toBufferValue = { data: OUT_BYTES, info: { width: 1024, height: 768 } };
  rotateMock.mockClear();
  resizeMock.mockClear();
  jpegMock.mockClear();
  gpsMock.mockReset();
  gpsMock.mockResolvedValue(null);
});

describe("preprocessImage — data URL prefix stripping", () => {
  it("strips a jpeg data-URL prefix before decoding base64", async () => {
    // Arrange: base64 for "hello".
    const payload = Buffer.from("hello").toString("base64");

    // Act
    await preprocessImage(`data:image/jpeg;base64,${payload}`);

    // Assert: sharp received the decoded bytes, not the prefixed string.
    expect(sharpCalls[0].buffer.toString()).toBe("hello");
  });

  it("strips a png data-URL prefix", async () => {
    // Arrange
    const payload = Buffer.from("world").toString("base64");

    // Act
    await preprocessImage(`data:image/png;base64,${payload}`);

    // Assert
    expect(sharpCalls[0].buffer.toString()).toBe("world");
  });

  it("treats raw base64 with no prefix as the payload", async () => {
    // Arrange
    const payload = Buffer.from("raw").toString("base64");

    // Act
    await preprocessImage(payload);

    // Assert
    expect(sharpCalls[0].buffer.toString()).toBe("raw");
  });

  it("keeps the input unchanged when it has no comma despite a data: start", async () => {
    // Arrange: malformed data URL (no comma) → source returns input as-is, so
    // the raw text is base64-decoded directly.
    const input = "data:image/jpeg;base64-no-comma";

    // Act
    await preprocessImage(input);

    // Assert: decoded the literal input string as base64.
    expect(sharpCalls[0].buffer).toEqual(Buffer.from(input, "base64"));
  });

  it("splits on the first comma when multiple are present", async () => {
    // Arrange
    const payload = `${Buffer.from("a").toString("base64")},extra,more`;

    // Act
    await preprocessImage(`data:image/jpeg;base64,${payload}`);

    // Assert: everything after the first comma is treated as the base64 body.
    expect(sharpCalls[0].buffer).toEqual(Buffer.from(payload, "base64"));
  });
});

describe("preprocessImage — output shape and pipeline", () => {
  it("returns a jpeg data URL, raw base64, and byte length", async () => {
    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    const expectedBase64 = OUT_BYTES.toString("base64");
    expect(result.dataUrl).toBe(`data:image/jpeg;base64,${expectedBase64}`);
    expect(result.base64).toBe(expectedBase64);
    expect(result.byteLength).toBe(OUT_BYTES.byteLength);
  });

  it("reports output and original dimensions", async () => {
    // Arrange
    metadataValue = { width: 4000, height: 3000 };
    toBufferValue = { data: OUT_BYTES, info: { width: 1024, height: 768 } };

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.originalWidth).toBe(4000);
    expect(result.originalHeight).toBe(3000);
  });

  it("downscales with fit:inside and withoutEnlargement to MAX_DIMENSION", async () => {
    // Act
    await preprocessImage("Zm9v");

    // Assert: resize was configured to bound both dims to 1024 without growing.
    expect(rotateMock).toHaveBeenCalledOnce();
    expect(resizeMock).toHaveBeenCalledWith({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    });
  });

  it("opens sharp with failOn:none so malformed images do not throw", async () => {
    // Act
    await preprocessImage("Zm9v");

    // Assert
    expect(sharpCalls[0].opts).toEqual({ failOn: "none" });
  });

  it("returns null original dimensions when metadata lacks them", async () => {
    // Arrange
    metadataValue = {};

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.originalWidth).toBeNull();
    expect(result.originalHeight).toBeNull();
  });
});

describe("preprocessImage — EXIF GPS", () => {
  it("includes finite GPS coordinates from EXIF", async () => {
    // Arrange
    gpsMock.mockResolvedValue({ latitude: 37.5, longitude: -122.2 });

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.exifGps).toEqual({ latitude: 37.5, longitude: -122.2 });
  });

  it("returns null GPS when exifr finds none", async () => {
    // Arrange
    gpsMock.mockResolvedValue(null);

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.exifGps).toBeNull();
  });

  it("rejects non-finite GPS coordinates", async () => {
    // Arrange
    gpsMock.mockResolvedValue({ latitude: Number.NaN, longitude: Infinity });

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.exifGps).toBeNull();
  });

  it("rejects non-numeric GPS coordinates", async () => {
    // Arrange
    gpsMock.mockResolvedValue({ latitude: "37.5", longitude: "-122.2" });

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.exifGps).toBeNull();
  });

  it("treats an exifr throw as no GPS (still processes the image)", async () => {
    // Arrange: exifr throws on images with no EXIF block.
    gpsMock.mockRejectedValue(new Error("no exif"));

    // Act
    const result = await preprocessImage("Zm9v");

    // Assert
    expect(result.exifGps).toBeNull();
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});
