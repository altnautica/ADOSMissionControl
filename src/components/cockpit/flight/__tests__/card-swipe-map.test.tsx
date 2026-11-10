/**
 * @license GPL-3.0-only
 *
 * Panning the card's map is not a card swipe: a drag that starts inside the
 * map keeps the map face, while a swipe on a radar face still switches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

vi.mock("next/dynamic", () => ({
  default: () =>
    function OverviewMapStub() {
      return <div data-testid="overview-map" />;
    },
}));

import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { BottomLeftCard } from "../BottomLeftCard";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";

const DRONE = "node:card-swipe-map";

function renderCard() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="ados-cockpit">
        <FlightGridContext.Provider value={grid}>
          <BottomLeftCard droneId={DRONE} />
        </FlightGridContext.Provider>
      </div>
    </NextIntlClientProvider>,
  );
}

function card(): HTMLElement {
  return document.querySelector("[data-zone='bottom_left_card']") as HTMLElement;
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  useMinimapModeStore.setState({ pinByVehicle: { [DRONE]: "local" } });
});
afterEach(cleanup);

describe("card swipe over the map", () => {
  it("keeps the map face when a pan longer than a swipe starts inside the map", () => {
    renderCard();
    expect(card().getAttribute("data-face")).toBe("map");
    const canvas = card().querySelector(".lfmap-canvas") as HTMLElement;
    expect(canvas).not.toBeNull();
    fireEvent.pointerDown(canvas, { clientX: 220, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, pointerId: 1 });
    expect(card().getAttribute("data-face")).toBe("map");
  });

  it("still switches on a swipe over a radar face", () => {
    renderCard();
    fireEvent.click(document.querySelector("[data-testid='fs-card-attitude_radar']") as HTMLElement);
    const face = card().querySelector(".fs-card-face") as HTMLElement;
    fireEvent.pointerDown(face, { clientX: 220, pointerId: 1 });
    fireEvent.pointerUp(face, { clientX: 100, pointerId: 1 });
    expect(card().getAttribute("data-face")).toBe("obstacle_radar");
  });
});
