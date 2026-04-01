import type { TelemetryDeckMetricId, TelemetryDeckPageId } from "@/stores/settings-store";
import type { DeckMetricOption, DeckMetricCategory, DeckThreshold } from "./deck-types";

export const DECK_PAGE_TABS: Array<{ id: TelemetryDeckPageId; label: string }> = [
  { id: "flight", label: "Flight" },
  { id: "link", label: "Link" },
  { id: "power", label: "Power" },
  { id: "tuning", label: "Tuning" },
];

export const CATEGORY_ORDER: DeckMetricCategory[] = [
  "Flight",
  "Navigation",
  "Power",
  "GPS",
  "Link",
  "Wind",
  "Tuning",
];

export const DECK_METRIC_OPTIONS: DeckMetricOption[] = [
  { id: "relAlt", label: "REL ALT", category: "Flight" },
  { id: "airspeed", label: "AIRSPD", category: "Flight" },
  { id: "groundspeedMs", label: "GSPD", category: "Flight" },
  { id: "throttle", label: "THR", category: "Flight" },
  { id: "climbRate", label: "CLIMB", category: "Flight" },
  { id: "roll", label: "ROLL", category: "Flight" },
  { id: "pitch", label: "PITCH", category: "Flight" },
  { id: "yaw", label: "YAW", category: "Flight" },

  { id: "wpDistance", label: "WP DIST", category: "Navigation" },
  { id: "xtrackError", label: "XTRACK", category: "Navigation" },
  { id: "altError", label: "ALT ERR", category: "Navigation" },
  { id: "navBearing", label: "NAV BRG", category: "Navigation" },
  { id: "targetBearing", label: "TGT BRG", category: "Navigation" },

  { id: "batteryVoltage", label: "BAT V", category: "Power" },
  { id: "batteryCurrent", label: "BAT A", category: "Power" },
  { id: "batteryConsumed", label: "mAh", category: "Power" },
  { id: "powerWatts", label: "WATTS", category: "Power" },
  { id: "estFlightMin", label: "EST MIN", category: "Power" },

  { id: "gpsFix", label: "GPS FIX", category: "GPS" },
  { id: "satellites", label: "SATS", category: "GPS" },
  { id: "gpsHdop", label: "HDOP", category: "GPS" },

  { id: "radioRssi", label: "RSSI", category: "Link" },
  { id: "remrssi", label: "REM RSSI", category: "Link" },
  { id: "noise", label: "NOISE", category: "Link" },
  { id: "remnoise", label: "REM NOISE", category: "Link" },
  { id: "rxerrors", label: "RX ERR", category: "Link" },
  { id: "txbuf", label: "TX BUF", category: "Link" },

  { id: "windSpeed", label: "WIND", category: "Wind" },
  { id: "windDirection", label: "WIND DIR", category: "Wind" },

  { id: "ekfVelRatio", label: "EKF VEL", category: "Tuning" },
  { id: "ekfPosHorizRatio", label: "EKF POS", category: "Tuning" },
  { id: "vibeX", label: "VIBE X", category: "Tuning" },
  { id: "vibeY", label: "VIBE Y", category: "Tuning" },
  { id: "vibeZ", label: "VIBE Z", category: "Tuning" },
];

export const DECK_PRESETS: Array<{ id: string; label: string; metrics: TelemetryDeckMetricId[] }> = [
  {
    id: "mapping",
    label: "Mapping",
    metrics: ["relAlt", "groundspeedMs", "airspeed", "throttle", "gpsFix", "satellites", "batteryVoltage", "powerWatts"],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    metrics: ["groundspeedMs", "climbRate", "roll", "pitch", "yaw", "windSpeed", "batteryVoltage", "estFlightMin"],
  },
  {
    id: "long-range",
    label: "Long-range",
    metrics: ["radioRssi", "remrssi", "noise", "remnoise", "rxerrors", "txbuf", "batteryVoltage", "estFlightMin"],
  },
  {
    id: "tuning",
    label: "Tuning",
    metrics: ["roll", "pitch", "yaw", "vibeX", "vibeY", "vibeZ", "ekfVelRatio", "ekfPosHorizRatio"],
  },
];

/** Per-cell voltage thresholds (multiplied by cellCount at runtime). */
export const BATTERY_CELL_WARNING_V = 3.6;
export const BATTERY_CELL_CRITICAL_V = 3.5;

/**
 * Static thresholds for metrics. batteryVoltage is excluded here because
 * it requires dynamic per-cell computation (see getSeverity in deck-utils).
 */
export const DECK_THRESHOLDS: Partial<Record<TelemetryDeckMetricId, DeckThreshold>> = {
  batteryCurrent: { mode: "gt", warning: 45, critical: 60 },
  powerWatts: { mode: "gt", warning: 650, critical: 850 },
  estFlightMin: { mode: "lt", warning: 5, critical: 2.5 },
  satellites: { mode: "lt", warning: 10, critical: 6 },
  gpsHdop: { mode: "gt", warning: 2.2, critical: 4 },
  gpsFix: { mode: "lt", warning: 3, critical: 2 },
  radioRssi: { mode: "lt", warning: 35, critical: 20 },
  remrssi: { mode: "lt", warning: 35, critical: 20 },
  noise: { mode: "gt", warning: 30, critical: 45 },
  remnoise: { mode: "gt", warning: 30, critical: 45 },
  rxerrors: { mode: "gt", warning: 5, critical: 20 },
  txbuf: { mode: "lt", warning: 40, critical: 20 },
  roll: { mode: "absGt", warning: 35, critical: 55 },
  pitch: { mode: "absGt", warning: 35, critical: 55 },
  climbRate: { mode: "absGt", warning: 5, critical: 8 },
  xtrackError: { mode: "absGt", warning: 8, critical: 15 },
  altError: { mode: "absGt", warning: 5, critical: 10 },
  ekfVelRatio: { mode: "gt", warning: 0.8, critical: 1.0 },
  ekfPosHorizRatio: { mode: "gt", warning: 0.8, critical: 1.0 },
  vibeX: { mode: "gt", warning: 35, critical: 55 },
  vibeY: { mode: "gt", warning: 35, critical: 55 },
  vibeZ: { mode: "gt", warning: 35, critical: 55 },
};

export const METRIC_LABELS_BY_ID: Record<TelemetryDeckMetricId, string> = Object.fromEntries(
  DECK_METRIC_OPTIONS.map((m) => [m.id, m.label]),
) as Record<TelemetryDeckMetricId, string>;
