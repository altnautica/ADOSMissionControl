/**
 * @module api/reconstruct/world-stream
 * @description The Reconstruct compute node's live stream of one drone
 * (`navigation.map_placement = stream`). The drone streams its scans to the
 * compute node, which paints them at full resolution and once a second sends
 * the changed occupancy tiles and new sweep points on the drone's world
 * stream, `WS /api/plugins/com.altnautica.reconstruct/x/ws/live/<device_id>`
 * on the node's agent. Each binary frame is one msgpack `NodeEvent`
 * `{v, topic, device_id?, payload}` whose `payload` is the topic's own msgpack
 * struct: `reconstruct.live.occupancy` carries `LiveOccupancy` (merged into
 * the drone's live occupancy grid), `reconstruct.live.pointcloud` carries
 * `LivePointCloud` (folded into the node's sweep cloud for the 3D view).
 * Other topics on the stream (reconstruction descriptors) are ignored here.
 *
 * The compute node is the one the drone's capture forwarder resolved
 * (`compute_node_id` of `GET /api/plugins/com.altnautica.capture/x/capture/
 * readiness`), reached like any fleet node through its pairing record or its
 * ground station's relay. No compute node: nothing is dialled. A closed or
 * failed socket is dialled again every {@link WORLD_STREAM_RETRY_MS}, with no
 * cap, for as long as the stream runs.
 *
 * @license GPL-3.0-only
 */

import { decode } from "@msgpack/msgpack";

import type { SweepFrame } from "@/components/drone-detail/map/sweep-cloud";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { parseOccupancyLive, type OccupancyLive } from "@/lib/hud/nav-types";
import { isHttpsOrigin, pluginClientForReach, resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import { isDemoMode } from "@/lib/utils";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useReconstructStreamStore } from "@/stores/reconstruct-stream-store";

export const RECONSTRUCT_PLUGIN_ID = "com.altnautica.reconstruct";
export const CAPTURE_PLUGIN_ID = "com.altnautica.capture";
/** The `NodeEvent` envelope version this reader speaks. */
export const NODE_EVENT_VERSION = 2;
export const LIVE_OCCUPANCY_TOPIC = "reconstruct.live.occupancy";
export const LIVE_POINTCLOUD_TOPIC = "reconstruct.live.pointcloud";
/** Fixed delay before the next dial after a close, a failure or no node. */
export const WORLD_STREAM_RETRY_MS = 2000;

/** One decoded envelope. */
export interface NodeEvent {
  v: number;
  topic: string;
  deviceId: string | null;
  payload: Uint8Array;
}

/** One `LivePointCloud`: `count` map_ned `x, y, z` triples. It carries no
 * reset flag; a changed `voxelM` supersedes the cloud (`applyVoxelDelta`). */
export type LiveCloudFrame = Omit<SweepFrame, "reset">;

export type WorldEvent =
  | { topic: "occupancy"; occupancy: OccupancyLive }
  | { topic: "pointcloud"; cloud: LiveCloudFrame };

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function finite(v: unknown): number | null {
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A msgpack byte payload: `bin`, or an array of byte integers (how serde
 * writes a plain `Vec<u8>`). */
function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (!Array.isArray(v)) return null;
  const out = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const b = v[i];
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255) return null;
    out[i] = b;
  }
  return out;
}

function unpack(bytes: Uint8Array): unknown {
  try {
    return decode(bytes);
  } catch {
    return undefined;
  }
}

/** Decode one envelope, or null when it is malformed or of another version. */
export function decodeNodeEvent(bytes: Uint8Array): NodeEvent | null {
  const raw = unpack(bytes);
  if (!isRec(raw)) return null;
  if (finite(raw.v) !== NODE_EVENT_VERSION || typeof raw.topic !== "string") return null;
  const payload = bytesOf(raw.payload);
  if (!payload) return null;
  const deviceId = typeof raw.device_id === "string" ? raw.device_id : null;
  return { v: NODE_EVENT_VERSION, topic: raw.topic, deviceId, payload };
}

