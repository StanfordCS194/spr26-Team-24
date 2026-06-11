import { beforeEach, describe, expect, it } from "vitest";

import { LOCALE_STORAGE_KEY } from "@/i18n/messages";
import { renderWithProviders, screen } from "@/test";

import CommunityMapPanel from "./community-map-panel";

describe("CommunityMapPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("localizes the empty map state", () => {
    // Arrange
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");

    // Act
    renderWithProviders(<CommunityMapPanel initialPoints={[]} />);

    // Assert
    expect(screen.getByText("还没有社区问题。")).toBeInTheDocument();
    expect(
      screen.getByText(/带有位置的已报告问题会以图钉显示在这里/),
    ).toBeInTheDocument();
  });
});
