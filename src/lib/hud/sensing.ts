/**
 * @module hud/sensing
 * @description The sensing chip, the same words on every surface: what the
 * pilot sees obstacles with and the speed that still stops inside the range
 * it sees clear (`sensing`, "Sensing: 3D lidar · ≤ 4.2 m/s"). Nothing while
 * the pilot reports no sensing (an older agent).
 *
 * @license GPL-3.0-only
 */

import { speedCapText, type Sensing, type SensingTier } from "./pilot-fields";
import { specText } from "./spec-text";

/** `3D lidar`, `Depth camera`, `Camera` or `2D lidar`. */
export function sensingTierLabel(tier: SensingTier): string {
  return specText(`pilot.sensing.tier.${tier}`);
}

/** `Sensing: 3D lidar · ≤ 4.2 m/s`, or null with no sensing reported. */
export function sensingChipText(s: Sensing | null): string | null {
  if (!s) return null;
  return specText("pilot.sensing.chip", { tier: sensingTierLabel(s.tier), v: speedCapText(s.speedLimitMps) });
}
