/**
 * @module cockpit/flight/flight-layout.test
 * @description The flight screen's layout check, at every width class:
 *   - no two zones intersect, and every zone lies inside the viewport;
 *   - STOP is fully inside the viewport and inside the top bar;
 *   - the rendered zones sit exactly where the grid puts them;
 *   - no legacy chrome (status band, telemetry strip, flight-action rail,
 *     hint bar) is rendered;
 *   - the flight instruments render only at the Instruments level, the
 *     centre marks at the others.
 *
 * @license GPL-3.0-only
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { useCockpitLayersStore, LAYER_LEVELS } from "@/stores/cockpit-layers-store";
import { HudLayer } from "@/components/cockpit/HudLayer";
import { LeftColumn } from "@/components/cockpit/v2/LeftColumn";
import { FlightTopBar } from "../FlightTopBar";
import { RightColumn } from "../RightColumn";
import { BottomRow } from "../BottomRow";
import { FlightGridContext } from "../flight-context";
import { flightGrid, rectInside, rectsIntersect, type FlightGrid, type Rect } from "../flight-grid";

const SIZES: readonly { w: number; h: number; cls: string }[] = [
  { w: 1920, h: 1080, cls: "tv" },
  { w: 1280, h: 800, cls: "expanded" },
  { w: 900, h: 600, cls: "expanded" },
  { w: 760, h: 480, cls: "medium" },
  { w: 580, h: 360, cls: "compact" },
  { w: 412, h: 915, cls: "portrait" },
  { w: 915, h: 412, cls: "expanded" },
];

function gridAt(w: number, h: number, extra: { following?: boolean; sidePanelWidth?: number } = {}): FlightGrid {
  return flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false), ...extra });
}

/** The zones that must not share any area (the portrait centre is the video). */
function exclusiveZones(g: FlightGrid): [string, Rect][] {
  return Object.entries(g.zones).filter(([id]) => !(g.cls === "portrait" && id === "video")) as [string, Rect][];
}

function checkGrid(g: FlightGrid): void {
  const viewport = { x: 0, y: 0, w: g.width, h: g.height };
  const zones = exclusiveZones(g);
  for (const [id, r] of zones) {
    expect(r.w, `${id} width`).toBeGreaterThan(0);
    expect(r.h, `${id} height`).toBeGreaterThan(0);
    expect(rectInside(r, viewport), `${id} inside the viewport`).toBe(true);
  }
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const [a, ra] = zones[i];
      const [b, rb] = zones[j];
      expect(rectsIntersect(ra, rb), `${a} overlaps ${b} at ${g.width}x${g.height}`).toBe(false);
    }
  }
  expect(rectInside(g.stop, viewport), "STOP inside the viewport").toBe(true);
  expect(rectInside(g.stop, g.zones.top_bar!), "STOP inside the top bar").toBe(true);
}

describe("flight screen grid", () => {
  for (const s of SIZES) {
    it(`places every zone without overlap at ${s.w}x${s.h} (${s.cls})`, () => {
      const g = gridAt(s.w, s.h);
      expect(g.cls).toBe(s.cls);
      checkGrid(g);
    });
    it(`keeps the follow dock clear of every zone at ${s.w}x${s.h}`, () => {
      const g = gridAt(s.w, s.h, { following: true });
      expect(g.zones.follow_dock).toBeDefined();
      checkGrid(g);
    });
  }

  it("keeps the Vision side panel clear of the right column", () => {
    checkGrid(gridAt(1280, 800, { sidePanelWidth: 340 }));
  });

  it("scales the chrome by 1.33 at tv and uses 56 px targets on wide classes", () => {
    expect(gridAt(1920, 1080).scale).toBe(1.33);
    expect(gridAt(1280, 800).target).toBe(56);
    expect(gridAt(580, 360).target).toBe(48);
  });

  it("stacks the portrait screen: top bar, video, left column row, skills, bottom row, map", () => {
    const z = gridAt(412, 915).zones;
    const order = [z.top_bar!, z.video!, z.left_column!, z.bottom_right!, z.bottom_row!, z.bottom_left_card!];
    for (let i = 1; i < order.length; i++) expect(order[i].y).toBeGreaterThan(order[i - 1].y);
    expect(z.right_column).toBeUndefined();
  });

  it("leaves the side columns room for their controls on short landscape screens", () => {
    for (const [w, h] of [[1920, 1080], [1280, 800], [900, 600], [760, 480], [915, 412]] as const) {
      for (const following of [false, true]) {
        const g = gridAt(w, h, { following });
        expect(g.zones.left_column!.h, `left column at ${w}x${h}`).toBeGreaterThanOrEqual(224 * g.scale - 1);
        expect(g.zones.right_column!.h, `right column at ${w}x${h}`).toBeGreaterThanOrEqual(224 * g.scale - 1);
      }
    }
    // The card keeps its shape when it shrinks.
    const card = gridAt(915, 412).zones.bottom_left_card!;
    expect(card.w / card.h).toBeCloseTo(280 / 180, 1);
  });
});

