/**
 * @module cockpit/layers/frame-store
 * @description The per-drone store of overlay frames (`ar`, `obstacles`,
 * `depth`, `surfaces`) the layer stack draws. It is a plain mutable store, not
 * React state: frames arrive at 10–20 Hz and only the layer stack's draw loop
 * reads them, so a new frame bumps {@link frameVersion} and wakes the loop's
 * listener without re-rendering any component.
 *
 * Each slot keeps the newest frame and the one before it, with the arrival
 * times of each distinct frame on this browser's clock, so the renderer can
 * interpolate keyed items over the measured inter-frame interval. A keep-alive
 * (same `ts_ms`) moves only `receivedAt`, the freshness clock; it never moves
 * `frameAt`, so it cannot restart interpolation.
 *
 * @license GPL-3.0-only
 */

import type { ArFrame, DepthFrame, ObstaclesFrame, SurfacesFrame } from "./cockpit-frames";

export interface FrameSlot<T> {
  frame: T;
  /** Last time this frame or a keep-alive of it arrived (freshness). */
  receivedAt: number;
  /** When `frame` itself first arrived (interpolation clock). */
  frameAt: number;
  prev: T | null;
  /** When `prev` first arrived. */
  prevAt: number | null;
}

export interface DroneFrames {
  ar: FrameSlot<ArFrame> | null;
  obstacles: FrameSlot<ObstaclesFrame> | null;
  depth: FrameSlot<DepthFrame> | null;
  surfaces: FrameSlot<SurfacesFrame> | null;
}

export type FrameKind = keyof DroneFrames;

const drones = new Map<string, DroneFrames>();
const listeners = new Set<() => void>();
let version = 0;

function slots(droneId: string): DroneFrames {
  let d = drones.get(droneId);
  if (!d) {
    d = { ar: null, obstacles: null, depth: null, surfaces: null };
    drones.set(droneId, d);
  }
  return d;
}

function bump(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** Store one frame. A frame whose `tsMs` equals the newest one (a keep-alive)
 * refreshes the arrival time only, so it keeps the layer fresh without
 * restarting interpolation. */
export function putFrame<K extends FrameKind>(
  droneId: string,
  kind: K,
  frame: NonNullable<DroneFrames[K]>["frame"],
  at: number = Date.now(),
): void {
  const d = slots(droneId);
  const cur = d[kind] as FrameSlot<{ tsMs: number }> | null;
  const next = frame as { tsMs: number };
  if (cur && cur.frame.tsMs === next.tsMs) {
    cur.receivedAt = at;
  } else if (cur) {
    cur.prev = cur.frame;
    cur.prevAt = cur.frameAt;
    cur.frame = next;
    cur.receivedAt = at;
    cur.frameAt = at;
  } else {
    (d as unknown as Record<FrameKind, FrameSlot<unknown>>)[kind] = {
      frame,
      receivedAt: at,
      frameAt: at,
      prev: null,
      prevAt: null,
    };
  }
  bump();
}

/** The frames of one drone (empty slots before the first frame). The object is
 * owned by the store: read it, never keep it past the current draw. */
export function getFrames(droneId: string): DroneFrames {
  return slots(droneId);
}

export function clearFrames(droneId: string): void {
  if (drones.delete(droneId)) bump();
}

/** Bumped on every stored frame. */
export function frameVersion(): number {
  return version;
}

export function subscribeFrames(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
