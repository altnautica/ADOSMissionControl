"use client";

/**
 * @module CommandFleetLocalBridge
 * @description Populates Agent Overview tile telemetry for LAN-only
 * paired nodes. The Convex-backed `CommandFleetStatusBridge` covers
 * cloud-paired drones; nodes paired locally (via the Add-a-Node form)
 * have no heartbeat row in Convex, so this bridge polls each one over
 * LAN REST and writes the result into the same `cloudStatuses` map the
 * cloud bridge writes to. Both bridges co-own the map via the
 * `upsertCloudStatuses` setter.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { AgentClient } from "@/lib/agent/agent-client/client";
import { probeAgent } from "@/lib/agent/local-pair-client";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { mapFullStatusToCloudStatus } from "@/lib/agent/full-status-to-cloud-status";
import { isStaleLocalIdentity } from "@/lib/agent/stale-local-identity";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { reachErrorBucket } from "@/lib/nodes/local-reach";
import { isDemoMode } from "@/lib/utils";

// Lighter cadence than the single-agent System tab (3s) — overview
// tiles are quick-glance and only need refresh every few seconds.
const POLL_INTERVAL_MS = 5000;

interface CommandFleetLocalBridgeProps {
  enabled: boolean;
}

export function CommandFleetLocalBridge({
  enabled,
}: CommandFleetLocalBridgeProps) {
  const nodes = useLocalNodesStore((s) => s.nodes);
  // Per-deviceId polling timer registry. Refs (not state) because
  // mutating these should never trigger a render.
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );
  // Per-deviceId "still active" gate to drop in-flight responses that
  // land after we've cleaned up the node (StrictMode double-mount,
  // node removal during a pending fetch, etc.).
  const aliveRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const intervals = intervalsRef.current;
    const alive = aliveRef.current;

    function stop(deviceId: string) {
      const handle = intervals.get(deviceId);
      if (handle) clearInterval(handle);
      intervals.delete(deviceId);
      alive.delete(deviceId);
    }

    function stopAll() {
      const ids = Array.from(intervals.keys());
      for (const id of ids) stop(id);
      if (ids.length > 0) {
        useCommandFleetStore.getState().removeCloudStatuses(ids);
      }
    }

    // Disabled or wrong protocol → tear everything down. Browsers
    // block mixed-content fetches to http://*.local from an https
    // origin, so https deployments route LAN nodes through the cloud
    // relay instead (see `selectNode` in node-click-handler).
    if (!enabled) {
      stopAll();
      return;
    }
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
      stopAll();
      return;
    }

    const currentIds = new Set(nodes.map((n) => n.deviceId));

    // Stop polling for nodes that disappeared from the local store.
    const droppedIds: string[] = [];
    for (const deviceId of intervals.keys()) {
      if (!currentIds.has(deviceId)) {
        droppedIds.push(deviceId);
      }
    }
    for (const id of droppedIds) stop(id);
    if (droppedIds.length > 0) {
      useCommandFleetStore.getState().removeCloudStatuses(droppedIds);
    }

    // Start polling for nodes we don't already have a timer for.
    for (const node of nodes) {
      if (intervals.has(node.deviceId)) continue;
      alive.add(node.deviceId);

      const deviceId = node.deviceId;

      async function tick() {
        if (!alive.has(deviceId)) return;
        // Read the node's fields fresh from the store every tick. The timer
        // is created once and never recreated on rename / IP change (the
        // reconciliation effect skips deviceIds that already have a timer),
        // so capturing hostname / apiKey / name at creation time would poll
        // a stale identity forever. Looking them up live keeps the poll in
        // step with the operator's edits.
        const live = useLocalNodesStore
          .getState()
          .nodes.find((n) => n.deviceId === deviceId);
        if (!live) return;

        // Reverse-reconcile pairing identity so a stale card self-heals.
        // probeAgent hits the unauthenticated /api/pairing/info. Act ONLY on a
        // definitive "reachable but not ours" signal: the agent now reports a
        // different device id (the box at this hostname was re-flashed or
        // reassigned), or it is no longer paired (it was unpaired from its own
        // webapp, another browser, or the CLI). An unreachable probe is
        // transient — an offline-but-paired drone — and must never drop the row.
        let probeReachable = isDemoMode();
        if (!isDemoMode()) {
          try {
            const info = await probeAgent(live.hostname);
            if (!alive.has(deviceId)) return;
            probeReachable = true;
            // Provenance: this is the one place the GCS learns which of a
            // node's up-to-three candidate reaches actually answers. Record
            // it so the node surface can name the address carrying the
            // session instead of leaving the operator to guess.
            useLocalNodesStore.getState().recordReachOk(deviceId, live.hostname);
            const staleIdentity = isStaleLocalIdentity(info, deviceId);
            if (staleIdentity) {
              stop(deviceId);
              useCommandFleetStore.getState().removeCloudStatuses([deviceId]);
              // Leave the node in place when the operator is focused on it: the
              // connect path has already flagged `stalePairing`, so the detail
              // panel shows a truthful re-pair / remove prompt the operator can
              // act on, rather than the card vanishing from under them. Other
              // (background) stale ghosts still self-heal silently.
              // The selection id is the canonical `node:<deviceId>` (see
              // node-id + use-fleet-nodes). The old code compared against a
              // `local:<deviceId>` colon literal that never matched the hyphen
              // form, so the focused node was being deleted from under the
              // operator — this is the headline fix.
              const focused =
                usePairingStore.getState().selectedPairedId ===
                nodeIdForDevice(deviceId);
              if (!focused) {
                useLocalNodesStore.getState().removeNode(deviceId);
              }
              return;
            }
          } catch (e) {
            if (!alive.has(deviceId)) return;
            // Unreachable / probe failed — transient for presence purposes, so
            // the node is never removed. But "which address failed, and how"
            // is exactly the fact that was being thrown away here: without it
            // an agent that is powered off, a name that stopped resolving and
            // a DHCP lease that moved all produce one identical grey tile.
            // Record the bucket we can actually prove. We deliberately do NOT
            // claim "the name did not resolve": through the server-side proxy
            // a DNS failure and a dead host are the same 502, and guessing
            // between them would be a fabricated diagnosis.
            useLocalNodesStore
              .getState()
              .recordReachError(deviceId, live.hostname, reachErrorBucket(e));
            // Fall through to the telemetry poll, which degrades the tile to
            // offline via the freshness watchdog.
          }
        }

        // A workstation/compute node has no flight-controller status; its
        // telemetry comes from the compute hooks (useComputeLocalState /
        // useComputeJobs). Keep only reachability + presence (which drives the
        // online badge) and skip the drone /api/status/full poll — it returned a
        // boardless status the drone schema rejected and churned the fleet grid
        // on every tick.
        if (live.profile === "workstation") {
          if (probeReachable) {
            useLocalNodesStore.getState().touchLastSeen(deviceId);
          }
          return;
        }

        try {
          const client = new AgentClient(live.hostname, live.apiKey);
          const resp = await client.getFullStatus();
          if (!alive.has(deviceId)) return;
          if (!resp) return; // older agent that lacks /api/status/full
          const row = mapFullStatusToCloudStatus(resp, {
            deviceId,
            mdnsHost: live.mdnsHost,
            lastIp: live.ipv4,
            name: live.name,
            hostname: live.hostname,
          });
          useCommandFleetStore.getState().upsertCloudStatuses([row]);
          useLocalNodesStore.getState().touchLastSeen(deviceId);
        } catch {
          // Swallow — the tile degrades to offline via the freshness
          // watchdog reading `lastSeenAt`. We do not want a single bad
          // network round to crash the overview grid.
        }
      }

      void tick();
      intervals.set(deviceId, setInterval(tick, POLL_INTERVAL_MS));
    }
  }, [nodes, enabled]);

  // Unmount teardown — clears any timers the reconciliation effect
  // above did not explicitly stop.
  useEffect(() => {
    return () => {
      const intervals = intervalsRef.current;
      const alive = aliveRef.current;
      for (const handle of intervals.values()) clearInterval(handle);
      intervals.clear();
      alive.clear();
    };
  }, []);

  return null;
}
