/**
 * @license GPL-3.0-only
 *
 * The Reconstruct compute node's world stream: the msgpack `NodeEvent`
 * framing and both live topics, decoded from frames the node's own encoder
 * produced; routing into the stores; and the dial loop (no node, unreachable
 * node, a close re-dialled after the fixed retry).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "@msgpack/msgpack";

import { applyVoxelDelta, emptySweepCloud } from "@/components/drone-detail/map/sweep-cloud";
import {
  LIVE_OCCUPANCY_TOPIC,
  WORLD_STREAM_RETRY_MS,
  computeNodeIdOf,
  decodeNodeEvent,
  decodeWorldEvent,
  routeWorldEvent,
  runWorldStream,
  worldStreamPath,
  type WorldSocket,
  type WorldStreamState,
} from "@/lib/api/reconstruct/world-stream";
import { DemoWorldFrames, demoNodeEvent } from "@/mock/mock-world-stream";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useReconstructStreamStore } from "@/stores/reconstruct-stream-store";

/** `NodeEvent::encode` of a `LiveOccupancy` (seq 7, one tile at (-1, 2)) for
 * `drone-1`, as the compute node sends it (payload as a byte array). */
const OCCUPANCY_FRAME =
  "84a17602a5746f706963ba7265636f6e7374727563742e6c6976652e6f63637570616e6379a96465766963655f6964a764726f6e652d31a77061796c6f6164dc005acc86cca46b696e64cca46c697665cca373657107cca56672616d65cca76d61705f6e6564cca57265735f6dccca3d4ccccccccdccaa74696c655f63656c6c7340cca574696c6573cc91cc83cca26978ccffcca2697902cca7706e675f623634ccac6956424f5277304b47676f3d";
/** `NodeEvent::encode` of a `LivePointCloud` (seq 3, voxel 0.05, two points
 * (1, 2, -0.5) and (4, 5, 6.25)) for `drone-1`. */
const POINTCLOUD_FRAME =
  "84a17602a5746f706963bb7265636f6e7374727563742e6c6976652e706f696e74636c6f7564a96465766963655f6964a764726f6e652d31a77061796c6f6164dc005fcc86cca46b696e64cca46c697665cca373657103cca56672616d65cca76d61705f6e6564cca7766f78656c5f6dccca3d4ccccccccdcca5636f756e7402ccaa706f696e74735f623634ccd9204141434150774141414541414141432f41414341514141416f454141414d6841";

