/**
 * The cockpit views read the shared `views.json`: the Map view puts the video
 * in the bottom-left card, and Split carries its draggable divider.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";
import { viewDef } from "@/lib/cockpit/views";

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
