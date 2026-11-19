/**
 * @module mock/mock-world-stream
 * @description The demo compute node's live stream of the demo drone: the
 * demo workstation streams one `reconstruct.live.occupancy` and one
 * `reconstruct.live.pointcloud` event per second, msgpack-framed exactly as
 * the node sends them (`NodeEvent` with the payload as a byte array), so the
 * Map tab reads them through the same decoder as a real node. Occupancy
 * tiles cycle through the demo room; the sweep points arrive in chunks until
 * the room is out, then only occupancy follows, as a node with nothing new
 * sends.
 *
 * @license GPL-3.0-only
 */

import { encode } from "@msgpack/msgpack";

import {
  LIVE_OCCUPANCY_TOPIC,
  LIVE_POINTCLOUD_TOPIC,
  NODE_EVENT_VERSION,
  type WorldSocket,
  type WorldStreamDeps,
} from "@/lib/api/reconstruct/world-stream";
import { DEMO_WORKSTATION } from "./drones";
import { demoPointCloud, type CloudPoint } from "./mock-live-map";
import {
  OCC_RES_M,
  OCC_TILE_CELLS,
  canvasGreyPngEncoder,
  tileGrey,
  tileRevealOrder,
  type GreyPngEncoder,
} from "./mock-occupancy";

export const DEMO_STREAM_PERIOD_MS = 1000;
/** The demo room's sweep arrives over this many events. */
export const DEMO_CLOUD_CHUNKS = 20;
const DEMO_NODE_VOXEL_M = 0.05;

/** One msgpack `NodeEvent` frame. */
export function demoNodeEvent(topic: string, deviceId: string, payload: unknown): Uint8Array {
  return encode({ v: NODE_EVENT_VERSION, topic, device_id: deviceId, payload: Array.from(encode(payload)) });
}

function pointsB64(points: ReadonlyArray<CloudPoint>): string {
  const view = new DataView(new ArrayBuffer(points.length * 12));
  points.forEach((p, i) => {
    // The cloud is z-up; the wire is `map_ned`, z down.
    view.setFloat32(i * 12, p.x, true);
    view.setFloat32(i * 12 + 4, p.y, true);
    view.setFloat32(i * 12 + 8, -p.z, true);
  });
  let bin = "";
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** The demo node's frames, one tick at a time. */
export class DemoWorldFrames {
  private tick = 0;
  private occSeq = 0;
  private cloudSeq = 0;
  private readonly tiles = tileRevealOrder();
  private readonly cloud = demoPointCloud();

  constructor(
    private readonly deviceId: string,
    private readonly encodePng: GreyPngEncoder = canvasGreyPngEncoder,
  ) {}

  /** The frames due on the next tick. */
  next(): Uint8Array[] {
    const out: Uint8Array[] = [];
    const [ix, iy] = this.tiles[this.tick % this.tiles.length];
    const png = this.encodePng(tileGrey(ix, iy), OCC_TILE_CELLS, OCC_TILE_CELLS);
    if (png !== null) {
      this.occSeq++;
      out.push(
        demoNodeEvent(LIVE_OCCUPANCY_TOPIC, this.deviceId, {
          kind: "live",
          seq: this.occSeq,
          frame: "map_ned",
          res_m: OCC_RES_M,
          tile_cells: OCC_TILE_CELLS,
          tiles: [{ ix, iy, png_b64: png }],
        }),
      );
    }
    if (this.tick < DEMO_CLOUD_CHUNKS) {
      const size = Math.ceil(this.cloud.length / DEMO_CLOUD_CHUNKS);
      const chunk = this.cloud.slice(this.tick * size, (this.tick + 1) * size);
      if (chunk.length > 0) {
        this.cloudSeq++;
        out.push(
          demoNodeEvent(LIVE_POINTCLOUD_TOPIC, this.deviceId, {
            kind: "live",
            seq: this.cloudSeq,
            frame: "map_ned",
            voxel_m: DEMO_NODE_VOXEL_M,
            count: chunk.length,
            points_b64: pointsB64(chunk),
          }),
        );
      }
    }
    this.tick++;
    return out;
  }
}

/** A socket that delivers the demo node's frames once a second. */
class DemoWorldSocket implements WorldSocket {
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly opening: ReturnType<typeof setTimeout>;

  constructor(frames: DemoWorldFrames) {
    this.opening = setTimeout(() => {
      this.onopen?.(new Event("open"));
      const emit = () => {
        for (const f of frames.next()) {
          const data = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
          this.onmessage?.(new MessageEvent("message", { data }));
        }
      };
      emit();
      this.timer = setInterval(emit, DEMO_STREAM_PERIOD_MS);
    }, 0);
  }

  close(): void {
    clearTimeout(this.opening);
    clearInterval(this.timer);
    this.onclose?.(new CloseEvent("close"));
  }
}

/** The demo drone's compute node is the demo workstation. */
export function demoWorldStreamDeps(deviceId: string): WorldStreamDeps {
  return {
    resolveNode: async () => DEMO_WORKSTATION.deviceId,
    dial: async () => new DemoWorldSocket(new DemoWorldFrames(deviceId)),
  };
}
