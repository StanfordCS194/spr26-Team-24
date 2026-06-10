import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test";

import { ReportsMap, type ReportMapPoint } from "./reports-map";

// ---------------------------------------------------------------------------
// Leaflet double. Captures divIcon options (for marker color), bindPopup HTML
// (to assert escaping) and setView/fitBounds calls (single vs multi point).
// ---------------------------------------------------------------------------
const divIconCalls: Array<{ html: string }> = [];
const popupHtml: string[] = [];

const marker = {
  addTo: vi.fn(() => marker),
  bindPopup: vi.fn((html: string) => {
    popupHtml.push(html);
    return marker;
  }),
  on: vi.fn(() => marker),
  openPopup: vi.fn(() => marker),
  closePopup: vi.fn(() => marker),
};

const map = {
  remove: vi.fn(),
  setView: vi.fn(() => map),
  fitBounds: vi.fn(() => map),
};

const tileLayer = { addTo: vi.fn(() => tileLayer) };

const L = {
  map: vi.fn(() => map),
  tileLayer: vi.fn(() => tileLayer),
  divIcon: vi.fn((opts: { html: string }) => {
    divIconCalls.push(opts);
    return opts;
  }),
  marker: vi.fn(() => marker),
};

vi.mock("leaflet", () => ({ default: L, ...L }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

function makePoint(overrides: Partial<ReportMapPoint> = {}): ReportMapPoint {
  return {
    id: "p1",
    latitude: 37.4,
    longitude: -122.1,
    issueType: "ROAD_DAMAGE",
    shortLocation: "Palo Alto, CA",
    status: "CONFIRMED",
    relativeTime: "2 days ago",
    order: 1,
    ...overrides,
  };
}

describe("ReportsMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    divIconCalls.length = 0;
    popupHtml.length = 0;
  });

  it("renders nothing when there are no points", () => {
    // Arrange / Act
    const { container } = renderWithProviders(<ReportsMap points={[]} />);

    // Assert
    expect(container).toBeEmptyDOMElement();
    expect(L.map).not.toHaveBeenCalled();
  });

  it("renders the map shell with a pin count for a single point", async () => {
    // Arrange / Act
    renderWithProviders(<ReportsMap points={[makePoint()]} />);

    // Assert: header + count copy ("1 pin").
    expect(screen.getByText("Report locations")).toBeInTheDocument();
    expect(screen.getByText(/1\s+pin/)).toBeInTheDocument();
    await waitFor(() => expect(L.map).toHaveBeenCalledTimes(1));
  });

  it("uses setView for a single point and fitBounds for many", async () => {
    // Arrange / Act: single point.
    const { rerender } = renderWithProviders(
      <ReportsMap points={[makePoint()]} />,
    );
    await waitFor(() => expect(map.setView).toHaveBeenCalled());
    expect(map.fitBounds).not.toHaveBeenCalled();

    // Act: two points -> fitBounds.
    rerender(
      <ReportsMap
        points={[makePoint(), makePoint({ id: "p2", latitude: 40 })]}
      />,
    );

    // Assert
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
  });

  it("colors confirmed vs pending markers differently", async () => {
    // Arrange / Act
    renderWithProviders(
      <ReportsMap
        points={[
          makePoint({ id: "c", status: "CONFIRMED" }),
          makePoint({ id: "d", status: "DRAFT" }),
        ]}
      />,
    );

    // Assert: confirmed green (#22c55e), pending purple (#9b87f5).
    await waitFor(() => expect(divIconCalls.length).toBe(2));
    expect(divIconCalls[0].html).toContain("#22c55e");
    expect(divIconCalls[1].html).toContain("#9b87f5");
  });

  it("renders each pin's filing-order number", async () => {
    // Arrange / Act
    renderWithProviders(
      <ReportsMap
        points={[
          makePoint({ id: "a", order: 2 }),
          makePoint({ id: "b", order: 1 }),
        ]}
      />,
    );

    // Assert: the order is drawn into the pin glyph as an SVG <text> label.
    await waitFor(() => expect(divIconCalls.length).toBe(2));
    expect(divIconCalls[0].html).toContain(">2</text>");
    expect(divIconCalls[1].html).toContain(">1</text>");
  });

  it("opens a pin's popup on hover and closes it on mouse-out", async () => {
    // Arrange / Act
    renderWithProviders(<ReportsMap points={[makePoint({ id: "h" })]} />);

    // Assert: hover handlers are wired so pins preview without a click.
    await waitFor(() =>
      expect(marker.on).toHaveBeenCalledWith("mouseover", expect.any(Function)),
    );
    expect(marker.on).toHaveBeenCalledWith("mouseout", expect.any(Function));

    // Invoke the registered handlers to confirm they open/close the popup.
    const calls = marker.on.mock.calls as unknown as [string, () => void][];
    calls.find(([evt]) => evt === "mouseover")?.[1]();
    calls.find(([evt]) => evt === "mouseout")?.[1]();
    expect(marker.openPopup).toHaveBeenCalled();
    expect(marker.closePopup).toHaveBeenCalled();
  });

  it("escapes HTML in popup content", async () => {
    // Arrange / Act
    renderWithProviders(
      <ReportsMap
        points={[
          makePoint({ shortLocation: '<img src=x onerror="alert(1)">' }),
        ]}
      />,
    );

    // Assert: angle brackets/quotes are entity-escaped, not raw.
    await waitFor(() => expect(popupHtml.length).toBe(1));
    expect(popupHtml[0]).toContain("&lt;img");
    expect(popupHtml[0]).not.toContain("<img src=x");
  });

  it("removes the map on unmount", async () => {
    // Arrange
    const { unmount } = renderWithProviders(
      <ReportsMap points={[makePoint()]} />,
    );
    await waitFor(() => expect(L.map).toHaveBeenCalled());

    // Act
    unmount();

    // Assert
    expect(map.remove).toHaveBeenCalled();
  });
});
