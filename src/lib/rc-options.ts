/**
 * ArduPilot RC tables: RC_PROTOCOLS and RC_OPTIONS bitmask definitions,
 * bitmask helpers, and stick mode detection. RCx_OPTION labels come from the
 * FC parameter metadata, not from a table here.
 *
 * @license GPL-3.0-only
 */

// ── Types ─────────────────────────────────────────────────────

export interface ChannelConfig {
  min: number;
  max: number;
  trim: number;
  reversed: boolean;
  deadzone: number;
  option: number;
}

export interface MappingState {
  roll: string;
  pitch: string;
  throttle: string;
  yaw: string;
}

// ── RC_PROTOCOLS Bitmask ──────────────────────────────────────

export interface BitmaskBit {
  bit: number;
  label: string;
}

export const RC_PROTOCOLS: BitmaskBit[] = [
  { bit: 0, label: "All" },
  { bit: 1, label: "PPM" },
  { bit: 2, label: "IBUS" },
  { bit: 3, label: "SBUS" },
  { bit: 4, label: "SBUS_NI" },
  { bit: 5, label: "DSM" },
  { bit: 6, label: "SUMD" },
  { bit: 7, label: "SRXL" },
  { bit: 8, label: "SRXL2" },
  { bit: 9, label: "CRSF" },
  { bit: 10, label: "ST24" },
  { bit: 11, label: "FPORT" },
  { bit: 12, label: "FPORT2" },
  { bit: 13, label: "FastSBUS" },
];

// ── RC_OPTIONS Bitmask ────────────────────────────────────────

export const RC_OPTIONS_BITS: BitmaskBit[] = [
  { bit: 0, label: "Ignore RC Receiver" },
  { bit: 1, label: "Ignore MAVLink Overrides" },
  { bit: 2, label: "Ignore RX Failsafe" },
  { bit: 3, label: "FPort Pad" },
  { bit: 4, label: "Log RC Input Bytes" },
  { bit: 5, label: "Arming Check Throttle" },
  { bit: 6, label: "Skip Neutral Stick Check" },
  { bit: 7, label: "Allow Switch Reverse" },
  { bit: 8, label: "CRSF Telemetry Passthrough" },
  { bit: 9, label: "Suppress CRSF/ELRS Messages" },
  { bit: 10, label: "Multi Receiver Support" },
  { bit: 11, label: "Use CRSF LQ as RSSI" },
];

// ── Bitmask Helpers ───────────────────────────────────────────

/** Convert a bitmask number to a Set of active bit indices. */
export function bitmaskToSet(n: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < 32; i++) {
    if (n & (1 << i)) s.add(i);
  }
  return s;
}

/** Convert a Set of bit indices to a bitmask number. */
export function setToBitmask(set: Set<number>): number {
  let n = 0;
  for (const bit of set) {
    n |= 1 << bit;
  }
  return n;
}

// ── Stick Mode Detection ──────────────────────────────────────

/**
 * Detect RC stick mode from RCMAP channel assignments.
 *
 * | Mode | Left Stick        | Right Stick       |
 * |------|-------------------|-------------------|
 * | 1    | Yaw + Pitch       | Roll + Throttle   |
 * | 2    | Yaw + Throttle    | Roll + Pitch      |
 * | 3    | Roll + Pitch      | Yaw + Throttle    |
 * | 4    | Roll + Throttle   | Yaw + Pitch       |
 *
 * Assumes standard 4-channel layout where CH1/2 = right stick, CH3/4 = left stick.
 */
export function detectStickMode(
  rollCh: number,
  pitchCh: number,
  throttleCh: number,
  yawCh: number,
): 1 | 2 | 3 | 4 | null {
  // Mode 2 (most common): Roll=1, Pitch=2, Throttle=3, Yaw=4
  if (rollCh === 1 && pitchCh === 2 && throttleCh === 3 && yawCh === 4) return 2;
  // Mode 1: Roll=1, Throttle=2, Pitch=3, Yaw=4
  if (rollCh === 1 && pitchCh === 3 && throttleCh === 2 && yawCh === 4) return 1;
  // Mode 3: Pitch=1, Roll=2, Yaw=3, Throttle=4
  if (rollCh === 2 && pitchCh === 1 && throttleCh === 4 && yawCh === 3) return 3;
  // Mode 4: Throttle=1, Roll=2, Yaw=3, Pitch=4
  if (rollCh === 2 && pitchCh === 4 && throttleCh === 1 && yawCh === 3) return 4;
  return null;
}