/** Legacy flight-screen chrome the grid replaced. */
const LEGACY_TESTIDS = [
  "cockpit-node-name",
  "cockpit-reach",
  "cockpit-arm",
  "cockpit-mode",
  "cockpit-battery",
  "cockpit-link",
  "telemetry-strip",
  "frail-skill-pause",
  "frail-skill-rth",
  "frail-skill-land",
  "skill-bar",
];

function renderChrome(g: FlightGrid, droneId = "layout-test") {
  return renderWithIntl(
    <FlightGridContext.Provider value={g}>
      <div className="ados-cockpit">
        <FlightTopBar droneId={droneId} />
        <LeftColumn droneId={droneId} />
        <RightColumn droneId={droneId} />
        <BottomRow droneId={droneId} />
        <HudLayer droneId={droneId} />
      </div>
    </FlightGridContext.Provider>,
  );
}

function styleRect(el: Element): Rect {
  const s = (el as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
}

describe("flight screen chrome", () => {
  afterEach(cleanup);

  for (const s of SIZES) {
    it(`renders each zone at its grid rectangle, with STOP and no legacy chrome, at ${s.w}x${s.h}`, () => {
      const g = gridAt(s.w, s.h);
      const { container } = renderChrome(g);
      for (const el of container.querySelectorAll("[data-zone]")) {
        const id = el.getAttribute("data-zone") as keyof FlightGrid["zones"];
        if (id === "center") continue;
        expect(styleRect(el), id).toEqual(g.zones[id]);
      }
      expect(container.querySelector("[data-zone='top_bar']")).not.toBeNull();
      expect(container.querySelector("[data-zone='left_column']")).not.toBeNull();
      expect(container.querySelector("[data-zone='bottom_row']")).not.toBeNull();
      expect(!!container.querySelector("[data-zone='right_column']")).toBe(g.cls !== "portrait");
      const stop = screen.getByTestId("cockpit-kill");
      expect(stop.textContent).toContain("STOP");
      expect(parseFloat(stop.style.width)).toBe(g.stop.w);
      for (const id of LEGACY_TESTIDS) expect(screen.queryByTestId(id), id).toBeNull();
      expect(container.querySelector(".safety, .telem, .skillbar")).toBeNull();
    });
  }

  for (const level of LAYER_LEVELS) {
    it(`draws the flight instruments only at Instruments (level ${level})`, () => {
      useCockpitLayersStore.getState().setLevel("layout-test", level);
      renderChrome(gridAt(1280, 800));
      const instruments = level === "instruments";
      expect(!!screen.queryByTestId("hud-instruments")).toBe(instruments);
      expect(!!screen.queryByTestId("hud-attitude")).toBe(instruments);
      expect(!!screen.queryByTestId("speed-tape")).toBe(instruments);
      expect(!!screen.queryByTestId("centre-marks")).toBe(!instruments);
    });
  }
});
