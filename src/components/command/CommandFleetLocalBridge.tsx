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
// tiles are quick-glance and only need refresh every few seconds. The next
// tick is armed only after the previous one settles, so a slow agent never
// stacks overlapping probes.
const POLL_INTERVAL_MS = 5000;

/** One live poll loop; identity marks which loop owns a device id. */
interface Poller {
  timer?: ReturnType<typeof setTimeout>;
}

interface CommandFleetLocalBridgeProps {
  enabled: boolean;
}

export function CommandFleetLocalBridge({
  enabled,
}: CommandFleetLocalBridgeProps) {
  const nodes = useLocalNodesStore((s) => s.nodes);
  // Per-deviceId poll loop registry. Refs (not state) because mutating it
  // should never trigger a render. A tick whose poller is no longer the
  // registered one (node removed, StrictMode double-mount, node re-added
  // while a fetch was pending) drops its result and does not re-arm.
  const pollersRef = useRef<Map<string, Poller>>(new Map());

  useEffect(() => {
    const pollers = pollersRef.current;

    function stop(deviceId: string) {
      clearTimeout(pollers.get(deviceId)?.timer);
      pollers.delete(deviceId);
    }

    function stopAll() {
      const ids = Array.from(pollers.keys());
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
    for (const deviceId of pollers.keys()) {
      if (!currentIds.has(deviceId)) {
        droppedIds.push(deviceId);
      }
    }
    for (const id of droppedIds) stop(id);
    if (droppedIds.length > 0) {
      useCommandFleetStore.getState().removeCloudStatuses(droppedIds);
    }

    // Start polling for nodes we don't already have a loop for.
    for (const node of nodes) {
      if (pollers.has(node.deviceId)) continue;

      const deviceId = node.deviceId;
      const poller: Poller = {};
      pollers.set(deviceId, poller);
      const alive = () => pollers.get(deviceId) === poller;

      async function tick() {
        if (!alive()) return;
        // Read the node's fields fresh from the store every tick. The loop
        // is created once and never recreated on rename / IP change (the
        // reconciliation effect skips deviceIds that already have a loop),
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
            if (!alive()) return;
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
              // (background) stale ghosts still self-heal silently. The
              // selection id is the canonical `node:<deviceId>` (see node-id +
              // use-fleet-nodes).
              const focused =
                usePairingStore.getState().selectedPairedId ===
                nodeIdForDevice(deviceId);
              if (!focused) {
                useLocalNodesStore.getState().removeNode(deviceId);
              }
              return;
            }
          } catch (e) {
            if (!alive()) return;
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
          if (!alive()) return;
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

      async function loop() {
        await tick();
        if (alive()) poller.timer = setTimeout(loop, POLL_INTERVAL_MS);
      }
      void loop();
    }
  }, [nodes, enabled]);

  // Unmount teardown — clears any loops the reconciliation effect above
  // did not explicitly stop.
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      for (const poller of pollers.values()) clearTimeout(poller.timer);
      pollers.clear();
    };
  }, []);

  return null;
}
