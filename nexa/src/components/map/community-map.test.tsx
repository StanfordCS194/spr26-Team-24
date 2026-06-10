import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCALE_STORAGE_KEY } from "@/i18n/messages";
import { renderWithProviders, screen, waitFor } from "@/test";

import CommunityMap, { type IssueMapPoint } from "./community-map";

const popupContent: HTMLElement[] = [];

const marker = {
  addTo: vi.fn(() => marker),
  bindPopup: vi.fn((content: HTMLElement) => {
    popupContent.push(content);
    return marker;
  }),
};

const map = {
  closePopup: vi.fn(),
  remove: vi.fn(),
  setView: vi.fn(() => map),
  fitBounds: vi.fn(() => map),
};

const tileLayer = { addTo: vi.fn(() => tileLayer) };

const L = {
  map: vi.fn(() => map),
  tileLayer: vi.fn(() => tileLayer),
  divIcon: vi.fn((opts: { html: string }) => opts),
  marker: vi.fn(() => marker),
};

vi.mock("leaflet", () => ({ default: L, ...L }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

function makePoint(overrides: Partial<IssueMapPoint> = {}): IssueMapPoint {
  return {
    id: "group_1",
    latitude: 37.4,
    longitude: -122.1,
    issueType: "ROAD_DAMAGE",
    issueLabel: "Road Damage",
    status: "CONFIRMED",
    reportCount: 2,
    createdAt: "2025-01-01T00:00:00.000Z",
    relativeTime: "Jan 1, 2025",
    order: 1,
    myReportId: "report_1",
    ...overrides,
  };
}

describe("CommunityMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popupContent.length = 0;
    window.localStorage.clear();
  });

  it("localizes popup labels and actions", async () => {
    // Arrange
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "es");

    // Act
    renderWithProviders(
      <CommunityMap points={[makePoint()]} onResolve={vi.fn()} />,
    );

    // Assert
    await waitFor(() => expect(popupContent).toHaveLength(1));
    expect(popupContent[0]).toHaveTextContent("Daño vial");
    expect(popupContent[0]).toHaveTextContent("Confirmado");
    expect(popupContent[0]).toHaveTextContent("2 reportes");
    expect(popupContent[0]).toHaveTextContent("Reportado por primera vez");
    expect(
      screen.getByRole("img", {
        name: "Mapa con 1 problema de la comunidad",
      }),
    ).toBeInTheDocument();
    expect(
      popupContent[0].querySelector(".nexa-map-popup__resolve"),
    ).toHaveTextContent("Marcar como resuelto");
  });

  it("keeps resolved popup notes translated through status labels", async () => {
    // Arrange
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

    // Act
    renderWithProviders(
      <CommunityMap
        points={[
          makePoint({
            status: "RESOLVED",
            myReportId: null,
            reportCount: 1,
          }),
        ]}
        onResolve={vi.fn()}
      />,
    );

    // Assert
    await waitFor(() => expect(popupContent).toHaveLength(1));
    expect(popupContent[0]).toHaveTextContent("1 signalement");
    expect(popupContent[0]).toHaveTextContent("Résolu");
  });
});
