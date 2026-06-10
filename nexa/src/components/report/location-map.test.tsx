import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test";

import LocationMap from "./location-map";

// ---------------------------------------------------------------------------
// Leaflet double. The real library touches the DOM/canvas and pulls map tiles
// over the network. We replace it with a chainable fake whose calls we can
// inspect, and capture the `dragend` handler so we can simulate a pin drag.
// ---------------------------------------------------------------------------
let dragendHandler: (() => void) | null = null;
const markerLatLng = { lat: 1, lng: 2 };

const marker = {
  addTo: vi.fn(() => marker),
  on: vi.fn((event: string, cb: () => void) => {
    if (event === "dragend") dragendHandler = cb;
    return marker;
  }),
  getLatLng: vi.fn(() => markerLatLng),
  setLatLng: vi.fn(() => marker),
};

const map = {
  remove: vi.fn(),
  setView: vi.fn(() => map),
  getZoom: vi.fn(() => 16),
};

const tileLayer = { addTo: vi.fn(() => tileLayer) };

const L = {
  map: vi.fn(() => map),
  tileLayer: vi.fn(() => tileLayer),
  icon: vi.fn(() => ({})),
  marker: vi.fn(() => marker),
};

vi.mock("leaflet", () => ({ default: L, ...L }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

describe("LocationMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dragendHandler = null;
  });

  it("mounts a leaflet map with a draggable marker and exposes the aria label", async () => {
    // Arrange / Act
    renderWithProviders(
      <LocationMap latitude={37.4} longitude={-122.1} onMove={vi.fn()} />,
    );

    // Assert: the accessible container is present immediately.
    expect(
      screen.getByRole("application", {
        name: /Map showing detected location/i,
      }),
    ).toBeInTheDocument();

    // The async import + map setup runs after mount.
    await waitFor(() => expect(L.map).toHaveBeenCalledTimes(1));
    expect(L.marker).toHaveBeenCalledWith(
      [37.4, -122.1],
      expect.objectContaining({ draggable: true }),
    );
    expect(map.setView).toHaveBeenCalledWith([37.4, -122.1], 16);
  });

  it("calls onMove with the marker position on dragend", async () => {
    // Arrange
    const onMove = vi.fn();
    renderWithProviders(
      <LocationMap latitude={37.4} longitude={-122.1} onMove={onMove} />,
    );
    await waitFor(() => expect(dragendHandler).not.toBeNull());

    // Act: simulate the user dragging the pin.
    dragendHandler?.();

    // Assert
    expect(onMove).toHaveBeenCalledWith(markerLatLng.lat, markerLatLng.lng);
  });

  it("repositions the marker when coordinates change", async () => {
    // Arrange
    const { rerender } = renderWithProviders(
      <LocationMap latitude={37.4} longitude={-122.1} onMove={vi.fn()} />,
    );
    await waitFor(() => expect(L.map).toHaveBeenCalled());

    // Act
    rerender(<LocationMap latitude={40} longitude={-74} onMove={vi.fn()} />);

    // Assert
    expect(marker.setLatLng).toHaveBeenCalledWith([40, -74]);
  });

  it("removes the map on unmount", async () => {
    // Arrange
    const { unmount } = renderWithProviders(
      <LocationMap latitude={37.4} longitude={-122.1} onMove={vi.fn()} />,
    );
    await waitFor(() => expect(L.map).toHaveBeenCalled());

    // Act
    unmount();

    // Assert
    expect(map.remove).toHaveBeenCalled();
  });
});
