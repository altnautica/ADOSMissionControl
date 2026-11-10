/**
 * The cockpit views read the shared `views.json`: the Map view puts the video
 * in the bottom-left card, and Split carries its draggable divider.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";
import { clampSplit, useCockpitViewStore, viewDef } from "@/lib/cockpit/views";

describe("cockpit views from the spec", () => {
  it("puts the video in the bottom-left card on the Map view", () => {
    expect(viewDef("map")).toMatchObject({ main: "map", secondary: "video_card", divider: null });
  });

  it("gives Split the map beside the video and a draggable divider", () => {
    expect(viewDef("split")).toMatchObject({
      main: "video",
      secondary: "map",
      divider: { draggable: true, default: 0.5, min: 0.3, max: 0.7 },
    });
  });

  it("keeps the pilot view to the video alone", () => {
    expect(viewDef("pilot")).toMatchObject({ main: "video", secondary: null, divider: null });
  });
});

describe("the Split divider per vehicle", () => {
  it("starts at the spec default and keeps each vehicle's own position", () => {
    const s = useCockpitViewStore.getState();
    expect(useCockpitViewStore.getState().splitByDrone["a"]).toBeUndefined();
    s.setSplit("a", 0.62);
    s.setSplit("b", 0.35);
    expect(useCockpitViewStore.getState().splitByDrone).toMatchObject({ a: 0.62, b: 0.35 });
  });

  it("clamps to the spec's range", () => {
    expect(clampSplit(0.1)).toBe(0.3);
    expect(clampSplit(0.9)).toBe(0.7);
    expect(clampSplit(Number.NaN)).toBe(0.5);
    useCockpitViewStore.getState().setSplit("c", 0.95);
    expect(useCockpitViewStore.getState().splitByDrone.c).toBe(0.7);
  });
});
