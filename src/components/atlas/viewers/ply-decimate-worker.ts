/**
 * @module atlas/viewers/ply-decimate-worker
 * @description Web Worker that parses a `.ply` point cloud and decimates it to
 * a point budget, off the main thread. A reconstruction can carry tens of
 * millions of points; parsing and voxel-decimating that on the main thread
 * froze the whole GCS tab (telemetry, video UI and the GCS heartbeat timer)
 * for seconds. The file buffer arrives transferred and the decimated
 * positions and colours go back transferred, so neither side copies them.
 *
 * Bundlers inline this file as a worker chunk when they see the
 * `new Worker(new URL(...), { type: "module" })` form.
 * @license GPL-3.0-only
 */

import { BufferAttribute } from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { decimateCloud, type DecimatedCloud } from "./decimate-cloud";

/** Request: the raw `.ply` bytes and the retained-point budget. */
export interface PlyDecimateRequest {
  buffer: ArrayBuffer;
  budget: number;
}

/** Response: the decimated cloud, or why there is none. */
export type PlyDecimateResponse =
  | { ok: true; cloud: DecimatedCloud }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<PlyDecimateRequest>) => {
  const { buffer, budget } = event.data;
  let response: PlyDecimateResponse;
  const transfer: ArrayBuffer[] = [];
  try {
    const full = new PLYLoader().parse(buffer);
    const posAttr = full.getAttribute("position");
    if (!(posAttr instanceof BufferAttribute)) throw new Error("no positions");
    const colAttr = full.getAttribute("color");
    const colors = colAttr instanceof BufferAttribute ? colAttr.array : null;
    const cloud = decimateCloud(posAttr.array, colors, budget);
    full.dispose();
    response = { ok: true, cloud };
    transfer.push(cloud.positions.buffer as ArrayBuffer);
    if (cloud.colors) transfer.push(cloud.colors.buffer as ArrayBuffer);
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response, { transfer });
};
