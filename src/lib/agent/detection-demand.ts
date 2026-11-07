"use client";

/**
 * @module agent/detection-demand
 * @description Detection-demand leases Mission Control holds on a drone's
 * cameras. The agent runs its detector on a camera only while some consumer
 * holds a lease on it (`POST /api/vision/demand`). A view that draws detection
 * overlays for a drone camera holds one while it is visible: the lease is
 * renewed every {@link DEMAND_RENEW_MS} for {@link DEMAND_HOLD_S} seconds and
 * released (`hold_s: 0`) when the last view on that camera closes.
 *
 * Leases are shared per (drone, camera): every view in this window counts as
 * one holder of a single lease, so one view closing never drops the lease
 * another view still needs. The call goes over the drone's direct LAN link
 * with its pairing key, the same reach as designate; a drone without one
 * reports `no-link` and holds nothing.
 *
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone, type ResolvedLocalAgent } from "@/lib/agent/resolve-agent";
import { VisionAgentClient, VisionAgentError } from "@/lib/agent/vision-client";

/** Lease renewal period. */
export const DEMAND_RENEW_MS = 2000;
/** Lease length per request: three renewals' worth, so one lost request never
 * drops detection. */
export const DEMAND_HOLD_S = 6;
/** A random hex id, from `getRandomValues` because `randomUUID` needs a
 * secure context and a drone's LAN dashboard link is plain http. */
function instanceId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The lease owner this Mission Control instance identifies as. The agent keeps
 * one lease per owner, so each window (each load of this module) names itself
 * apart: one window releasing its lease never cancels another window's. */
export const DEMAND_OWNER = `mission-control:${instanceId()}`;
/** The agent's primary camera id, the camera a node without a stream list shows. */
export const PRIMARY_CAMERA_ID = "main";

/**
 * Where a lease stands, from the agent's last reply:
 *  - `pending`: first request in flight;
 *  - `detecting`: the agent runs the detector on this camera;
 *  - `idle`: the agent accepted the lease but reports the detector idle;
 *  - `rejected`: the agent refused the camera (400: it does not capture it);
 *  - `unauthorized`: the agent refused the pairing key (401/403), so the key
 *    Mission Control holds for this drone is stale;
 *  - `unsupported`: the agent has no demand endpoint (it detects on every
 *    captured camera without one);
 *  - `no-link`: no direct LAN link to the drone, so no lease can be held;
 *  - `error`: the last request failed (unreachable agent, engine down, any
 *    other refusal).
 */
export type DetectionDemandStatus =
  | "pending"
  | "detecting"
  | "idle"
  | "rejected"
  | "unauthorized"
  | "unsupported"
  | "no-link"
  | "error";

/** What a lease asks the engine to run on its camera. */
export type VisionDemandKind = "detection" | "depth" | "surfaces";

interface Lease {
  droneId: string;
  kind: VisionDemandKind;
  cameraId: string;
  holders: number;
  status: DetectionDemandStatus;
  listeners: Set<(status: DetectionDemandStatus) => void>;
  timer: number | undefined;
  /** The agent the last lease request went to: the release goes there too. */
  agent: ResolvedLocalAgent | null;
  /** The request in flight, so a release is sent after it, never before. */
  inflight: Promise<void>;
}

const leases = new Map<string, Lease>();
/** Releases still on the wire, per lease key. */
const releasing = new Map<string, Promise<void>>();

function leaseKey(droneId: string, cameraId: string, kind: VisionDemandKind): string {
  return `${droneId}\u0000${cameraId}\u0000${kind}`;
}

function keyOf(lease: Lease): string {
  return leaseKey(lease.droneId, lease.cameraId, lease.kind);
}

function setStatus(lease: Lease, status: DetectionDemandStatus): void {
  if (lease.status === status) return;
  lease.status = status;
  for (const fn of lease.listeners) fn(status);
}

async function renew(lease: Lease): Promise<void> {
  if (leases.get(keyOf(lease)) !== lease) return;
  const agent = resolveLocalAgentForDrone(deviceIdFromNodeId(lease.droneId) ?? lease.droneId);
  if (!agent) {
    setStatus(lease, "no-link");
    return;
  }
  lease.agent = agent;
  try {
    const reply = await new VisionAgentClient(agent.agentUrl, agent.apiKey).requestDetection(
      lease.cameraId,
      DEMAND_HOLD_S,
      DEMAND_OWNER,
      lease.kind,
    );
    if (leases.get(keyOf(lease)) !== lease) return;
    setStatus(lease, reply.detecting ? "detecting" : "idle");
  } catch (e) {
    if (leases.get(keyOf(lease)) !== lease) return;
    const status = e instanceof VisionAgentError ? e.status : 0;
    if (status === 404) {
      // An agent without the endpoint never gates detection: stop asking.
      window.clearInterval(lease.timer);
      setStatus(lease, "unsupported");
    } else if (status === 400) {
      setStatus(lease, "rejected");
    } else if (status === 401 || status === 403) {
      setStatus(lease, "unauthorized");
    } else {
      setStatus(lease, "error");
    }
  }
}

function release(lease: Lease): void {
  const key = keyOf(lease);
  window.clearInterval(lease.timer);
  leases.delete(key);
  lease.listeners.clear();
  const done = lease.inflight.then(async () => {
    const agent = lease.agent;
    if (!agent || lease.status === "unsupported") return;
    try {
      await new VisionAgentClient(agent.agentUrl, agent.apiKey).requestDetection(
        lease.cameraId,
        0,
        DEMAND_OWNER,
        lease.kind,
      );
    } catch {
      // The lease runs out on its own within DEMAND_HOLD_S.
    }
  });
  releasing.set(key, done);
  void done.then(() => {
    if (releasing.get(key) === done) releasing.delete(key);
  });
}

/**
 * Hold `kind` (detection by default; the depth and surfaces layers lease
 * `depth` / `surfaces`) on `cameraId` of `droneId` until the returned release
 * runs. `onStatus` receives the current status at once and on every change.
 */
export function holdDetectionDemand(
  droneId: string,
  cameraId: string,
  onStatus: (status: DetectionDemandStatus) => void,
  kind: VisionDemandKind = "detection",
): () => void {
  const key = leaseKey(droneId, cameraId, kind);
  let lease = leases.get(key);
  if (!lease) {
    const created: Lease = {
      droneId,
      cameraId,
      kind,
      holders: 0,
      status: "pending",
      listeners: new Set(),
      timer: undefined,
      agent: null,
      // A lease taken again right after a release renews only once that
      // release landed, so the release never cancels the new lease.
      inflight: releasing.get(key) ?? Promise.resolve(),
    };
    const renewNow = () => {
      created.inflight = created.inflight.then(() => renew(created));
    };
    leases.set(key, created);
    renewNow();
    created.timer = window.setInterval(renewNow, DEMAND_RENEW_MS);
    lease = created;
  }
  const held = lease;
  held.holders += 1;
  held.listeners.add(onStatus);
  onStatus(held.status);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.listeners.delete(onStatus);
    held.holders -= 1;
    if (held.holders <= 0) release(held);
  };
}
