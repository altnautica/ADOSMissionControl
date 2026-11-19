/**
 * @module mock/mock-live-map
 * @description The demo drone's live map in 3D: a point cloud sampled from
 * the synthetic room it flies in, served as Navigation's sweep reply
 * (`GET /navigation/sweep`), so the Map tab's 3D view shows a cloud with no
 * agent. The occupancy grid, pose, scan and map status come from `mock-nav`.
 * @license GPL-3.0-only
 */

import { SWEEP_HEADER_BYTES } from "@/components/drone-detail/map/sweep-cloud";
import { PILLARS, WALLS, ROOM_HALF_M } from "./mock-nav-world";

/** One map-frame point (x north, y east, z up, metres). */
export interface CloudPoint {
  x: number;
  y: number;
  z: number;
}

export const CLOUD_HEIGHT_M = 2.75;
const SURFACE_SPACING_M = 0.15;
const FLOOR_SPACING_M = 0.6;

/** Small deterministic scatter so the cloud does not look like a lattice. */
function scatter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.04;
}

/**
 * A point cloud of the demo room: the walls and pillars sampled every 0.15 m
 * along their surface from the floor to 2.75 m, plus a sparse floor grid at
 * z = 0. Deterministic, so every mount shows the same scene.
 */
export function demoPointCloud(): CloudPoint[] {
  const out: CloudPoint[] = [];
  const heights: number[] = [];
  for (let z = 0; z <= CLOUD_HEIGHT_M + 1e-9; z += SURFACE_SPACING_M) heights.push(z);
  const column = (x: number, y: number) => {
    for (const z of heights) {
      const i = out.length;
      out.push({ x: x + scatter(i), y: y + scatter(i + 7), z });
    }
  };
  for (const w of WALLS) {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const steps = Math.max(1, Math.round(len / SURFACE_SPACING_M));
    for (let s = 0; s <= steps; s++) {
      column(w.ax + ((w.bx - w.ax) * s) / steps, w.ay + ((w.by - w.ay) * s) / steps);
    }
  }
  for (const p of PILLARS) {
    const steps = Math.max(8, Math.round((2 * Math.PI * p.r) / SURFACE_SPACING_M));
    for (let s = 0; s < steps; s++) {
      const a = (2 * Math.PI * s) / steps;
      column(p.x + p.r * Math.cos(a), p.y + p.r * Math.sin(a));
    }
  }
  for (let x = -ROOM_HALF_M + FLOOR_SPACING_M; x < ROOM_HALF_M; x += FLOOR_SPACING_M) {
    for (let y = -ROOM_HALF_M + FLOOR_SPACING_M; y < ROOM_HALF_M; y += FLOOR_SPACING_M) {
      out.push({ x, y, z: 0 });
    }
  }
  return out;
}

/** The demo sweep's sequence number: the room is mapped once and holds. */
const DEMO_SWEEP_SEQ = 1;
const DEMO_VOXEL_M = 0.1;

/** One sweep reply: the 24-byte header, then `x, y, z` triples. */
function sweepBody(reset: boolean, points: ReadonlyArray<CloudPoint>): ArrayBuffer {
  const body = new ArrayBuffer(SWEEP_HEADER_BYTES + points.length * 12);
  const view = new DataView(body);
  view.setBigUint64(0, BigInt(DEMO_SWEEP_SEQ), true);
  view.setUint32(8, points.length, true);
  view.setFloat32(12, DEMO_VOXEL_M, true);
  view.setUint32(16, reset ? 1 : 0, true);
  points.forEach((p, i) => {
    const at = SWEEP_HEADER_BYTES + i * 12;
    // The cloud is z-up; the wire is `map_ned`, z down.
    view.setFloat32(at, p.x, true);
    view.setFloat32(at + 4, p.y, true);
    view.setFloat32(at + 8, -p.z, true);
  });
  return body;
}

/** The demo answer to `GET /navigation/sweep?since=<seq>`: the whole room on
 * a first or out-of-date request, an empty delta once the client holds it. */
export function demoSweepReply(since: number | null): ArrayBuffer {
  return since === DEMO_SWEEP_SEQ ? sweepBody(false, []) : sweepBody(true, demoPointCloud());
}
