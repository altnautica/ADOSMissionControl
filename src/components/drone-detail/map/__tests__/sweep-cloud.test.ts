/**
 * @license GPL-3.0-only
 *
 * Navigation's sweep reply as the 3D view holds it: the 24-byte header, a
 * delta appended, a reset replacing, and the cap dropping the oldest points.
 */

import { describe, expect, it } from "vitest";

import {
  SWEEP_HEADER_BYTES,
  applySweep,
  emptySweepCloud,
  parseSweep,
  type SweepFrame,
} from "@/components/drone-detail/map/sweep-cloud";

/** A reply as the node encodes it: `seq`, `count`, `voxel_m`, `reset`, then
 * the triples. */
function reply(seq: number, voxelM: number, reset: boolean, triples: number[][]): ArrayBuffer {
  const body = new ArrayBuffer(SWEEP_HEADER_BYTES + triples.length * 12);
  const v = new DataView(body);
  v.setBigUint64(0, BigInt(seq), true);
  v.setUint32(8, triples.length, true);
  v.setFloat32(12, voxelM, true);
  v.setUint32(16, reset ? 1 : 0, true);
  triples.forEach((p, i) => p.forEach((c, j) => v.setFloat32(SWEEP_HEADER_BYTES + i * 12 + j * 4, c, true)));
  return body;
}

const frame = (seq: number, reset: boolean, triples: number[][]): SweepFrame =>
  parseSweep(reply(seq, 0.1, reset, triples))!;

const held = (c: { positions: Float32Array; count: number }) => [...c.positions.subarray(0, c.count * 3)];

describe("parseSweep", () => {
  it("reads the header and the triples", () => {
    const f = parseSweep(reply(9_000_000_001, 0.25, true, [[1, 2, -3]]))!;
    expect(f).toMatchObject({ seq: 9_000_000_001, count: 1, reset: true });
    expect(f.voxelM).toBeCloseTo(0.25);
    expect([...f.points]).toEqual([1, 2, -3]);
  });

  it("refuses a reply shorter than its header or its count", () => {
    expect(parseSweep(new ArrayBuffer(SWEEP_HEADER_BYTES - 1))).toBeNull();
    expect(parseSweep(reply(1, 0.1, false, [[1, 2, 3]]).slice(0, SWEEP_HEADER_BYTES + 6))).toBeNull();
  });
});

describe("applySweep", () => {
  it("appends a delta and replaces on a reset", () => {
    let c = applySweep(emptySweepCloud(), frame(1, true, [[1, 1, 1]]));
    c = applySweep(c, frame(2, false, [[2, 2, 2]]));
    expect(c.seq).toBe(2);
    expect(held(c)).toEqual([1, 1, 1, 2, 2, 2]);
    c = applySweep(c, frame(3, true, [[3, 3, 3]]));
    expect(held(c)).toEqual([3, 3, 3]);
  });

  it("drops the oldest points beyond the cap", () => {
    let c = applySweep(emptySweepCloud(), frame(1, true, [[1, 0, 0], [2, 0, 0]]), 3);
    c = applySweep(c, frame(2, false, [[3, 0, 0], [4, 0, 0]]), 3);
    expect(held(c)).toEqual([2, 0, 0, 3, 0, 0, 4, 0, 0]);
    // One reply larger than the cap keeps its newest points.
    c = applySweep(c, frame(3, false, [[5, 0, 0], [6, 0, 0], [7, 0, 0], [8, 0, 0]]), 3);
    expect(held(c)).toEqual([6, 0, 0, 7, 0, 0, 8, 0, 0]);
  });
});
