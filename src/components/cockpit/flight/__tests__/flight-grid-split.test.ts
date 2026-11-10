/**
 * @license GPL-3.0-only
 *
 * The Split view's divider (`views.json` split `divider`): default 0.5,
 * clamped to 0.3–0.7 however it is moved, with the video and the map
 * sharing the picture slot at the ratio; in portrait the slot is the video
 * zone, so the map never leaves it.
 */

import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import viewsSpec from "@/lib/cockpit-spec/views.json";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { FlightGridContext } from "../flight-context";
import { SplitContext, SplitDivider, mapPlacement } from "../FlightFrame";
import {
  SPLIT_DIVIDER,
  clampSplit,
  flightGrid,
  rectInside,
  rectsIntersect,
  splitDividerRect,
  splitFromPointer,
  splitMapRect,
  videoRect,
  type FlightGrid,
} from "../flight-grid";

function gridAt(w: number, h: number, splitRatio?: number, following = false): FlightGrid {
  return flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false), splitRatio, following });
}

describe("split divider limits", () => {
  it("reads the spec's default and limits", () => {
    const d = viewsSpec.views.find((v) => v.id === "split") as { divider: { default: number; min: number; max: number } };
    expect(SPLIT_DIVIDER).toEqual({ default: d.divider.default, min: d.divider.min, max: d.divider.max });
    expect(SPLIT_DIVIDER).toEqual({ default: 0.5, min: 0.3, max: 0.7 });
  });

  it("clamps a ratio to 0.3–0.7 and defaults a missing one to 0.5", () => {
    expect(clampSplit(undefined)).toBe(0.5);
    expect(clampSplit(null)).toBe(0.5);
    expect(clampSplit(Number.NaN)).toBe(0.5);
    expect(clampSplit(0.1)).toBe(0.3);
    expect(clampSplit(0.95)).toBe(0.7);
    expect(clampSplit(0.42)).toBe(0.42);
  });

  it("clamps the grid's split and the pointer's ratio", () => {
    expect(gridAt(1280, 800).split).toBe(0.5);
    expect(gridAt(1280, 800, 0.9).split).toBe(0.7);
    expect(gridAt(1280, 800, 0.05).split).toBe(0.3);
    const g = gridAt(1280, 800);
    expect(splitFromPointer(0, g)).toBe(0.3);
    expect(splitFromPointer(1280, g)).toBe(0.7);
    expect(splitFromPointer(512, g)).toBeCloseTo(0.4, 5);
  });
});

describe("split panes", () => {
  for (const [w, h] of [[580, 360], [760, 480], [1280, 800], [1920, 1080]] as const) {
    it(`shares the screen at the ratio, video left and map right, at ${w}x${h}`, () => {
      for (const ratio of [0.3, 0.5, 0.7]) {
        const g = gridAt(w, h, ratio);
        const video = videoRect("split", g);
        const map = splitMapRect(g);
        expect(video.w).toBe(Math.round(w * ratio));
        expect(map.x).toBe(video.x + video.w);
        expect(map.x + map.w).toBe(w);
        expect(map.h).toBe(h);
        expect(mapPlacement(false, g)).toEqual({ left: map.x, top: map.y, width: map.w, height: map.h });
      }
    });

    it(`keeps the divider handle clear of the top bar, strip and bottom zones at ${w}x${h}`, () => {
      const g = gridAt(w, h, 0.5, true);
      const d = splitDividerRect(g);
      expect(d.w).toBeGreaterThanOrEqual(48);
      for (const id of ["top_bar", "follow_strip", "bottom_row", "bottom_left_card", "bottom_right"] as const) {
        const z = g.zones[id];
        if (z) expect(rectsIntersect(d, z), id).toBe(false);
      }
      expect(rectsIntersect(d, g.stop)).toBe(false);
    });
  }

  it("keeps the portrait map inside the video zone", () => {
    for (const ratio of [0.3, 0.5, 0.7]) {
      const g = gridAt(412, 915, ratio);
      const slot = g.zones.video!;
      const video = videoRect("split", g);
      const map = splitMapRect(g);
      expect(rectInside(video, slot)).toBe(true);
      expect(rectInside(map, slot)).toBe(true);
      expect(video.w + map.w).toBe(slot.w);
      expect(rectInside(splitDividerRect(g), { x: slot.x - 24, y: slot.y, w: slot.w + 48, h: slot.h })).toBe(true);
      for (const id of ["top_bar", "left_column", "bottom_right", "bottom_row", "bottom_left_card"] as const) {
        expect(rectsIntersect(map, g.zones[id]!), id).toBe(false);
      }
    }
  });
});

describe("split divider handle", () => {
  afterEach(cleanup);

  function mount(ratio: number, set: (r: number) => void) {
    const grid = gridAt(1280, 800, ratio);
    const wrap = (children: ReactNode) =>
      createElement(
        FlightGridContext.Provider,
        { value: grid },
        createElement(SplitContext.Provider, { value: { ratio: grid.split, setRatio: set } }, children),
      );
    return render(wrap(createElement(SplitDivider)));
  }

  it("is a labelled separator at the boundary, reporting the ratio and its limits", () => {
    mount(0.5, () => {});
    const sep = screen.getByRole("separator");
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
    expect(sep.getAttribute("aria-valuemin")).toBe("30");
    expect(sep.getAttribute("aria-valuemax")).toBe("70");
    const left = parseFloat(sep.style.left);
    const width = parseFloat(sep.style.width);
    expect(left + width / 2).toBeCloseTo(640, 0);
  });

  it("moves with the arrow keys and never past the limits", () => {
    const seen: number[] = [];
    mount(0.7, (r) => seen.push(r));
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "End" });
    fireEvent.keyDown(sep, { key: "Home" });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(seen.slice(0, 3)).toEqual([0.7, 0.7, 0.3]);
    expect(seen[3]).toBeCloseTo(0.65, 5);
  });
});
