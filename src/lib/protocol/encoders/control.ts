/**
 * MAVLink control encoders: ManualControl, PositionTarget, AttitudeTarget.
 * @module protocol/encoders/control
 */

import { buildFrame } from "./frame";
import { setU8, writeI16, writeU16 } from "./bounds";

/** The axis range MANUAL_CONTROL defines, and what the callers normalise to. */
const AXIS_MIN = -1000;
const AXIS_MAX = 1000;

// ── MANUAL_CONTROL (ID 69) ──────────────────────────────────

/**
 * Encode a MANUAL_CONTROL message.
 *
 * Sent at up to 50 Hz for real-time joystick/gamepad control.
 * Axes are int16 (-1000 to 1000), buttons is uint16 bitmask.
 *
 * The axis range is enforced rather than narrowed. Callers clamp their
 * normalised stick values on the way in; this refuses anything that arrives
 * unclamped instead of wrapping it into a different, in-range stick position.
 *
 * @throws RangeError when an axis, the button mask, or the target system id is
 *   outside the field it is written to.
 */
export function encodeManualControl(
  targetSys: number,
  x: number,
  y: number,
  z: number,
  r: number,
  buttons: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(11);
  const dv = new DataView(payload.buffer);
  requireAxis(x, "manual control pitch");
  requireAxis(y, "manual control roll");
  requireAxis(z, "manual control throttle");
  requireAxis(r, "manual control yaw");
  writeI16(dv, 0, x, "manual control pitch");        // pitch (forward/back)
  writeI16(dv, 2, y, "manual control roll");         // roll (left/right)
  writeI16(dv, 4, z, "manual control throttle");     // throttle (up/down)
  writeI16(dv, 6, r, "manual control yaw");          // yaw (rotation)
  writeU16(dv, 8, buttons, "manual control buttons");
  setU8(payload, 10, targetSys, "manual control target system");
  return buildFrame(69, payload, sysId, compId);
}

function requireAxis(value: number, field: string): void {
  if (!Number.isInteger(value) || value < AXIS_MIN || value > AXIS_MAX) {
    throw new RangeError(
      `${field}: expected ${AXIS_MIN}..${AXIS_MAX}, received ${String(value)}`,
    );
  }
}

// ── SET_POSITION_TARGET_GLOBAL_INT (ID 86) ───────────────────

/**
 * Encode SET_POSITION_TARGET_GLOBAL_INT.
 *
 * Used for guided position commands (GUIDED mode goto).
 * lat/lon as int32 * 1e7, alt in meters.
 */
export function encodeSetPositionTargetGlobalInt(
  targetSys: number,
  targetComp: number,
  latInt: number,
  lonInt: number,
  alt: number,
  vx: number,
  vy: number,
  vz: number,
  typeMask: number,
  coordFrame: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(53);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, 0, true);           // timeBootMs (0 = let FC use its own)
  dv.setInt32(4, latInt, true);        // lat * 1e7
  dv.setInt32(8, lonInt, true);        // lon * 1e7
  dv.setFloat32(12, alt, true);        // alt
  dv.setFloat32(16, vx, true);         // vx
  dv.setFloat32(20, vy, true);         // vy
  dv.setFloat32(24, vz, true);         // vz
  dv.setFloat32(28, 0, true);          // afx
  dv.setFloat32(32, 0, true);          // afy
  dv.setFloat32(36, 0, true);          // afz
  dv.setFloat32(40, 0, true);          // yaw
  dv.setFloat32(44, 0, true);          // yawRate
  dv.setUint16(48, typeMask, true);    // typeMask
  payload[50] = targetSys;
  payload[51] = targetComp;
  payload[52] = coordFrame;
  return buildFrame(86, payload, sysId, compId);
}

// ── SET_ATTITUDE_TARGET (ID 82) ──────────────────────────────

/**
 * Encode SET_ATTITUDE_TARGET.
 *
 * Used for attitude-level guided flight commands.
 * Quaternion is constructed from Euler angles (simplified roll/pitch/yaw).
 */
export function encodeSetAttitudeTarget(
  targetSys: number,
  targetComp: number,
  roll: number,
  pitch: number,
  yaw: number,
  thrust: number,
  typeMask: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(39);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, 0, true);             // timeBootMs
  // Simplified quaternion from Euler: identity with small-angle approx
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  dv.setFloat32(4, cr * cp * cy + sr * sp * sy, true);   // q[0] w
  dv.setFloat32(8, sr * cp * cy - cr * sp * sy, true);   // q[1] x
  dv.setFloat32(12, cr * sp * cy + sr * cp * sy, true);  // q[2] y
  dv.setFloat32(16, cr * cp * sy - sr * sp * cy, true);  // q[3] z
  dv.setFloat32(20, 0, true);           // bodyRollRate
  dv.setFloat32(24, 0, true);           // bodyPitchRate
  dv.setFloat32(28, 0, true);           // bodyYawRate
  dv.setFloat32(32, thrust, true);       // thrust (0-1)
  payload[36] = targetSys;
  payload[37] = targetComp;
  payload[38] = typeMask;
  return buildFrame(82, payload, sysId, compId);
}

// RC_CHANNELS_OVERRIDE (ID 70) is deliberately not encoded here. The stick
// path is MANUAL_CONTROL (69) on MAVLink and MSP_SET_RAW_RC on MSP, both of
// which are live and exercised. An RC-override encoder with no adapter method
// and no caller is a trap: it reads as a tested control path and is not one.
