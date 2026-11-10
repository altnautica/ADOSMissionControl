/**
 * @license GPL-3.0-only
 *
 * The bottom-left card's faces: switched by swipe and page dots (no arrows),
 * each radar face titled inside the card from the shared strings (the map
 * face draws its own header instead), and the map's
 * own controls (frame toggle, zoom, scale) present on the map face only.
 * In the Map view the card slot holds the video, which carries none of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

vi.mock("next/dynamic", () => ({
  default: () =>
    function OverviewMapStub() {
      return <div data-testid="overview-map" />;
    },
}));

import { specString } from "@/lib/cockpit/spec-strings";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { BottomLeftCard, CARD_FACES } from "../BottomLeftCard";
import { FlightGridContext } from "../flight-context";
import { FlightVideoFrame } from "../FlightFrame";
import { flightGrid } from "../flight-grid";

const DRONE = "node:card-faces-test";

function renderCard(w = 1280, h = 800) {
  const grid = flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false) });
  return render(
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

/** The map's own controls found inside `root`. */
function mapControls(root: HTMLElement) {
  const q = within(root);
  return {
    zoomIn: q.queryByRole("button", { name: messages.hud.map.zoomIn }),
    zoomOut: q.queryByRole("button", { name: messages.hud.map.zoomOut }),
    frameToggle: q.queryByRole("group", { name: messages.hud.map.modeLabel }),
    scale: root.querySelector(".lfmap-scale"),
  };
}

describe("bottom-left card faces", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    // The local frame draws the card's zoom and scale controls.
    useMinimapModeStore.setState({ pinByVehicle: { [DRONE]: "local" } });
  });
  afterEach(cleanup);

  it("follows the spec's card order: map, attitude radar, obstacle radar", () => {
    expect(CARD_FACES).toEqual(["map", "attitude_radar", "obstacle_radar"]);
  });

  it("titles each radar face inside the card from the shared strings, and leaves the map face to its own header", () => {
    renderCard();
    const keys = {
      attitude_radar: "cockpit.card.attitude_radar",
      obstacle_radar: "cockpit.card.obstacle_radar",
    } as const;
    for (const face of CARD_FACES) {
      fireEvent.click(screen.getByTestId(`fs-card-${face}`));
      expect(card().getAttribute("data-face")).toBe(face);
      const title = within(card()).queryByTestId("fs-card-title");
      if (face === "map") {
        expect(title).toBeNull();
        expect(card().getAttribute("aria-label")).toBe(specString("cockpit.card.map"));
      } else {
        expect(title?.textContent).toBe(specString(keys[face]));
      }
    }
  });

  it("switches by page dots and swipe, with no arrow buttons", () => {
    renderCard();
    const tabs = within(card()).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(CARD_FACES.map((f) => specString(`cockpit.card.${f}`)));
    expect(screen.queryByRole("button", { name: specString("cockpit.card.next") })).toBeNull();
    expect(screen.queryByRole("button", { name: specString("cockpit.card.previous") })).toBeNull();

    // A leftward swipe moves to the next face.
    fireEvent.pointerDown(card(), { clientX: 200 });
    fireEvent.pointerUp(card(), { clientX: 100 });
    expect(card().getAttribute("data-face")).toBe("attitude_radar");
  });

  it("shows the map's controls on the map face only", () => {
    renderCard();
    const onMap = mapControls(card());
    expect(onMap.zoomIn).not.toBeNull();
    expect(onMap.zoomOut).not.toBeNull();
    expect(onMap.frameToggle).not.toBeNull();
    expect(onMap.scale).not.toBeNull();

    for (const face of ["attitude_radar", "obstacle_radar"] as const) {
      fireEvent.click(screen.getByTestId(`fs-card-${face}`));
      const c = mapControls(card());
      expect(c.zoomIn, face).toBeNull();
      expect(c.zoomOut, face).toBeNull();
      expect(c.frameToggle, face).toBeNull();
      expect(c.scale, face).toBeNull();
    }
  });

  it("keeps the map's controls off the card slot when it holds the video (Map view)", () => {
    const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FlightGridContext.Provider value={grid}>
          <FlightVideoFrame droneId={DRONE} view="map">
            <div data-testid="video" />
          </FlightVideoFrame>
        </FlightGridContext.Provider>
      </NextIntlClientProvider>,
    );
    const slot = container.querySelector("[data-zone='bottom_left_card']") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.style.width).toBe(`${grid.zones.bottom_left_card!.w}px`);
    const c = mapControls(slot);
    expect([c.zoomIn, c.zoomOut, c.frameToggle, c.scale]).toEqual([null, null, null, null]);
    expect(slot.querySelector("[data-testid='fs-card-title']")).toBeNull();
  });
});
