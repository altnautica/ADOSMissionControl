"use client";

/**
 * @module RelayedDroneBridge
 * @description Transitively enrolls a WFB-linked drone as its own first-class
 * node when the GCS pairs with the ground agent only. For each directly-paired
 * ground node that reports a WFB peer, this upserts `"relayed"` presence for
 * `node:<peerDeviceId>` (with `reachedVia` naming the ground node) into the
 * canonical registry, and — for a drone that is NOT also paired directly —
 * re-registers the funneled feed under the drone node so the drone's stream
 * shows under the DRONE, not the ground station.
 *
 * The ground-node list is read from the directly-paired stores (pairing +
 * local), NOT the registry, so this bridge's own relayed writes never
 * re-trigger it. The peer data comes from `command-fleet-store` (the scalar
 * peer today, the `linkedPeers[]` list once agents ship it). A later direct
 * pair of the same drone merges onto the same `node:<deviceId>` row — the
 * transitive row upgrades in place (DEC-187 dedup); the direct source takes
 * reach precedence and this bridge stops owning the funneled status.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { usePairingStore } from "@/stores/pairing-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import {
  useCommandFleetStore,
  type CommandCloudStatus,
} from "@/stores/command-fleet-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import { linkStateReach } from "@/components/hardware/radio/labels";
import {
  planRelayedEnrollment,
  type RelayGroundNode,
} from "@/lib/agent/relayed-peers";

/** True only when the node's WFB link is verified up (frames confirmed
 * received). A missing or unproven radio block is NOT up (Rule 44). */
function radioUpFor(status: CommandCloudStatus | undefined): boolean {
  const radio = status?.radio ? normalizeRadio(status.radio) : null;
  return radio != null && linkStateReach(radio.state) === "up";
}

/** The funneled fields this bridge owns on a relayed drone's status row. A write
 * is skipped when they already match, so the bridge's own writes do not loop. */
function funneledDiffers(
  existing: CommandCloudStatus | undefined,
  next: CommandCloudStatus,
): boolean {
  if (!existing) return true;
  return (
    existing.videoState !== next.videoState ||
    existing.videoWhepUrl !== next.videoWhepUrl ||
    existing.peerDeviceId !== next.peerDeviceId ||
    existing.peerRssiDbm !== next.peerRssiDbm ||
    existing.updatedAt !== next.updatedAt
  );
}

export function RelayedDroneBridge() {
  // nodeIds this bridge currently owns relayed presence for, and deviceIds it
  // owns a funneled status row for, so it can drop them when a peer disappears.
  const ownedNodeIds = useRef<Set<string>>(new Set());
  const ownedStatusIds = useRef<Set<string>>(new Set());

  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);

  useEffect(() => {
    // Every device the GCS reaches directly (cloud + LAN). A relayed peer that
    // is also directly paired keeps its own bridge-owned status.
    const directDeviceIds = new Set<string>();
    for (const d of pairedDrones) directDeviceIds.add(d.deviceId);
    for (const n of localNodes) directDeviceIds.add(n.deviceId);

    // Ground nodes = directly-paired ground-station-profile nodes.
    const groundNodes: RelayGroundNode[] = [];
    const seenGs = new Set<string>();
    const addGs = (deviceId: string, profile: string | undefined) => {
      if (profile !== "ground-station") return;
      if (seenGs.has(deviceId)) return;
      seenGs.add(deviceId);
      const status = cloudStatuses[deviceId];
      groundNodes.push({
        deviceId,
        nodeId: nodeIdForDevice(deviceId),
        status,
        radioUp: radioUpFor(status),
      });
    };
    for (const d of pairedDrones) addGs(d.deviceId, d.profile);
    for (const n of localNodes) addGs(n.deviceId, n.profile);

    const enrollments = planRelayedEnrollment({
      groundNodes,
      directlyPairedDeviceIds: directDeviceIds,
      now: Date.now(),
    });

    const registry = useNodeRegistryStore.getState();
    const fleet = useCommandFleetStore.getState();
    const nextNodeIds = new Set<string>();
    const nextStatusIds = new Set<string>();
    const funneledRows: CommandCloudStatus[] = [];

    for (const e of enrollments) {
      nextNodeIds.add(e.nodeId);
      // Skip an unchanged presence upsert so a self-triggered re-run does not
      // churn the registry.
      const entry = registry.getEntry(e.nodeId);
      const presenceUnchanged =
        entry?.presence.sources.includes("relayed") &&
        entry.presence.reachedVia === e.reachedVia &&
        entry.presence.lastHeartbeat >= e.lastHeartbeat;
      if (!presenceUnchanged) {
        registry.upsertPresence(
          e.nodeId,
          {
            deviceId: e.deviceId,
            name: `Agent ${e.deviceId.slice(0, 8)}`,
            profile: "drone",
            reachedVia: e.reachedVia,
            lastHeartbeat: e.lastHeartbeat,
          },
          "relayed",
        );
      }

      if (e.funneledStatus) {
        nextStatusIds.add(e.deviceId);
        const existing = fleet.cloudStatuses[e.deviceId];
        const merged: CommandCloudStatus = {
          ...(existing ?? { deviceId: e.deviceId }),
          ...e.funneledStatus,
        };
        if (funneledDiffers(existing, merged)) funneledRows.push(merged);
      }
    }

    if (funneledRows.length > 0) fleet.upsertCloudStatuses(funneledRows);

    // Drop relayed presence for peers no longer reported.
    for (const nodeId of ownedNodeIds.current) {
      if (!nextNodeIds.has(nodeId)) registry.dropPresence(nodeId, "relayed");
    }
    // Remove funneled status rows we own that are no longer relayed-only. A row
    // that graduated to a direct pair is left for its own bridge to own.
    const removed = Array.from(ownedStatusIds.current).filter(
      (id) => !nextStatusIds.has(id) && !directDeviceIds.has(id),
    );
    if (removed.length > 0) fleet.removeCloudStatuses(removed);

    ownedNodeIds.current = nextNodeIds;
    ownedStatusIds.current = nextStatusIds;
  }, [pairedDrones, localNodes, cloudStatuses]);

  useEffect(() => {
    const nodeIds = ownedNodeIds.current;
    const statusIds = ownedStatusIds.current;
    return () => {
      const registry = useNodeRegistryStore.getState();
      const fleet = useCommandFleetStore.getState();
      for (const nodeId of nodeIds) registry.dropPresence(nodeId, "relayed");
      if (statusIds.size > 0) fleet.removeCloudStatuses(Array.from(statusIds));
      nodeIds.clear();
      statusIds.clear();
    };
  }, []);

  return null;
}