function base64Bytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The shortest decimal that reads back as the same 32-bit float: msgpack
 * carries the node's `f32` sizes as float32, which widen to doubles such as
 * 0.05000000074505806, while the drone's JSON writes the same `f32` as 0.05.
 * Without this the node's 5 cm grid would never equal the drone's.
 */
function shortestF32(v: number): number {
  const f = Math.fround(v);
  for (let p = 1; p <= 9; p++) {
    const s = Number(f.toPrecision(p));
    if (Math.fround(s) === f) return s;
  }
  return f;
}

/** A `LivePointCloud` payload, or null when malformed. */
export function parseLiveCloud(raw: unknown): LiveCloudFrame | null {
  if (!isRec(raw)) return null;
  const seq = finite(raw.seq);
  const voxelM = finite(raw.voxel_m);
  const count = finite(raw.count);
  if (seq === null || voxelM === null || count === null || count < 0) return null;
  const bytes = typeof raw.points_b64 === "string" ? base64Bytes(raw.points_b64) : null;
  if (!bytes || bytes.length < count * 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) points[i] = view.getFloat32(i * 4, true);
  return { seq, voxelM: shortestF32(voxelM), count, points };
}

/**
 * One world-stream frame as a live map event, or null for a malformed frame,
 * another drone's frame, or a topic this reader does not draw.
 */
export function decodeWorldEvent(bytes: Uint8Array, deviceId: string): WorldEvent | null {
  const event = decodeNodeEvent(bytes);
  if (!event || (event.deviceId !== null && event.deviceId !== deviceId)) return null;
  if (event.topic === LIVE_OCCUPANCY_TOPIC) {
    const occupancy = parseOccupancyLive(unpack(event.payload));
    if (!occupancy) return null;
    const resM = occupancy.resM === null ? null : shortestF32(occupancy.resM);
    return { topic: "occupancy", occupancy: { ...occupancy, resM } };
  }
  if (event.topic === LIVE_POINTCLOUD_TOPIC) {
    const cloud = parseLiveCloud(unpack(event.payload));
    return cloud ? { topic: "pointcloud", cloud } : null;
  }
  return null;
}

/** The compute node the drone's capture forwarder resolved, from its
 * readiness reply, or null. */
export function computeNodeIdOf(readiness: unknown): string | null {
  if (!isRec(readiness)) return null;
  const id = readiness.compute_node_id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

/** The plugin path of `deviceId`'s world stream on the compute node. */
export function worldStreamPath(deviceId: string): string {
  return `ws/live/${encodeURIComponent(deviceId)}`;
}

/** The socket surface the stream uses (a `WebSocket` satisfies it). */
export interface WorldSocket {
  binaryType: BinaryType;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  close(): void;
}

export type WorldStreamState = "connecting" | "live" | "unreachable";

export interface WorldStreamDeps {
  /** The compute node's device id, or null when the drone has none. */
  resolveNode(): Promise<string | null>;
  /** A socket to the drone's world stream on `nodeId`, or null when this
   * browser cannot reach the node. */
  dial(nodeId: string): Promise<WorldSocket | null>;
  retryMs?: number;
}

export interface WorldStreamHandlers {
  /** `nodeId` null: the drone has no compute node. */
  onStatus(nodeId: string | null, state: WorldStreamState): void;
  onEvent(event: WorldEvent): void;
}

/** Run `deviceId`'s world stream until the returned stop is called. */
export function runWorldStream(
  deviceId: string,
  deps: WorldStreamDeps,
  handlers: WorldStreamHandlers,
): () => void {
  const retryMs = deps.retryMs ?? WORLD_STREAM_RETRY_MS;
  let stopped = false;
  let socket: WorldSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const retry = () => {
    if (!stopped) timer = setTimeout(() => void attempt(), retryMs);
  };

  const attempt = async () => {
    let nodeId: string | null;
    try {
      nodeId = await deps.resolveNode();
    } catch {
      nodeId = null;
    }
    if (stopped) return;
    if (nodeId === null) {
      handlers.onStatus(null, "connecting");
      retry();
      return;
    }
    handlers.onStatus(nodeId, "connecting");
    let s: WorldSocket | null;
    try {
      s = await deps.dial(nodeId);
    } catch {
      s = null;
    }
    if (stopped) {
      s?.close();
      return;
    }
    if (!s) {
      handlers.onStatus(nodeId, "unreachable");
      retry();
      return;
    }
    const live = nodeId;
    socket = s;
    s.binaryType = "arraybuffer";
    s.onopen = () => handlers.onStatus(live, "live");
    s.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const event = decodeWorldEvent(new Uint8Array(ev.data), deviceId);
      if (event) handlers.onEvent(event);
    };
    s.onclose = () => {
      if (socket !== s) return;
      socket = null;
      if (stopped) return;
      handlers.onStatus(live, "connecting");
      retry();
    };
  };

  void attempt();
  return () => {
    stopped = true;
    clearTimeout(timer);
    const s = socket;
    socket = null;
    s?.close();
  };
}

