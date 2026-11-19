/**
 * @module simulation/scene-label.test
 * @description A marker's number tag is built only at an absolute position, so
 * no tag ever passes through ground clamping and draws at a stale clamped point.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { Color, HeightReference } from "cesium";
import { sceneLabel } from "../scene-label";

describe("sceneLabel", () => {
  it("builds the tag at an absolute position", () => {
    const label = sceneLabel("7", "12px Inter, sans-serif", Color.BLUE, HeightReference.NONE);
    expect(label?.text).toBe("7");
    expect(label?.heightReference).toBe(HeightReference.NONE);
    expect(label?.disableDepthTestDistance).toBe(Number.POSITIVE_INFINITY);
    expect(label?.showBackground).toBe(true);
  });

  it.each([HeightReference.CLAMP_TO_GROUND, HeightReference.RELATIVE_TO_GROUND])(
    "builds no tag for a clamped marker (%s)",
    (ref) => {
      expect(sceneLabel("R1", "11px Inter, sans-serif", Color.ORANGE, ref)).toBeUndefined();
    },
  );
});
