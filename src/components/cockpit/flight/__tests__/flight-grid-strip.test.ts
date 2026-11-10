/**
 * @license GPL-3.0-only
 *
 * The follow strip (cockpit spec `layout.json` zone `follow_strip`): directly
 * under the top bar, spanning between the left and right columns, clear of
 * every other zone at every size; the flow overlays stack under it; portrait
 * stacks the strip under the top bar and the Vision panel under the video.
 */

import { describe, expect, it } from "vitest";

import { widthClassFor } from "@/lib/cockpit/width-class";
import {
  COLUMN_MIN_H,
  centreHeadingTop,
  flightGrid,
  flowColumn,
  rectInside,
  rectsIntersect,
  videoRect,
  type FlightGrid,
  type Rect,
} from "../flight-grid";

const SIZES = [
  [580, 360],
  [760, 480],
  [1280, 800],
  [1920, 1080],
  [412, 915],
] as const;

function gridAt(w: number, h: number, extra: { following?: boolean; sidePanelWidth?: number } = {}): FlightGrid {
  return flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false), ...extra });
}

const bottom = (r: Rect) => r.y + r.h;
const right = (r: Rect) => r.x + r.w;

/** Every pair of zones shares no area (the portrait centre is the video). */
function expectNoOverlap(g: FlightGrid): void {
  const zones = Object.entries(g.zones).filter(([id]) => !(g.cls === "portrait" && id === "video")) as [string, Rect][];
  const viewport = { x: 0, y: 0, w: g.width, h: g.height };
  for (const [id, r] of zones) {
    expect(r.w, `${id} width`).toBeGreaterThan(0);
    expect(r.h, `${id} height`).toBeGreaterThan(0);
    expect(rectInside(r, viewport), `${id} inside ${g.width}x${g.height}`).toBe(true);
  }
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      expect(rectsIntersect(zones[i][1], zones[j][1]), `${zones[i][0]} overlaps ${zones[j][0]} at ${g.width}x${g.height}`).toBe(
        false,
      );
    }
  }
}

describe("follow strip", () => {
  for (const [w, h] of SIZES) {
    it(`sits under the top bar, between the columns, clear of every zone at ${w}x${h}`, () => {
      const g = gridAt(w, h, { following: true });
      const z = g.zones;
      const strip = z.follow_strip!;
      expect(strip).toBeDefined();
      expect(z).not.toHaveProperty("follow_dock");
      // Directly under the top bar: nothing between them.
      expect(strip.y).toBeGreaterThanOrEqual(bottom(z.top_bar!));
      expect(strip.y - bottom(z.top_bar!)).toBeLessThanOrEqual(8 * g.scale + 1);
      expect(strip.y).toBeLessThan(z.center!.y);
      if (g.cls === "portrait") {
        expect(bottom(strip)).toBeLessThanOrEqual(z.video!.y);
      } else {
        // Spanning between the left and right columns.
        expect(strip.x).toBeGreaterThanOrEqual(right(z.left_column!));
        expect(right(strip)).toBeLessThanOrEqual(z.right_column!.x);
        expect(strip.x - right(z.left_column!)).toBeLessThanOrEqual(8 * g.scale + 1);
        expect(z.right_column!.x - right(strip)).toBeLessThanOrEqual(8 * g.scale + 1);
      }
      // Its controls get the 48 px touch target.
      expect(strip.h).toBeGreaterThanOrEqual(48);
      expectNoOverlap(g);
    });

    it(`is absent outside following mode and the grid has no overlap at ${w}x${h}`, () => {
      const g = gridAt(w, h);
      expect(g.zones.follow_strip).toBeUndefined();
      expectNoOverlap(g);
    });

    it(`stays clear of the Vision panel at ${w}x${h}`, () => {
      const g = gridAt(w, h, { following: true, sidePanelWidth: Math.round(Math.min(340, w * 0.4)) });
      expect(g.zones.side_panel).toBeDefined();
      expectNoOverlap(g);
    });

    it(`stacks the flow overlays under the strip, between the columns, at ${w}x${h}`, () => {
      const g = gridAt(w, h, { following: true });
      const col = flowColumn(g);
      expect(col.y).toBeGreaterThanOrEqual(bottom(g.zones.follow_strip!));
      expect(col.x).toBeGreaterThanOrEqual(g.zones.follow_strip!.x);
      expect(right(col)).toBeLessThanOrEqual(right(g.zones.follow_strip!));
      if (g.zones.left_column && g.cls !== "portrait") expect(col.x).toBeGreaterThanOrEqual(right(g.zones.left_column));
      if (g.zones.right_column) expect(right(col)).toBeLessThanOrEqual(g.zones.right_column.x);
      // Without the strip the column starts under the top bar.
      const plain = gridAt(w, h);
      expect(flowColumn(plain).y).toBeGreaterThanOrEqual(bottom(plain.zones.top_bar!));
      expect(flowColumn(plain).y).toBeLessThan(col.y);
    });

    it(`keeps the heading readout under the strip at ${w}x${h}`, () => {
      const g = gridAt(w, h, { following: true });
      const pic = videoRect("pilot", g);
      expect(pic.y + centreHeadingTop(pic, g)).toBeGreaterThanOrEqual(bottom(g.zones.follow_strip!));
    });
  }

  it("leaves the side columns their full height whether or not the strip is up", () => {
    for (const [w, h] of [[1920, 1080], [1280, 800], [900, 600], [760, 480], [915, 412]] as const) {
      for (const following of [false, true]) {
        const g = gridAt(w, h, { following });
        expect(g.zones.left_column!.h, `left at ${w}x${h}`).toBeGreaterThanOrEqual(COLUMN_MIN_H * g.scale - 1);
        expect(g.zones.right_column!.h, `right at ${w}x${h}`).toBeGreaterThanOrEqual(COLUMN_MIN_H * g.scale - 1);
      }
    }
  });

  it("leaves the bottom zones where they are when the strip opens", () => {
    const off = gridAt(1280, 800).zones;
    const on = gridAt(1280, 800, { following: true }).zones;
    expect(on.bottom_row).toEqual(off.bottom_row);
    expect(on.bottom_left_card).toEqual(off.bottom_left_card);
    expect(on.bottom_right).toEqual(off.bottom_right);
  });
});

describe("portrait Vision", () => {
  it("stacks the Vision panel under the video, above the left column's row", () => {
    const g = gridAt(412, 915, { sidePanelWidth: 165 });
    const z = g.zones;
    expect(z.side_panel).toBeDefined();
    expect(z.side_panel!.y).toBeGreaterThanOrEqual(bottom(z.video!));
    expect(bottom(z.side_panel!)).toBeLessThanOrEqual(z.left_column!.y);
    expect(z.side_panel!.w).toBeGreaterThan(g.width / 2);
    expectNoOverlap(g);
    // The picture stays the whole video zone.
    expect(videoRect("vision", g)).toEqual(z.video);
  });
});
