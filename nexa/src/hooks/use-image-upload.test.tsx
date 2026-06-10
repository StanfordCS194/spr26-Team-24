import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook, waitFor } from "@/test";

import { useImageUpload } from "./use-image-upload";

// ---------------------------------------------------------------------------
// Browser-API doubles. jsdom provides FileReader/Image stubs that never fire
// load events for our synthetic blobs, so we install controllable fakes.
// ---------------------------------------------------------------------------

const RAW_DATA_URL = "data:image/jpeg;base64,RAWFILE";
const RESIZED_DATA_URL = "data:image/jpeg;base64,RESIZED";

let fileReaderShouldFail = false;

class FakeFileReader {
  result: string | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    queueMicrotask(() => {
      if (fileReaderShouldFail) {
        this.error = new Error("read failed");
        this.onerror?.();
      } else {
        this.result = RAW_DATA_URL;
        this.onload?.();
      }
    });
  }
}

let imageShouldFail = false;
let imageNaturalWidth = 2000;
let imageNaturalHeight = 1000;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = "";
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      if (imageShouldFail) {
        this.onerror?.();
      } else {
        this.naturalWidth = imageNaturalWidth;
        this.naturalHeight = imageNaturalHeight;
        this.onload?.();
      }
    });
  }
  get src() {
    return this._src;
  }
}

// Capture canvas geometry + the toDataURL call so we can assert resize math.
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;
let toDataUrlArgs: unknown[] = [];
let canvasContextNull = false;

const drawImage = vi.fn();

function installCanvasMock() {
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") {
      // Defer to a real element for anything else.
      return Document.prototype.createElement.call(document, tag);
    }
    const canvas = {
      set width(v: number) {
        lastCanvasWidth = v;
      },
      get width() {
        return lastCanvasWidth;
      },
      set height(v: number) {
        lastCanvasHeight = v;
      },
      get height() {
        return lastCanvasHeight;
      },
      getContext: () => (canvasContextNull ? null : { drawImage }),
      toDataURL: (...args: unknown[]) => {
        toDataUrlArgs = args;
        return RESIZED_DATA_URL;
      },
    };
    return canvas as unknown as HTMLElement;
  });
}

function makeFile(type = "image/jpeg"): File {
  return new File(["x"], "photo.jpg", { type });
}

describe("useImageUpload", () => {
  beforeEach(() => {
    fileReaderShouldFail = false;
    imageShouldFail = false;
    imageNaturalWidth = 2000;
    imageNaturalHeight = 1000;
    canvasContextNull = false;
    lastCanvasWidth = 0;
    lastCanvasHeight = 0;
    toDataUrlArgs = [];
    drawImage.mockClear();
    vi.stubGlobal("FileReader", FakeFileReader);
    vi.stubGlobal("Image", FakeImage);
    installCanvasMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with no preview or base64", () => {
    // Arrange / Act
    const { result } = renderHook(() => useImageUpload());

    // Assert
    expect(result.current.imagePreview).toBeNull();
    expect(result.current.imageBase64).toBeNull();
  });

  it("resizes an oversized image down to MAX_DIMENSION via canvas at quality 0.82", async () => {
    // Arrange: 2000x1000 -> longest 2000 > 1280, scale = 1280/2000 = 0.64.
    const { result } = renderHook(() => useImageUpload());
    const event = {
      target: { files: [makeFile()] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Act
    act(() => {
      result.current.handleFileInput(event);
    });

    // Assert
    await waitFor(() =>
      expect(result.current.imagePreview).toBe(RESIZED_DATA_URL),
    );
    expect(result.current.imageBase64).toBe(RESIZED_DATA_URL);
    expect(lastCanvasWidth).toBe(1280); // round(2000 * 0.64)
    expect(lastCanvasHeight).toBe(640); // round(1000 * 0.64)
    expect(drawImage).toHaveBeenCalled();
    expect(toDataUrlArgs).toEqual(["image/jpeg", 0.82]);
  });

  it("keeps original dimensions when the image is within MAX_DIMENSION", async () => {
    // Arrange: 800x600, longest 800 <= 1280, scale = 1.
    imageNaturalWidth = 800;
    imageNaturalHeight = 600;
    const { result } = renderHook(() => useImageUpload());
    const event = {
      target: { files: [makeFile()] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Act
    act(() => {
      result.current.handleFileInput(event);
    });

    // Assert
    await waitFor(() =>
      expect(result.current.imagePreview).toBe(RESIZED_DATA_URL),
    );
    expect(lastCanvasWidth).toBe(800);
    expect(lastCanvasHeight).toBe(600);
  });

  it("falls back to the dataUrl when the 2D context is unavailable", async () => {
    // Arrange: getContext returns null -> resizeImage returns the raw dataUrl.
    canvasContextNull = true;
    const { result } = renderHook(() => useImageUpload());
    const event = {
      target: { files: [makeFile()] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Act
    act(() => {
      result.current.handleFileInput(event);
    });

    // Assert
    await waitFor(() => expect(result.current.imagePreview).toBe(RAW_DATA_URL));
    expect(result.current.imageBase64).toBe(RAW_DATA_URL);
  });

  it("falls back to the raw file when image decode fails in the resize pipeline", async () => {
    // Arrange: Image decode rejects; processFile catch re-reads the raw file.
    imageShouldFail = true;
    const { result } = renderHook(() => useImageUpload());
    const event = {
      target: { files: [makeFile()] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Act
    act(() => {
      result.current.handleFileInput(event);
    });

    // Assert
    await waitFor(() => expect(result.current.imagePreview).toBe(RAW_DATA_URL));
    expect(result.current.imageBase64).toBe(RAW_DATA_URL);
  });

  it("handleFileInput ignores an empty file list", () => {
    // Arrange
    const { result } = renderHook(() => useImageUpload());
    const event = {
      target: { files: [] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Act
    act(() => {
      result.current.handleFileInput(event);
    });

    // Assert
    expect(result.current.imagePreview).toBeNull();
  });

  it("handleDrop processes an image file and prevents default", async () => {
    // Arrange
    const { result } = renderHook(() => useImageUpload());
    const preventDefault = vi.fn();
    const event = {
      preventDefault,
      dataTransfer: { files: [makeFile("image/png")] },
    } as unknown as React.DragEvent;

    // Act
    act(() => {
      result.current.handleDrop(event);
    });

    // Assert
    expect(preventDefault).toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.imagePreview).toBe(RESIZED_DATA_URL),
    );
  });

  it("handleDrop ignores a non-image file (type filter)", () => {
    // Arrange
    const { result } = renderHook(() => useImageUpload());
    const preventDefault = vi.fn();
    const event = {
      preventDefault,
      dataTransfer: { files: [makeFile("application/pdf")] },
    } as unknown as React.DragEvent;

    // Act
    act(() => {
      result.current.handleDrop(event);
    });

    // Assert
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.imagePreview).toBeNull();
    expect(result.current.imageBase64).toBeNull();
  });

  it("clearImage resets preview and base64", async () => {
    // Arrange: populate state first.
    const { result } = renderHook(() => useImageUpload());
    act(() => {
      result.current.handleFileInput({
        target: { files: [makeFile()] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    await waitFor(() =>
      expect(result.current.imagePreview).toBe(RESIZED_DATA_URL),
    );

    // Act
    act(() => {
      result.current.clearImage();
    });

    // Assert
    expect(result.current.imagePreview).toBeNull();
    expect(result.current.imageBase64).toBeNull();
  });
});
