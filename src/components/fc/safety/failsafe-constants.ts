// ── Failsafe Constants ───────────────────────────────────────

export const RC_CHANNEL_COUNT = 8;

export const BF_FAILSAFE_PARAMS = [
  'BF_FS_DELAY',
  'BF_FS_OFF_DELAY',
  'BF_FS_THROTTLE',
  'BF_FS_PROCEDURE',
] as const;

export const BF_FS_PROCEDURE_OPTIONS = [
  { value: "0", label: "0 — Drop" },
  { value: "1", label: "1 — Land" },
  { value: "2", label: "2 — GPS Rescue" },
];

/** ArduCopter FS_OPTIONS bitmask bits */
export const FS_OPTION_BITS = [
  { mask: 1 << 0, label: "Bit 0 — Continue if in auto mode on RC failsafe" },
  { mask: 1 << 1, label: "Bit 1 — Continue if in auto mode on GCS failsafe" },
  { mask: 1 << 2, label: "Bit 2 — Continue if in guided mode on RC failsafe" },
  { mask: 1 << 3, label: "Bit 3 — Continue if landing on any failsafe" },
  { mask: 1 << 4, label: "Bit 4 — Continue if in pilot controlled mode on GCS failsafe" },
  { mask: 1 << 5, label: "Bit 5 — Release gripper" },
];

// ── Per-vehicle param sets ───────────────────────────────────
// Each firmware/vehicle loads only its own failsafe params, so a Copter never
// requests Plane-only names (and vice versa).

/** ArduCopter (and the Copter-shaped Rover/Sub failsafe surface). */
export const COPTER_FS_PARAMS = [
  "FS_THR_ENABLE", "FS_THR_VALUE", "FS_GCS_ENABLE", "FS_GCS_TIMEOUT",
  "FS_EKF_ACTION", "FS_CRASH_CHECK", "FS_OPTIONS", "TERRAIN_ENABLE",
];

/** ArduPlane. */
export const PLANE_FS_PARAMS = [
  "FS_SHORT_ACTN", "FS_LONG_ACTN", "FS_LONG_TIMEOUT", "FS_GCS_ENABL",
  "THR_FAILSAFE", "THR_FS_VALUE", "TERRAIN_ENABLE",
];

/** Plane params that newer firmware no longer carries. */
export const PLANE_FS_OPTIONAL_PARAMS = ["FS_SHORT_TIMEOUT"];

/** ArduPilot params common to every vehicle. */
export const AP_SHARED_FS_PARAMS = [
  "BATT_FS_VOLTSRC", "BATT_FS_LOW_VOLT", "BATT_FS_LOW_ACT",
  "FENCE_ENABLE", "FENCE_TYPE", "FENCE_ACTION", "FENCE_ALT_MAX", "FENCE_RADIUS", "FENCE_ALT_MIN",
  ...Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => `RC${i + 1}_OPTION`),
];

/**
 * PX4, by the canonical names the PX4 handler maps (BATT_FS_LOW_ACT is
 * COM_LOW_BAT_ACT, BATT_FS_LOW_VOLT is the BAT_LOW_THR fraction, FENCE_ENABLE
 * is GF_ACTION) plus the PX4-native EKF limits.
 */
export const PX4_FS_PARAMS = [
  "BATT_FS_LOW_VOLT", "BATT_FS_LOW_ACT",
  "FENCE_ENABLE", "FENCE_ALT_MAX", "FENCE_RADIUS",
  "COM_POS_FS_EPH", "COM_VEL_FS_EVH",
];
