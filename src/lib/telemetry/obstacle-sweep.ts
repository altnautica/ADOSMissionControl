/**
 * @module telemetry/obstacle-sweep
 * @description Angular geometry of an OBSTACLE_DISTANCE sample.
 *
 * Element i of `distances` covers the sector starting at
 * `angle_offset + i * step` degrees, clockwise, where the step is
 * `increment_f` when it is non-zero and the integer `increment` otherwise
 * (a negative `increment_f` runs counter-clockwise). The zero angle is north
 * for the default MAV_FRAME_GLOBAL (and the other earth frames), and the
 * vehicle's nose for body-aligned frames such as MAV_FRAME_BODY_FRD, which is
 * what a body-mounted sensor or a fused body-frame map reports.
 *
 * A distance of UINT16_MAX is unknown or unused, and anything above
 * `max_distance` means nothing is in range; neither is an obstacle.
 *
 * @license GPL-3.0-only
 */

import type { ObstacleData } from "@/lib/types/telemetry";

/** UINT16_MAX: the element is unknown or not used. */
export const OBSTACLE_UNKNOWN_CM = 65535;

/**
 * MAV_FRAME values whose zero angle is the vehicle's nose: BODY_NED and
 * BODY_OFFSET_NED (both superseded by BODY_FRD), BODY_FRD, LOCAL_FRD and
 * LOCAL_FLU. Every other frame is north aligned.
 */
const FORWARD_ALIGNED_FRAMES: ReadonlySet<number> = new Set([8, 9, 12, 20, 21]);

export type ObstacleReference = "north" | "forward";

export interface ObstacleSector {
  /** Clockwise from the reference, degrees; `startDeg < endDeg`. */
  startDeg: number;
  endDeg: number;
  distanceCm: number;
}

export interface ObstacleSweep {
  /** What the zero angle points at. */
  reference: ObstacleReference;
  /** One entry per element that reports an obstacle in range. */
  sectors: ObstacleSector[];
  /** Nearest obstacle in range, or null when every element is clear. */
  closestCm: number | null;
}

/** The sample's sectors, or null when its angular step is unusable. */
export function obstacleSweep(sample: ObstacleData): ObstacleSweep | null {
  const step = sample.incrementF !== 0 ? sample.incrementF : sample.increment;
  if (!Number.isFinite(step) || step === 0 || sample.distances.length === 0) return null;
  const offset = Number.isFinite(sample.angleOffset) ? sample.angleOffset : 0;
  const count = Math.min(sample.distances.length, Math.floor(360 / Math.abs(step)));

  const sectors: ObstacleSector[] = [];
  let closestCm: number | null = null;
  for (let i = 0; i < count; i++) {
    const distanceCm = sample.distances[i];
    if (distanceCm >= OBSTACLE_UNKNOWN_CM) continue;
    if (sample.maxDistance > 0 && distanceCm > sample.maxDistance) continue;
    const a = offset + i * step;
    const b = a + step;
    sectors.push({ startDeg: Math.min(a, b), endDeg: Math.max(a, b), distanceCm });
    if (closestCm === null || distanceCm < closestCm) closestCm = distanceCm;
  }
  return {
    reference: FORWARD_ALIGNED_FRAMES.has(sample.frame) ? "forward" : "north",
    sectors,
    closestCm,
  };
}
