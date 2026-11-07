/**
 * @module cockpit/layers/view-lease
 * @description The nav-stream view lease. The agent computes the `ar`,
 * `obstacles`, `depth` and `surfaces` frames only for the cameras and layers
 * some client is watching. A client names what it shows by sending
 * `{"type":"view","camera_id","layers":[…]}` on `WS /api/v1/nav/stream`
 * whenever that set changes, and again every {@link VIEW_LEASE_RENEW_MS}; the
 * agent drops a lease it has not heard about for 6 s.
 *
 * Every on-screen view in this window holds a lease through
 * {@link holdViewLease}; the leases are merged per (drone, camera) into one
 * message, so two views on the same camera cost the agent one computation.
 * A camera whose last holder releases is sent once with an empty layer list,
 * so the agent stops at once instead of waiting out the expiry.
 *
 * @license GPL-3.0-only
 */

/** Layers the agent computes on demand. */
export type LeasedLayer = "ar_route" | "ar_motion" | "obstacles" | "depth" | "surfaces";

export const LEASED_LAYERS: readonly LeasedLayer[] = [
  "ar_route",
  "ar_motion",
  "obstacles",
  "depth",
  "surfaces",
];

/** Renewal period; the agent's lease expires after three of these. */
export const VIEW_LEASE_RENEW_MS = 2000;

export interface ViewLeaseHandle {
  /** Replace the camera and layer set this holder watches. */
  update: (cameraId: string, layers: readonly LeasedLayer[]) => void;
  release: () => void;
}

interface Holder {
  cameraId: string;
  layers: readonly LeasedLayer[];
}

interface DroneLeases {
  holders: Set<Holder>;
  /** The last message sent per camera, so an unchanged union is not resent
   * between renewals. */
  sent: Map<string, string>;
  send: ((text: string) => void) | null;
  timer: ReturnType<typeof setInterval> | undefined;
}

const drones = new Map<string, DroneLeases>();

function entry(droneId: string): DroneLeases {
  let d = drones.get(droneId);
  if (!d) {
    d = { holders: new Set(), sent: new Map(), send: null, timer: undefined };
    drones.set(droneId, d);
  }
  return d;
}

/** The merged demand per camera: `camera_id → layers`, in {@link LEASED_LAYERS} order. */
export function viewDemand(droneId: string): Map<string, LeasedLayer[]> {
  const out = new Map<string, LeasedLayer[]>();
  const d = drones.get(droneId);
  if (!d) return out;
  const sets = new Map<string, Set<LeasedLayer>>();
  for (const h of d.holders) {
    let s = sets.get(h.cameraId);
    if (!s) {
      s = new Set();
      sets.set(h.cameraId, s);
    }
    for (const l of h.layers) s.add(l);
  }
  for (const [cam, s] of sets) out.set(cam, LEASED_LAYERS.filter((l) => s.has(l)));
  return out;
}

function message(cameraId: string, layers: readonly LeasedLayer[]): string {
  return JSON.stringify({ type: "view", camera_id: cameraId, layers });
}

/** Send the merged demand. `force` resends unchanged cameras (renewal, new socket). */
function flush(droneId: string, force: boolean): void {
  const d = drones.get(droneId);
  if (!d) return;
  const demand = viewDemand(droneId);
  for (const [cam, layers] of demand) {
    const text = message(cam, layers);
    if (force || d.sent.get(cam) !== text) {
      d.send?.(text);
      d.sent.set(cam, text);
    }
  }
  // Cameras nobody watches any more: one empty lease, then forget them.
  for (const cam of [...d.sent.keys()]) {
    if (demand.has(cam)) continue;
    d.send?.(message(cam, []));
    d.sent.delete(cam);
  }
  if (d.holders.size === 0) {
    clearInterval(d.timer);
    d.timer = undefined;
    if (!d.send) drones.delete(droneId);
  } else if (d.timer === undefined) {
    d.timer = setInterval(() => flush(droneId, true), VIEW_LEASE_RENEW_MS);
  }
}

/**
 * The nav stream for `droneId` opened (`send`) or closed (null). A new socket
 * gets the whole current demand at once.
 */
export function setViewLeaseSender(droneId: string, send: ((text: string) => void) | null): void {
  const d = entry(droneId);
  d.send = send;
  d.sent.clear();
  if (send) flush(droneId, true);
  else if (d.holders.size === 0) {
    clearInterval(d.timer);
    drones.delete(droneId);
  }
}

/** Hold a view lease on `cameraId` of `droneId` until `release`. */
export function holdViewLease(
  droneId: string,
  cameraId: string,
  layers: readonly LeasedLayer[],
): ViewLeaseHandle {
  const d = entry(droneId);
  const holder: Holder = { cameraId, layers };
  d.holders.add(holder);
  flush(droneId, false);
  let released = false;
  return {
    update: (cam, next) => {
      if (released) return;
      if (cam === holder.cameraId && next.length === holder.layers.length && next.every((l, i) => l === holder.layers[i])) {
        return;
      }
      holder.cameraId = cam;
      holder.layers = next;
      flush(droneId, false);
    },
    release: () => {
      if (released) return;
      released = true;
      d.holders.delete(holder);
      flush(droneId, false);
    },
  };
}
