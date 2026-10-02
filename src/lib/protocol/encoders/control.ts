/**
 * MAVLink control encoders: ManualControl.
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

// RC_CHANNELS_OVERRIDE (ID 70) is deliberately not encoded here. The stick
// path is MANUAL_CONTROL (69) on MAVLink and MSP_SET_RAW_RC on MSP, both of
// which are live and exercised. An RC-override encoder with no adapter method
// and no caller is a trap: it reads as a tested control path and is not one.
