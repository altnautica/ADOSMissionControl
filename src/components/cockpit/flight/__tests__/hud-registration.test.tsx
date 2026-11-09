/**
 * @license GPL-3.0-only
 *
 * The centre marks and the attitude instruments sit on the main picture's
 * centre (the camera's optical axis), where the detection boxes and the AR
 * route are painted, not on the centre zone between the top bar and the
 * bottom row. Checked for the Pilot, Split and Vision views at two sizes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { HudLayer } from "@/components/cockpit/HudLayer";
import { FlightGridContext } from "../flight-context";
import { flightGrid, type FlightGrid } from "../flight-grid";
import { useCockpitLayersStore, type LayerLevel } from "@/stores/cockpit-layers-store";
import { useCockpitViewStore, type CockpitViewId } from "@/lib/cockpit/views";

const DRONE = "hud-reg";

function px(v: string): number {
  return Number.parseFloat(v);
}

/** The screen centre of the boresight box (HUD layer origin plus its offset). */
function boresightCentre(grid: FlightGrid, view: CockpitViewId, level: LayerLevel): [number, number] {
  useCockpitViewStore.getState().setView(DRONE, view);
  useCockpitLayersStore.getState().setLevel(DRONE, level);
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <HudLayer droneId={DRONE} />
    </FlightGridContext.Provider>,
  );
  const layer = screen.getByTestId("hud-layer");
  const box = screen.getByTestId("hud-picture-centre");
  if (level === "instruments") expect(box.querySelector("[data-testid='hud-attitude']")).not.toBeNull();
  else expect(box.querySelector("[data-testid='centre-marks']")).not.toBeNull();
  const x = px(layer.style.left) + px(box.style.left) + px(box.style.width) / 2;
  const y = px(layer.style.top) + px(box.style.top) + px(box.style.height) / 2;
  return [x, y];
}

afterEach(() => {
  cleanup();
  useCockpitViewStore.setState({ byDrone: {} });
});

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

describe("HUD registration with the video", () => {
  for (const size of SIZES) {
    for (const level of ["full", "instruments"] as const) {
      it(`Pilot view ${size.width}x${size.height} (${level}): the video centre`, () => {
        const grid = flightGrid({ ...size, widthClass: "expanded" });
        expect(boresightCentre(grid, "pilot", level)).toEqual([size.width / 2, size.height / 2]);
      });

      it(`Split view ${size.width}x${size.height} (${level}): the video pane's centre`, () => {
        const grid = flightGrid({ ...size, widthClass: "expanded" });
        expect(boresightCentre(grid, "split", level)).toEqual([size.width / 4, size.height / 2]);
      });

      it(`Vision view ${size.width}x${size.height} (${level}): the centre left of the side panel`, () => {
        const grid = flightGrid({ ...size, widthClass: "expanded", sidePanelWidth: 340 });
        const panel = grid.zones.side_panel;
        expect(panel).toBeDefined();
        expect(boresightCentre(grid, "vision", level)).toEqual([panel!.x / 2, size.height / 2]);
      });
    }
  }
});