/** The live dependencies: the drone's readiness through its plugin reach,
 * the compute node's world stream through the node's. A plugin WebSocket
 * cannot ride the HTTPS page's same-origin proxy, so there the node reads
 * unreachable. */
export function liveWorldStreamDeps(droneDeviceId: string): WorldStreamDeps {
  return {
    async resolveNode() {
      const reach = resolveNodeAgentReach(droneDeviceId);
      if (!reach) return null;
      const res = await pluginClientForReach(reach).pluginHttp(CAPTURE_PLUGIN_ID, "capture/readiness");
      if (!res.ok) return null;
      return computeNodeIdOf(await res.json());
    },
    async dial(nodeId) {
      if (isHttpsOrigin()) return null;
      const reach = resolveNodeAgentReach(nodeId);
      if (!reach) return null;
      return pluginClientForReach(reach).openPluginSocket(RECONSTRUCT_PLUGIN_ID, worldStreamPath(droneDeviceId));
    },
  };
}

/**
 * Route one event into the stores: node occupancy tiles merge into the
 * drone's live grid (same 5 cm map_ned tiles as the drone's own), stamped
 * with the grid's current sequence so the node's own counter never reads as
 * a restart of the drone's; sweep points go to the node's cloud.
 */
export function routeWorldEvent(droneId: string, event: WorldEvent): void {
  if (event.topic === "occupancy") {
    const nav = useNavStreamStore.getState();
    const seq = nav.byDrone[droneId]?.occupancy.seq ?? 0;
    nav.mergeOccupancy(droneId, { ...event.occupancy, seq });
  } else {
    useReconstructStreamStore.getState().applyCloud(droneId, event.cloud);
  }
}

/**
 * Start `droneId`'s world stream into the stores; returns its stop, which
 * also clears the drone's stream entry. Demo mode streams from the synthetic
 * compute node.
 */
export function startReconstructStream(droneId: string): () => void {
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const store = useReconstructStreamStore.getState();
  const handlers: WorldStreamHandlers = {
    onStatus: (nodeId, state) =>
      nodeId === null ? store.clear(droneId) : store.setStatus(droneId, nodeId, state),
    onEvent: (event) => routeWorldEvent(droneId, event),
  };
  let stop: (() => void) | null = null;
  let stopped = false;
  if (isDemoMode()) {
    // Loaded on demand so the demo mocks stay out of the production bundle.
    void import("@/mock/mock-world-stream").then(({ demoWorldStreamDeps }) => {
      if (!stopped) stop = runWorldStream(deviceId, demoWorldStreamDeps(deviceId), handlers);
    });
  } else {
    stop = runWorldStream(deviceId, liveWorldStreamDeps(deviceId), handlers);
  }
  return () => {
    stopped = true;
    stop?.();
    store.clear(droneId);
  };
}
