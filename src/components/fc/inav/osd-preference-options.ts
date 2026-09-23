/**
 * @module osd-preference-options
 * @description Select options for the iNav OSD preferences. Each list is the
 * firmware's settings table in enum order, so an option's value is the index
 * the FC stores (osd_video_system, osd_unit, osd_stats_energy_unit,
 * osd_crosshairs_style, osd_sidebar_scroll, osd_adsb_warning_style).
 * @license GPL-3.0-only
 */

import type { SelectOption } from "@/components/ui/select";

function enumOptions(labels: readonly string[]): SelectOption[] {
  return labels.map((label, i) => ({ value: String(i), label }));
}

export const VIDEO_SYSTEM_OPTIONS = enumOptions([
  "Auto",
  "PAL",
  "NTSC",
  "HDZero",
  "DJI WTF",
  "Avatar",
  "BF 4.3 compatible",
  "BF HD compatible",
  "DJI native",
]);

export const UNITS_OPTIONS = enumOptions([
  "Imperial",
  "Metric",
  "Metric + mph",
  "UK",
  "General aviation",
]);

export const ENERGY_UNIT_OPTIONS = enumOptions(["mAh", "Wh"]);

export const CROSSHAIRS_OPTIONS = enumOptions([
  "Default",
  "Aircraft",
  "Type 3",
  "Type 4",
  "Type 5",
  "Type 6",
  "Type 7",
  "Type 8",
]);

export const SIDEBAR_SCROLL_OPTIONS = enumOptions(["None", "Altitude", "Speed", "Home distance"]);

export const ADSB_WARNING_STYLE_OPTIONS = enumOptions(["Compact", "Extended"]);

/** osd_main_voltage_decimals range. */
export const VOLTAGE_DECIMALS_MIN = 1;
export const VOLTAGE_DECIMALS_MAX = 2;
