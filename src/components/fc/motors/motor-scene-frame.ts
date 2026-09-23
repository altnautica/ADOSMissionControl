/**
 * Body frame ↔ three.js scene frame for the 3D motor diagram.
 *
 * Scene axes: +x = right wing, +y = up, -z = nose (the three.js default
 * forward). This is a proper rotation of the aircraft body frame (x forward,
 * y right, z down), so the top-down view is never mirrored.
 *
 * @license GPL-3.0-only
 */

import * as THREE from "three";
import { motorBodyPosition, type MotorPosition } from "@/lib/motor-layouts";

/** Scene position of a body-frame point `forward` ahead, `right` of and `up` above centre. */
export function bodyToScene(forward: number, right: number, up = 0): [number, number, number] {
  return [right, up, -forward];
}

/** Scene position of a motor hub, scaled from mixer-factor units. */
export function motorScenePosition(
  motor: MotorPosition,
  scale: number,
  yOffset: number,
): [number, number, number] {
  const { forward, right } = motorBodyPosition(motor);
  return bodyToScene(forward * scale, right * scale, yOffset);
}

/**
 * Rotation that lays a flat 2D shape drawn in (x = right, y = forward) onto
 * the scene's horizontal plane, consistent with `bodyToScene`.
 */
export const BODY_PLANE_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * Scene orientation for an aircraft attitude in degrees (ArduPilot
 * convention: roll right-wing-down, pitch nose-up, yaw clockwise from above,
 * applied yaw → pitch → roll). Writes into `out` to avoid per-frame
 * allocation.
 */
export function attitudeToSceneEuler(
  rollDeg: number,
  pitchDeg: number,
  yawDeg: number,
  out: THREE.Euler = new THREE.Euler(),
): THREE.Euler {
  const d2r = THREE.MathUtils.DEG2RAD;
  // Body roll axis is scene -z, pitch axis is scene +x, yaw axis is scene -y.
  return out.set(pitchDeg * d2r, -yawDeg * d2r, -rollDeg * d2r, "YXZ");
}
