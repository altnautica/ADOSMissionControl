/**
 * @module cockpit/launch-spec
 * @description The launch altitude limits and default from the shared
 * cockpit spec `layout.json` (`launch`), so the take-off stepper, the launch
 * sheet and every other surface offer the same range and start at the same
 * height. The spec names no default go-to offset: a launch flies nowhere
 * after the climb unless the operator picks a point.
 *
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit-spec/layout.json";

export interface LaunchLimits {
  /** Lowest launch altitude, metres above home. */
  altMinM: number;
  /** Highest launch altitude, metres above home. */
  altMaxM: number;
  /** The altitude a launch starts at, metres above home. */
  altDefaultM: number;
  /** The go-to offset a launch starts with (north, east metres), or null for
   *  none. */
  gotoDefault: readonly [north: number, east: number] | null;
}

const LAUNCH = layoutSpec.launch;

export const launchLimits: Readonly<LaunchLimits> = Object.freeze({
  altMinM: LAUNCH.alt_min_m,
  altMaxM: LAUNCH.alt_max_m,
  altDefaultM: LAUNCH.alt_default_m,
  gotoDefault: LAUNCH.goto_default as LaunchLimits["gotoDefault"],
});
