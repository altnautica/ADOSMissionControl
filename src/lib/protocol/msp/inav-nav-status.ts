/**
 * iNav MSP_NAV_STATUS (121) value tables.
 *
 * The reply is U8 mode, U8 state, U8 activeWpAction, U8 activeWpNumber,
 * U8 error, U16 headingHoldTarget. mode is navSystemStatus_Mode_e, state is
 * navSystemStatus_State_e and activeWpAction is navWaypointActions_e, all
 * from iNav's navigation.h.
 *
 * @module protocol/msp/inav-nav-status
 * @license GPL-3.0-only
 */

/** navSystemStatus_Mode_e (MW_GPS_MODE_*). */
export const INAV_NAV_MODE_LABELS: Readonly<Record<number, string>> = {
  0: "NONE",
  1: "HOLD",
  2: "RTH",
  3: "NAV",
  15: "EMERGENCY",
};

/** navSystemStatus_State_e (MW_NAV_STATE_*). */
export const INAV_NAV_STATE_LABELS: Readonly<Record<number, string>> = {
  0: "NONE",
  1: "RTH_START",
  2: "RTH_ENROUTE",
  3: "HOLD_INFINIT",
  4: "HOLD_TIMED",
  5: "WP_ENROUTE",
  6: "PROCESS_NEXT",
  7: "DO_JUMP",
  8: "LAND_START",
  9: "LAND_IN_PROGRESS",
  10: "LANDED",
  11: "LAND_SETTLE",
  12: "LAND_START_DESCENT",
  13: "HOVER_ABOVE_HOME",
  14: "EMERGENCY_LANDING",
  15: "RTH_CLIMB",
};

/** navWaypointActions_e (NAV_WP_ACTION_*); 0 is no active waypoint action. */
export const INAV_NAV_WP_ACTION_LABELS: Readonly<Record<number, string>> = {
  1: "WAYPOINT",
  3: "HOLD_TIME",
  4: "RTH",
  5: "SET_POI",
  6: "JUMP",
  7: "SET_HEAD",
  8: "LAND",
};

export function inavNavModeLabel(mode: number): string {
  return INAV_NAV_MODE_LABELS[mode] ?? `Mode ${mode}`;
}

export function inavNavStateLabel(state: number): string {
  return INAV_NAV_STATE_LABELS[state] ?? `State ${state}`;
}

export function inavNavActionLabel(action: number): string {
  return INAV_NAV_WP_ACTION_LABELS[action] ?? `Action ${action}`;
}
