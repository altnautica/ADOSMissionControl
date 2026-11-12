/**
 * Parameters that define the vehicle's frame, airframe or actuator geometry.
 * Changing one while the vehicle may be armed is hard-blocked (as the
 * ArduPilot Frame panel does for FRAME_CLASS / FRAME_TYPE), not merely
 * confirmed.
 * @license GPL-3.0-only
 */

const FRAME_GEOMETRY = /^(FRAME_CLASS|FRAME_TYPE|CA_.+|VT_TYPE|Q_ENABLE|Q_FRAME_.+|Q_TAILSIT_ENABLE|Q_TILT_.+|H_SW_TYPE)$/;

export function isFrameGeometryParam(name: string): boolean {
  return FRAME_GEOMETRY.test(name);
}
