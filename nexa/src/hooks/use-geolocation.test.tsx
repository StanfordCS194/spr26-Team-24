import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook, waitFor } from "@/test";

// Mock the reverse-geocode path so no real Nominatim/network call is made and
// the resolved address is fully under test control.
vi.mock("@/lib/reverse-geocode", () => ({
  reverseGeocode: vi.fn(),
}));

import { reverseGeocode } from "@/lib/reverse-geocode";
import { useGeolocation } from "./use-geolocation";

const mockReverseGeocode = vi.mocked(reverseGeocode);

// GeolocationPositionError-like codes (the spec values the hook switches on).
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function makePosition(lat: number, lng: number, accuracy: number) {
  return {
    coords: { latitude: lat, longitude: lng, accuracy },
  } as GeolocationPosition;
}

function makeError(code: number) {
  return {
    code,
    PERMISSION_DENIED,
    POSITION_UNAVAILABLE,
    TIMEOUT,
  } as unknown as GeolocationPositionError;
}

/** Install a controllable navigator.geolocation mock. */
function installGeolocation() {
  const getCurrentPosition = vi.fn();
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

describe("useGeolocation", () => {
  beforeEach(() => {
    mockReverseGeocode.mockResolvedValue("123 Main St, Palo Alto");
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Remove the geolocation stub so each test re-installs its own.
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
  });

  it("starts with empty state", () => {
    // Arrange / Act
    const { result } = renderHook(() => useGeolocation());

    // Assert
    expect(result.current.address).toBe("");
    expect(result.current.latitude).toBeNull();
    expect(result.current.longitude).toBeNull();
    expect(result.current.accuracy).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("detect() sets an unsupported error when geolocation is unavailable", () => {
    // Arrange: geolocation left undefined (afterEach default)
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    expect(result.current.error).toBe("geo.unsupported");
    expect(result.current.loading).toBe(false);
  });

  it("detect() success sets coords, accuracy, and the reverse-geocoded address", async () => {
    // Arrange
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((success) => {
      success(makePosition(37.44, -122.16, 12));
    });
    mockReverseGeocode.mockResolvedValue("195 University Ave");
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.latitude).toBe(37.44);
    expect(result.current.longitude).toBe(-122.16);
    expect(result.current.accuracy).toBe(12);
    expect(mockReverseGeocode).toHaveBeenCalledWith(37.44, -122.16);
    await waitFor(() =>
      expect(result.current.address).toBe("195 University Ave"),
    );
  });

  it("detect() falls back to a coordinate string when reverse-geocode yields the fallback", async () => {
    // Arrange: reverseGeocode itself returns the coordinate fallback on failure.
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((success) => {
      success(makePosition(1.23, 4.56, 5));
    });
    mockReverseGeocode.mockResolvedValue("1.230000, 4.560000");
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    await waitFor(() =>
      expect(result.current.address).toBe("1.230000, 4.560000"),
    );
  });

  it("detect() maps PERMISSION_DENIED to geo.denied", async () => {
    // Arrange
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((_success, error) => {
      error(makeError(PERMISSION_DENIED));
    });
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    await waitFor(() => expect(result.current.error).toBe("geo.denied"));
    expect(result.current.loading).toBe(false);
  });

  it("detect() maps POSITION_UNAVAILABLE to geo.unavailable", async () => {
    // Arrange
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((_success, error) => {
      error(makeError(POSITION_UNAVAILABLE));
    });
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    await waitFor(() => expect(result.current.error).toBe("geo.unavailable"));
  });

  it("detect() maps TIMEOUT to geo.timeout", async () => {
    // Arrange
    const getCurrentPosition = installGeolocation();
    getCurrentPosition.mockImplementation((_success, error) => {
      error(makeError(TIMEOUT));
    });
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.detect();
    });

    // Assert
    await waitFor(() => expect(result.current.error).toBe("geo.timeout"));
  });

  it("setCoordinates() updates latitude and longitude", () => {
    // Arrange
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.setCoordinates(10, 20);
    });

    // Assert
    expect(result.current.latitude).toBe(10);
    expect(result.current.longitude).toBe(20);
  });

  it("movePin() sets coords and refreshes the address", async () => {
    // Arrange
    mockReverseGeocode.mockResolvedValue("Pinned Address");
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.movePin(5, 6);
    });

    // Assert
    expect(result.current.latitude).toBe(5);
    expect(result.current.longitude).toBe(6);
    expect(mockReverseGeocode).toHaveBeenCalledWith(5, 6);
    await waitFor(() => expect(result.current.address).toBe("Pinned Address"));
  });

  it("reset() clears coords, accuracy, address, and error", async () => {
    // Arrange: populate some state first.
    mockReverseGeocode.mockResolvedValue("Some Address");
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      result.current.movePin(5, 6);
    });
    await waitFor(() => expect(result.current.address).toBe("Some Address"));

    // Act
    act(() => {
      result.current.reset();
    });

    // Assert
    expect(result.current.latitude).toBeNull();
    expect(result.current.longitude).toBeNull();
    expect(result.current.accuracy).toBeNull();
    expect(result.current.address).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("setAddress() lets the caller override the address directly", () => {
    // Arrange
    const { result } = renderHook(() => useGeolocation());

    // Act
    act(() => {
      result.current.setAddress("Manual Address");
    });

    // Assert
    expect(result.current.address).toBe("Manual Address");
  });
});