function hex(s: string): Uint8Array {
  return new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

describe("world stream decoding", () => {
  it("decodes the envelope with its byte-array payload", () => {
    const e = decodeNodeEvent(hex(OCCUPANCY_FRAME));
    expect(e).toMatchObject({ v: 2, topic: LIVE_OCCUPANCY_TOPIC, deviceId: "drone-1" });
    expect(e!.payload.length).toBe(90);
  });

  it("reads reconstruct.live.occupancy as live occupancy tiles", () => {
    const e = decodeWorldEvent(hex(OCCUPANCY_FRAME), "drone-1");
    expect(e?.topic).toBe("occupancy");
    if (e?.topic !== "occupancy") return;
    expect(e.occupancy).toMatchObject({ seq: 7, frame: "map_ned", tileCells: 64 });
    // The node's f32 0.05 reads as the drone's JSON writes it, so the grids match.
    expect(e.occupancy.resM).toBe(0.05);
    expect(e.occupancy.tiles).toEqual([{ ix: -1, iy: 2, pngB64: "iVBORw0KGgo=" }]);
  });

  it("reads reconstruct.live.pointcloud as map_ned triples", () => {
    const e = decodeWorldEvent(hex(POINTCLOUD_FRAME), "drone-1");
    expect(e?.topic).toBe("pointcloud");
    if (e?.topic !== "pointcloud") return;
    expect(e.cloud.seq).toBe(3);
    expect(e.cloud.count).toBe(2);
    expect(e.cloud.voxelM).toBe(0.05);
    expect(Array.from(e.cloud.points)).toEqual([1, 2, -0.5, 4, 5, 6.25]);
  });

  it("drops another drone's frame, another envelope version, other topics and garbage", () => {
    expect(decodeWorldEvent(hex(OCCUPANCY_FRAME), "drone-2")).toBeNull();
    const v1 = encode({ v: 1, topic: LIVE_OCCUPANCY_TOPIC, payload: [] });
    expect(decodeNodeEvent(v1)).toBeNull();
    expect(decodeWorldEvent(demoNodeEvent("reconstruct.splat", "drone-1", { generation: 1 }), "drone-1")).toBeNull();
    expect(decodeWorldEvent(new Uint8Array([0xc1, 0x00]), "drone-1")).toBeNull();
  });

  it("accepts a bin payload too", () => {
    const payload = encode({ kind: "live", seq: 1, frame: "map_ned", res_m: 0.05, tile_cells: 64, tiles: [] });
    const frame = encode({ v: 2, topic: LIVE_OCCUPANCY_TOPIC, payload });
    expect(decodeWorldEvent(frame, "drone-1")?.topic).toBe("occupancy");
  });

  it("supersedes the held cloud when the node coarsens it", () => {
    const pts = new Float32Array([1, 2, 3]);
    let cloud = applyVoxelDelta(emptySweepCloud(), { seq: 1, voxelM: 0.05, count: 1, points: pts });
    cloud = applyVoxelDelta(cloud, { seq: 2, voxelM: 0.05, count: 1, points: pts });
    expect(cloud.count).toBe(2);
    cloud = applyVoxelDelta(cloud, { seq: 3, voxelM: 0.1, count: 1, points: pts });
    expect(cloud.count).toBe(1);
  });

  it("reads the forwarder's compute node from the readiness reply", () => {
    expect(computeNodeIdOf({ compute_node_id: "forge-1" })).toBe("forge-1");
    expect(computeNodeIdOf({ compute_node_id: null })).toBeNull();
    expect(computeNodeIdOf({ compute_node_id: "  " })).toBeNull();
    expect(worldStreamPath("drone 1")).toBe("ws/live/drone%201");
  });

  it("decodes the demo node's frames", () => {
    const frames = new DemoWorldFrames("demo-1", () => "iVBORw0KGgo=").next();
    const topics = frames.map((f) => decodeWorldEvent(f, "demo-1")?.topic);
    expect(topics).toEqual(["occupancy", "pointcloud"]);
  });
});

describe("routing", () => {
  const DRONE = "node:route-test";
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useReconstructStreamStore.getState().clear(DRONE);
  });

  it("merges node tiles into the drone's grid without reading as a restart", () => {
    const nav = useNavStreamStore.getState();
    nav.mergeOccupancy(DRONE, {
      seq: 40,
      frame: "map_ned",
      resM: 0.05,
      tileCells: 64,
      tiles: [{ ix: 0, iy: 0, pngB64: "a" }],
    });
    const e = decodeWorldEvent(hex(OCCUPANCY_FRAME), "drone-1")!;
    routeWorldEvent(DRONE, e);
    const grid = useNavStreamStore.getState().byDrone[DRONE].occupancy;
    expect(Object.keys(grid.tiles).sort()).toEqual(["-1,2", "0,0"]);
    expect(grid.seq).toBe(40);
  });

  it("folds node points into the drone's stream entry", () => {
    useReconstructStreamStore.getState().setStatus(DRONE, "forge-1", "live");
    routeWorldEvent(DRONE, decodeWorldEvent(hex(POINTCLOUD_FRAME), "drone-1")!);
    expect(useReconstructStreamStore.getState().byDrone[DRONE].cloud.count).toBe(2);
  });
});

class FakeSocket implements WorldSocket {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event("open"));
  }
  deliver(bytes: Uint8Array) {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  drop() {
    this.onclose?.(new CloseEvent("close"));
  }
}

describe("runWorldStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(node: string | null, sockets: Array<FakeSocket | null>) {
    const statuses: Array<[string | null, WorldStreamState]> = [];
    const events: string[] = [];
    const dial = vi.fn(async () => sockets.shift() ?? null);
    const stop = runWorldStream(
      "drone-1",
      { resolveNode: async () => node, dial },
      {
        onStatus: (n, s) => statuses.push([n, s]),
        onEvent: (e) => events.push(e.topic),
      },
    );
    return { statuses, events, dial, stop };
  }

  it("dials the node, reads frames, and dials again after a close", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const h = harness("forge-1", [first, second]);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.binaryType).toBe("arraybuffer");
    first.open();
    first.deliver(hex(OCCUPANCY_FRAME));
    first.deliver(hex(POINTCLOUD_FRAME));
    expect(h.events).toEqual(["occupancy", "pointcloud"]);
    first.drop();
    await vi.advanceTimersByTimeAsync(WORLD_STREAM_RETRY_MS - 1);
    expect(h.dial).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.dial).toHaveBeenCalledTimes(2);
    expect(h.statuses).toEqual([
      ["forge-1", "connecting"],
      ["forge-1", "live"],
      ["forge-1", "connecting"],
      ["forge-1", "connecting"],
    ]);
    h.stop();
    expect(second.closed).toBe(true);
  });

  it("dials nothing without a compute node and keeps asking", async () => {
    const h = harness(null, []);
    await vi.advanceTimersByTimeAsync(WORLD_STREAM_RETRY_MS * 3);
    expect(h.dial).not.toHaveBeenCalled();
    expect(h.statuses.every(([n]) => n === null)).toBe(true);
    expect(h.statuses.length).toBe(4);
    h.stop();
  });

  it("reports a node it cannot reach and retries without a cap", async () => {
    const h = harness("forge-1", []);
    await vi.advanceTimersByTimeAsync(WORLD_STREAM_RETRY_MS * 10);
    expect(h.dial).toHaveBeenCalledTimes(11);
    expect(h.statuses.at(-1)).toEqual(["forge-1", "unreachable"]);
    h.stop();
  });
});
