/**
 * @module scene-label
 * @description The numbered tag drawn above a waypoint or rally marker in the
 * 3D scene. A tag is drawn only at an absolute position (`HeightReference.NONE`):
 * Cesium (1.146) recycles a removed label's glyph and background billboards for
 * the next label, and a billboard that was clamped to the ground keeps the
 * clamped render position it was last given. A tag created while the marker
 * waited for terrain (clamped) and rebuilt once terrain resolved (absolute)
 * therefore drew at the stale clamped point, tens of kilometres under the
 * ground, and never showed. Markers still waiting for terrain draw the dot
 * alone; the tag arrives with the absolute position.
 * @license GPL-3.0-only
 */

import {
  Cartesian2,
  Color,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  VerticalOrigin,
  type LabelGraphics,
} from "cesium";

/** The tag for a marker at `heightReference`, or undefined when the marker is
 * not at an absolute position (see the module note). */
export function sceneLabel(
  text: string,
  font: string,
  background: Color,
  heightReference: HeightReference,
): LabelGraphics.ConstructorOptions | undefined {
  if (heightReference !== HeightReference.NONE) return undefined;
  return {
    text,
    font,
    fillColor: Color.WHITE,
    style: LabelStyle.FILL,
    outlineWidth: 2,
    outlineColor: Color.BLACK,
    verticalOrigin: VerticalOrigin.BOTTOM,
    horizontalOrigin: HorizontalOrigin.CENTER,
    pixelOffset: new Cartesian2(0, -16),
    heightReference,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    showBackground: true,
    backgroundColor: background.withAlpha(0.8),
    backgroundPadding: new Cartesian2(4, 2),
  };
}
