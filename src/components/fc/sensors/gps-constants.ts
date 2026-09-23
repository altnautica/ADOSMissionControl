export const GPS_PARAM_NAMES = [
  "BF_GPS_PROVIDER",
  "BF_GPS_SBAS_MODE",
  "BF_GPS_AUTO_CONFIG",
  "BF_GPS_AUTO_BAUD",
  "BF_GPS_USE_GALILEO",
  "BF_GPS_RESCUE_ANGLE",
  "BF_GPS_RESCUE_INITIAL_ALT",
  "BF_GPS_RESCUE_DESCENT_DIST",
  "BF_GPS_RESCUE_GROUND_SPEED",
  "BF_GPS_RESCUE_THROTTLE_MIN",
  "BF_GPS_RESCUE_THROTTLE_MAX",
  "BF_GPS_RESCUE_THROTTLE_HOVER",
  "BF_GPS_RESCUE_SANITY_CHECKS",
  "BF_GPS_RESCUE_MIN_SATS",
] as const;

export const gpsParamNames = [...GPS_PARAM_NAMES];

export const GPS_PROVIDER_OPTIONS = [
  { value: "0", label: "0 — NMEA" },
  { value: "1", label: "1 — UBLOX" },
  { value: "2", label: "2 — MSP" },
];

export const SBAS_MODE_OPTIONS = [
  { value: "0", label: "0 — Auto" },
  { value: "1", label: "1 — EGNOS" },
  { value: "2", label: "2 — WAAS" },
  { value: "3", label: "3 — MSAS" },
  { value: "4", label: "4 — GAGAN" },
  { value: "5", label: "5 — None" },
];

/** Betaflight gps_rescue_sanity_checks: RESCUE_SANITY_OFF / _ON / _FS_ONLY (the default). */
export const SANITY_CHECK_OPTIONS = [
  { value: "0", label: "0 — Off" },
  { value: "1", label: "1 — On" },
  { value: "2", label: "2 — Failsafe only" },
];
