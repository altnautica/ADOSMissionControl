"use client";

/**
 * @module LocalDroneBridge
 * @description Feeds LAN-paired (browser-local, no cloud account) agent nodes
 * into the canonical node registry as `"local"` presence. The cloud bridge
 * feeds `"cloud"` presence for the same `node:<deviceId>`; the registry
 * collapses both onto one row, so a node paired both ways renders once. The
 * FleetProjectionBridge turns the registry into the fleet list. This bridge no
 * longer fabricates flight state (no STABILIZE / disarmed / 0% seeds) — FC
 * telemetry comes only from a real attached FC via AgentMavlinkBridge.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import {
  useNodeRegistryStore,
  resolveNodeId,
} from "@/stores/node-registry";
import type { NodeProfile } from "@/stores/node-registry";

function asProfile(p: string | undefined): NodeProfile {
  return p === "ground-station" || p === "workstation" ? p : "drone";
}

export function LocalDroneBridge() {
  // nodeId set this bridge currently owns local presence for, so we can drop
  // presence for nodes that disappear from the local store.
  const trackedIds = useRef<Set<string>>(new Set());
  const nodes = useLocalNodesStore((s) => s.nodes);
  // cloudStatuses carry the freshest LAN poll timestamp; we read them to set a
  // truthful presence heartbeat (lastSeenAt is the pair time fallback).
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);

  useEffect(() => {
    const registry = useNodeRegistryStore.getState();
    const current = new Set<string>();

    for (const node of nodes) {
      const nodeId = resolveNodeId(node.deviceId);
      current.add(nodeId);
      const status = cloudStatuses[node.deviceId];
      const lastHeartbeat = Math.max(
        status?.updatedAt ?? 0,
        node.lastSeenAt ?? 0,
      );
      registry.upsertPresence(
        nodeId,
        {
          deviceId: node.deviceId,
          name: node.name || `Agent ${node.deviceId.slice(0, 8)}`,
          profile: asProfile(node.profile),
          role: node.role ?? null,
          // A LAN-paired node is reached over the LAN; its posture is local
          // unless the cloud bridge later overrides it with an authoritative
          // value. cloudDeviceId carries the agent device id for the
          // connect-on-select path (it is a LAN id, not a relay id).
          cloudPosture: "local",
          cloudDeviceId: node.deviceId,
          agentIdentityKnown: true,
          lastHeartbeat,
        },
        "local",
      );
      trackedIds.current.add(nodeId);
    }

    // Drop local presence for nodes that disappeared from the local store. The
    // registry GC removes the row only if no cloud presence and no FC remain.
    for (const nodeId of Array.from(trackedIds.current)) {
      if (!current.has(nodeId)) {
        registry.dropPresence(nodeId, "local");
        trackedIds.current.delete(nodeId);
      }
    }
  }, [nodes, cloudStatuses]);

  useEffect(() => {
    const tracked = trackedIds.current;
    return () => {
      const registry = useNodeRegistryStore.getState();
      for (const nodeId of tracked) {
        registry.dropPresence(nodeId, "local");
      }
      tracked.clear();
    };
  }, []);

  return null;
}
