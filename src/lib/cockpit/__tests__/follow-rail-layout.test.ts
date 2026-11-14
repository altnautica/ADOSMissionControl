import { describe, expect, it } from "vitest";

import { specString } from "@/lib/cockpit/spec-strings";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import {
  followRailLayout,
  followRailWidth,
  RANGE_MIN_PX,
  type FollowRailInput,
} from "@/lib/cockpit/follow-rail-layout";

/** The fullest rail: tracking, all three settings, a camera swap and REC. */
function rail(stripW: number | null): FollowRailInput {
  return {
    stripW,
    buttons: [
      { id: "follow", word: specString("follow.tracking_close") },
      { id: "camSwap", word: specString("follow.cam_swap", { from: specString("hud.leg.eo"), to: specString("hud.leg.belly") }) },
      { id: "rec", word: specString("follow.rec") },
    ],
    settings: ["reacquire_mode", "uncertain_mode", "predictive_search"],
    predictiveWord: specString("follow.setting.predictive_search"),
    moreWord: specString("follow.more"),
  };
}

describe("followRailLayout", () => {
  it("keeps everything on the row where the rail has room, or no strip width", () => {
    expect(followRailLayout(rail(null))).toEqual({ foldSettings: false, iconOnly: false });
    expect(followRailLayout(rail(1200))).toEqual({ foldSettings: false, iconOnly: false });
  });

  it("fits a portrait phone's strip with REC and the range readout on the row", () => {
    for (const width of [360, 390, 412, 430]) {
      const strip = flightGrid({ width, height: 844, widthClass: "compact", following: true }).zones.follow_strip;
      expect(strip).toBeTruthy();
      const input = rail(strip!.w);
      const layout = followRailLayout(input);
      // The settings give way first; FOLLOW, the swap and REC are never folded.
      expect(layout.foldSettings).toBe(true);
      expect(input.buttons.map((b) => b.id)).toContain("rec");
      // Rail plus the readout's least width plus the dock's gap and padding fit the strip.
      expect(followRailWidth(input, layout) + RANGE_MIN_PX + 16).toBeLessThanOrEqual(strip!.w);
    }
  });

  it("folds the settings before it drops the words", () => {
    const input = rail(700);
    expect(followRailLayout(input)).toEqual({ foldSettings: true, iconOnly: false });
    expect(followRailWidth(input, { foldSettings: false, iconOnly: false })).toBeGreaterThan(
      followRailWidth(input, { foldSettings: true, iconOnly: false }),
    );
  });

  it("counts no More button without settings to fold", () => {
    const input = { ...rail(300), settings: [] };
    expect(followRailWidth(input, { foldSettings: true, iconOnly: true })).toBe(3 * 48 + 2 * 6);
  });
});
