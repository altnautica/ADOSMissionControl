/**
 * Complete ArduPilot RC option database.
 *
 * Covers RCx_OPTION aux function assignments (100+ values),
 * RC_PROTOCOLS bitmask definitions, RC_OPTIONS bitmask definitions,
 * bitmask helpers, and stick mode detection.
 *
 * @license GPL-3.0-only
 */

// ── Types ─────────────────────────────────────────────────────

export interface RcOption {
  value: number;
  label: string;
}

export interface RcOptionGroup {
  label: string;
  options: RcOption[];
}

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

// ── RCx_OPTION Grouped Database ───────────────────────────────

export const RC_OPTION_GROUPS: RcOptionGroup[] = [
  {
    label: "General",
    options: [
      { value: 0, label: "Do Nothing" },
    ],
  },
  {
    label: "Flight Modes",
    options: [
      { value: 2, label: "Flip" },
      { value: 3, label: "Simple Mode" },
      { value: 4, label: "RTL" },
      { value: 5, label: "Save Trim" },
      { value: 14, label: "Acro Trainer" },
      { value: 16, label: "Auto" },
      { value: 17, label: "AutoTune" },
      { value: 18, label: "Land" },
      { value: 42, label: "SmartRTL" },
      { value: 52, label: "Acro" },
      { value: 55, label: "Guided" },
      { value: 56, label: "Loiter" },
      { value: 68, label: "Stabilize" },
      { value: 69, label: "PosHold" },
      { value: 70, label: "AltHold" },
      { value: 72, label: "Circle" },
      { value: 73, label: "Drift" },
      { value: 84, label: "Air Mode" },
      { value: 99, label: "AUTO RTL" },
    ],
  },
  {
    label: "Arming",
    options: [
      { value: 81, label: "Disarm" },
      { value: 153, label: "Arm/Disarm (4.2+)" },
      { value: 154, label: "Arm/Disarm + AirMode" },
    ],
  },
  {
    label: "Safety",
    options: [
      { value: 11, label: "Fence Enable" },
      { value: 21, label: "Parachute Enable" },
      { value: 22, label: "Parachute Release" },
      { value: 23, label: "Parachute 3-pos" },
      { value: 31, label: "Motor E-Stop" },
      { value: 32, label: "Motor Interlock" },
      { value: 33, label: "Brake" },
      { value: 76, label: "Standby" },
    ],
  },
  {
    label: "Camera / Gimbal",
    options: [
      { value: 9, label: "Camera Trigger" },
      { value: 24, label: "Auto Mission Reset" },
      { value: 78, label: "RunCam Control" },
      { value: 79, label: "RunCam OSD Control" },
      { value: 102, label: "Camera Mode Toggle" },
      { value: 166, label: "Camera Record Video" },
      { value: 167, label: "Camera Zoom" },
      { value: 168, label: "Camera Manual Focus" },
      { value: 169, label: "Camera Auto Focus" },
    ],
  },
  {
    label: "Payload",
    options: [
      { value: 15, label: "Sprayer Enable" },
      { value: 19, label: "Gripper Release" },
      { value: 29, label: "Landing Gear" },
      { value: 88, label: "Winch Enable" },
      { value: 89, label: "Winch Control" },
    ],
  },
  {
    label: "Sensors",
    options: [
      { value: 10, label: "RangeFinder Enable" },
      { value: 38, label: "ADSB Avoidance" },
      { value: 39, label: "Precision Loiter" },
      { value: 62, label: "Compass Learn" },
      { value: 65, label: "GPS Disable" },
      { value: 80, label: "VisOdom Align" },
      { value: 90, label: "EKF Pos Source" },
    ],
  },
  {
    label: "Relay",
    options: [
      { value: 28, label: "Relay 1 On/Off" },
      { value: 34, label: "Relay 2 On/Off" },
      { value: 35, label: "Relay 3 On/Off" },
      { value: 36, label: "Relay 4 On/Off" },
      { value: 66, label: "Relay 5 On/Off" },
      { value: 67, label: "Relay 6 On/Off" },
    ],
  },
  {
    label: "Navigation",
    options: [
      { value: 7, label: "Save Waypoint" },
      { value: 25, label: "Auto Mission Restart" },
      { value: 40, label: "Proximity Avoidance" },
      { value: 43, label: "InvertedFlight" },
      { value: 46, label: "RC Override Enable" },
      { value: 58, label: "Clear Waypoints" },
      { value: 60, label: "ZigZag Mode Auto" },
      { value: 61, label: "ZigZag Toggle AB" },
    ],
  },
  {
    label: "Logging / Tuning",
    options: [
      { value: 6, label: "SuperSimple Mode" },
      { value: 26, label: "AttCon Feedforward" },
      { value: 27, label: "AttCon Accel Limits" },
      { value: 37, label: "Motor Mix" },
      { value: 57, label: "Tuning" },
      { value: 71, label: "Surface Tracking UD" },
    ],
  },
  {
    label: "User / Scripting",
    options: [
      { value: 47, label: "User Function 1" },
      { value: 48, label: "User Function 2" },
      { value: 49, label: "User Function 3" },
      { value: 300, label: "Scripting 1" },
      { value: 301, label: "Scripting 2" },
      { value: 302, label: "Scripting 3" },
      { value: 303, label: "Scripting 4" },
      { value: 304, label: "Scripting 5" },
      { value: 305, label: "Scripting 6" },
      { value: 306, label: "Scripting 7" },
      { value: 307, label: "Scripting 8" },
    ],
  },
];

// ── Flat Lookup Map ───────────────────────────────────────────

/** Fast value → label lookup for inline display. */
export const RC_OPTION_MAP: Map<number, string> = new Map(
  RC_OPTION_GROUPS.flatMap((g) =>
    g.options.map((o) => [o.value, o.label] as [number, string]),
  ),
);

/** Get display label for an RCx_OPTION value, with fallback. */
export function getRcOptionLabel(value: number): string {
  return RC_OPTION_MAP.get(value) ?? `Unknown (${value})`;
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
