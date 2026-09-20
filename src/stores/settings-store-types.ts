/**
 * Shared type aliases for the persisted settings store.
 *
 * Lives apart from the store itself so the migration module, the constants
 * module, and the test suite can pull in the type vocabulary without
 * importing the runtime store factory.
 *
 * @license GPL-3.0-only
 */

import type { Jurisdiction } from "@/lib/jurisdiction";

export type { Jurisdiction };

/** `"custom"` = operator-supplied tile URL template (`customTileUrl`). */
export type MapTileSource = "osm" | "satellite" | "terrain" | "dark" | "custom";
export type UnitSystem = "metric" | "imperial";

/**
 * Map coordinate display format for the cursor readout and coordinate labels.
 * "dd" = signed decimal degrees, "dms" = degree/minute/second with hemisphere,
 * "utm" = UTM grid, "mgrs" = Military Grid Reference System.
 */
export type CoordFormat = "dd" | "dms" | "utm" | "mgrs";

export type ThemeMode =
  | "dark" | "light" | "solarized-dark" | "solarized-light" | "nvg"
  | "dracula" | "catppuccin-mocha" | "catppuccin-frappe" | "catppuccin-latte"
  | "nord" | "gruvbox-dark" | "gruvbox-light" | "one-dark" | "tokyo-night"
  | "rose-pine" | "monokai" | "kanagawa" | "synthwave" | "github-dark"
  | "ayu-dark" | "ayu-mirage" | "everforest-dark";

export type AccentColor =
  | "blue" | "green" | "amber" | "red" | "lime" | "purple" | "pink" | "cyan" | "orange";

export type GuidanceLineType = "solid" | "dashed" | "dotted";

export type TelemetryDeckPageId = "flight" | "link" | "power" | "tuning";

export type TelemetryDeckMetricId =
  | "relAlt"
  | "airspeed"
  | "groundspeedMs"
  | "throttle"
  | "climbRate"
  | "gpsFix"
  | "satellites"
  | "gpsHdop"
  | "batteryVoltage"
  | "batteryCurrent"
  | "batteryConsumed"
  | "roll"
  | "pitch"
  | "yaw"
  | "wpDistance"
  | "xtrackError"
  | "altError"
  | "navBearing"
  | "targetBearing"
  | "windSpeed"
  | "windDirection"
  | "radioRssi"
  | "remrssi"
  | "noise"
  | "remnoise"
  | "rxerrors"
  | "txbuf"
  | "powerWatts"
  | "estFlightMin"
  | "ekfVelRatio"
  | "ekfPosHorizRatio"
  | "vibeX"
  | "vibeY"
  | "vibeZ";

export type ParamColumnId = "index" | "name" | "description" | "value" | "range" | "units" | "type" | "options";

export type ParamColumnVisibility = Record<ParamColumnId, boolean>;

export interface ParameterFilterPreset {
  id: string;
  name: string;
  filter: string;
  category: string | null;
  showModifiedOnly: boolean;
  showNonDefault: boolean;
  showFavorites: boolean;
}
