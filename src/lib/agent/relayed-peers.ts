/**
 * @module agent/relayed-peers
 * @description Pure logic for transitive node enrollment: given the
 * directly-paired ground nodes and their reported WFB peers, decide which
 * drones to enroll as `"relayed"` registry nodes and what funneled-feed status
 * to register for each.
 *
 * The field case: the GCS pairs with the ground agent only, but that ground
 * agent is WFB-paired to a drone. The drone must appear as its own first-class
 * node reached "through" the ground node. The trigger data — the peer id (and,
 * once agents ship it, the `linkedPeers[]` list) — already rides the ground
 * node's heartbeat; this module turns it into enrollment intents.
 *
 * Pure and side-effect-free so the enrollment, the funneled-feed gating, the
 * dedupe against a direct pair, and the drop-when-no-longer-relayed are unit
 * testable without any store or React state. The bridge is a thin effect that
 * reads the stores, calls this, and applies the intents.
 *
 * @license GPL-3.0-only
 */

import type {
  CommandCloudStatus,
  LinkedPeer,
} from "@/stores/command-fleet-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { resolveAgentVideoUrl } from "@/lib/agent/video-url";

/** A directly-paired ground node that may be relaying drones. */
export interface RelayGroundNode {
  /** The ground node's agent device id. */
  deviceId: string;
  /** The ground node's canonical `node:<deviceId>` id (the reach hop). */
  nodeId: string;
  /** The ground node's live status (peer, video, radio, freshness), if any. */
  status: CommandCloudStatus | undefined;
  /** True only when the ground node's WFB link is VERIFIED up. Gates the
   * funneled video honestly (Rule 44 — a down/unproven link shows no feed). */
  radioUp: boolean;
}

/** One enrollment intent for a WFB-linked drone reached through a ground node. */
export interface RelayedEnrollment {
  /** `node:<peerDeviceId>` — the drone's canonical node id. */
  nodeId: string;
  /** The drone's agent device id. */
  deviceId: string;
  /** `node:<groundDeviceId>` — the ground node this drone is linked through. */
  reachedVia: string;
  /** Epoch ms of the freshest relay observation (drives the node's liveness). */
  lastHeartbeat: number;
  /** WFB RSSI the ground node heard this drone at, in dBm. Null when unknown. */
  peerRssiDbm: number | null;
  /**
   * The funneled-feed status to register under the DRONE node, or undefined
   * when the drone is ALSO paired directly (its own bridge owns the status, so
   * the relay must not clobber the direct video/telemetry). The row carries the
   * drone's peer (the ground node) and — only while the ground link is up — the
   * funneled WHEP feed the ground node relays, so the drone's stream shows under
   * the drone, not the ground station.
   */
  funneledStatus?: CommandCloudStatus;
}

/**
 * The WFB peers a node reports, preferring the `linkedPeers[]` list (a ground
 * node can relay more than one drone) and falling back to the scalar
 * `peerDeviceId`/`peerRssiDbm` until every agent ships the list. Entries with no
 * device id are dropped.
 */
export function extractLinkedPeers(
  status: CommandCloudStatus | undefined,
): LinkedPeer[] {
  if (!status) return [];
  if (Array.isArray(status.linkedPeers) && status.linkedPeers.length > 0) {
    return status.linkedPeers.filter(
      (p): p is LinkedPeer =>
        typeof p?.deviceId === "string" && p.deviceId.length > 0,
    );
  }
  const id = status.peerDeviceId;
  if (typeof id === "string" && id.length > 0) {
    return [{ deviceId: id, rssiDbm: status.peerRssiDbm ?? null }];
  }
  return [];
}

/** Build the funneled-feed status row for a relayed-only drone. Honest: the
 * feed is present only while the ground node's WFB link is verified up (Rule 44),
 * and it points at the ground node's own WHEP (the drone has no direct reach). */
function funneledStatusFor(args: {
  droneDeviceId: string;
  groundDeviceId: string;
  peerRssiDbm: number | null;
  groundStatus: CommandCloudStatus | undefined;
  radioUp: boolean;
  updatedAt: number;
}): CommandCloudStatus {
  const { droneDeviceId, groundDeviceId, peerRssiDbm, groundStatus, radioUp, updatedAt } =
    args;
  const funneledUrl = radioUp ? resolveAgentVideoUrl(groundStatus) : null;
  return {
    deviceId: droneDeviceId,
    // The drone's WFB peer IS the ground node it reaches through.
    peerDeviceId: groundDeviceId,
    peerRssiDbm,
    // Only surface the funneled video while the link is proven up and the
    // ground node is actually serving it; otherwise the drone shows no feed.
    videoState: funneledUrl ? "running" : undefined,
    videoWhepUrl: funneledUrl ?? undefined,
    updatedAt,
  };
}

/**
 * Plan the transitive enrollments for a set of ground nodes. One intent per
 * distinct relayed drone (the first ground node that reports a peer wins when
 * two report the same drone). A drone that is also directly paired still gets a
 * relay intent (so the row carries both reaches) but no funneled status.
 */
export function planRelayedEnrollment(args: {
  groundNodes: RelayGroundNode[];
  /** Device ids the GCS pairs with directly (cloud + LAN). */
  directlyPairedDeviceIds: ReadonlySet<string>;
  now: number;
}): RelayedEnrollment[] {
  const { groundNodes, directlyPairedDeviceIds, now } = args;
  const enrollments: RelayedEnrollment[] = [];
  const seen = new Set<string>();

  for (const gs of groundNodes) {
    const peers = extractLinkedPeers(gs.status);
    for (const peer of peers) {
      const droneDeviceId = peer.deviceId;
      // Guard self-reference and duplicates across ground nodes.
      if (!droneDeviceId || droneDeviceId === gs.deviceId) continue;
      if (seen.has(droneDeviceId)) continue;
      seen.add(droneDeviceId);

      const lastHeartbeat =
        (typeof peer.seenAtUnix === "number" && Number.isFinite(peer.seenAtUnix)
          ? peer.seenAtUnix * 1000
          : undefined) ??
        gs.status?.updatedAt ??
        now;
      const peerRssiDbm =
        typeof peer.rssiDbm === "number" && Number.isFinite(peer.rssiDbm)
          ? peer.rssiDbm
          : null;
      const direct = directlyPairedDeviceIds.has(droneDeviceId);

      enrollments.push({
        nodeId: nodeIdForDevice(droneDeviceId),
        deviceId: droneDeviceId,
        reachedVia: gs.nodeId,
        lastHeartbeat,
        peerRssiDbm,
        funneledStatus: direct
          ? undefined
          : funneledStatusFor({
              droneDeviceId,
              groundDeviceId: gs.deviceId,
              peerRssiDbm,
              groundStatus: gs.status,
              radioUp: gs.radioUp,
              updatedAt: lastHeartbeat,
            }),
      });
    }
  }

  return enrollments;
}
