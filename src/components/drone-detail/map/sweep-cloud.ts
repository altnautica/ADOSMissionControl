/**
 * @module drone-detail/map/sweep-cloud
 * @description Navigation's live sweep cloud as the Map tab's 3D view holds
 * it. `GET /navigation/sweep?since=<seq>` answers a 24-byte little-endian
 * header (`seq: u64`, `count: u32`, `voxel_m: f32`, `reset: u32`,
 * `reserved: u32`) and `count` `f32` `x, y, z` triples in `map_ned`. A delta
 * is appended; `reset = 1` (the cloud was coarsened or restarted, or `since`
 * fell out of the node's history) replaces what the view holds. The held
 * cloud is capped, dropping its oldest points first. Pure, so the wire and
 * the cap are testable without a canvas.
 *
 * @license GPL-3.0-only
 */

export const SWEEP_HEADER_BYTES = 24;
/** The most points the view holds; the oldest go first beyond it. */
export const SWEEP_MAX_POINTS = 2_000_000;

/** One decoded reply. */
export interface SweepFrame {
  seq: number;
  count: number;
  voxelM: number;
  reset: boolean;
  /** `count` packed `x, y, z` triples. */
  points: Float32Array;
}

/** The cloud the view holds. `positions` may be longer than `count * 3`; only
 * the first `count` triples are points. */
export interface SweepCloud {
  seq: number | null;
  voxelM: number | null;
  positions: Float32Array;
  count: number;
}

export function emptySweepCloud(): SweepCloud {
  return { seq: null, voxelM: null, positions: new Float32Array(0), count: 0 };
}

/** Decode one reply, or null when it is shorter than its header says. */
export function parseSweep(body: ArrayBuffer): SweepFrame | null {
  if (body.byteLength < SWEEP_HEADER_BYTES) return null;
  const view = new DataView(body);
  const seq = Number(view.getBigUint64(0, true));
  const count = view.getUint32(8, true);
  const voxelM = view.getFloat32(12, true);
  const reset = view.getUint32(16, true) === 1;
  const end = SWEEP_HEADER_BYTES + count * 12;
  if (body.byteLength < end) return null;
  // A copy, so the reply body is not kept alive.
  const points = new Float32Array(body.slice(SWEEP_HEADER_BYTES, end));
  return { seq, count, voxelM, reset, points };
}

/** Fold one reply into the held cloud, keeping at most `max` points. */
export function applySweep(
  cloud: SweepCloud,
  frame: SweepFrame,
  max: number = SWEEP_MAX_POINTS,
): SweepCloud {
  const held = frame.reset ? 0 : cloud.count;
  const incoming = Math.min(frame.count, max);
  const skipIncoming = frame.count - incoming;
  const survivors = Math.min(held, max - incoming);
  const dropHeld = held - survivors;
  const count = survivors + incoming;
  let positions = cloud.positions;
  if (frame.reset || positions.length < count * 3) {
    const capacity = Math.min(max, Math.max(count, cloud.count * 2, 1024));
    const next = new Float32Array(capacity * 3);
    next.set(positions.subarray(dropHeld * 3, held * 3));
    positions = next;
  } else if (dropHeld > 0) {
    positions.copyWithin(0, dropHeld * 3, held * 3);
  }
  positions.set(frame.points.subarray(skipIncoming * 3, frame.count * 3), survivors * 3);
  return { seq: frame.seq, voxelM: frame.voxelM, positions, count };
}

/** Fold a delta that carries no reset flag (the compute node's live cloud):
 * a changed voxel means the cloud was coarsened and every earlier delta is
 * superseded. */
export function applyVoxelDelta(
  cloud: SweepCloud,
  frame: Omit<SweepFrame, "reset">,
  max: number = SWEEP_MAX_POINTS,
): SweepCloud {
  const reset = cloud.voxelM !== null && cloud.voxelM !== frame.voxelM;
  return applySweep(cloud, { ...frame, reset }, max);
}
