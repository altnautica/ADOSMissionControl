"use client";

/**
 * @module use-compute-local-state
 * @description Local-first source for a compute node's cluster status. A
 * LAN-paired compute node is not necessarily beaconing to Convex (local-first), and
 * even when it is, a direct poll is fresher. This hook polls the node's
 * `GET /api/compute/status` (the ados-control front serving the heartbeat
 * sidecar) and feeds the same `useComputeStore` the cloud heartbeat path feeds,
 * reusing `buildComputePatch` (the sidecar carries the identical `compute*`
 * fields; we inject `profile: "workstation"` so the mapper's profile gate passes).
 *
 * Kept strictly disjoint from `CloudStatusBridge`: it stands down for the
 * active cloud-relay device (which the bridge drives) and clears the
 * single-slice store on node switch. Inert unless local-first, the Atlas flag
 * is on (the compute card is flag-gated), a node is selected, and a LAN key is
 * held. Mounted from the compute-node surface, so it only polls compute nodes;
 * a non-compute node would `404` and write nothing anyway. Stops on unmount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { ComputeAgentClient, parseComputeGpu } from "@/lib/agent/compute-client";
import { buildComputePatch } from "@/components/command/bridges/status-mapper/compute";
import { isDemoMode } from "@/lib/utils";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useComputeStore } from "@/stores/compute-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/** How often to poll the compute node's cluster status, in ms. */
export const COMPUTE_POLL_INTERVAL_MS = 1000;

/**
 * Poll the selected compute node's local agent for its cluster status and feed
 * it into `useComputeStore`. No-op when not local-first for the node (signed in,
 * demo, no LAN key), when the Atlas flag is off, or when no node is selected.
 *
 * @param nodeId The selected compute node's device id, or null/undefined.
 */
export function useComputeLocalState(nodeId: string | null | undefined): void {
  // The active cloud-relay device (CloudStatusBridge owns its compute writes).
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  // The selection id is the canonical `node:<deviceId>`, but local-nodes-store
  // and cloudDeviceId are keyed by the bare deviceId — resolve it before lookup.
  const deviceId = nodeId ? (deviceIdFromNodeId(nodeId) ?? nodeId) : null;
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );

  const host = node?.hostname ?? "";
  const apiKey = node?.apiKey ?? "";
  const active =
    !isDemoMode() &&
    Boolean(deviceId) &&
    Boolean(host) &&
    Boolean(apiKey) &&
    // Strictly disjoint from the cloud bridge for this node — the only node we
    // must NOT local-poll is the one the cloud bridge drives. Cloud sign-in does
    // not disable LAN access to a locally-paired node (local-first).
    cloudDeviceId !== deviceId;

  const apiKeyRef = useRef(apiKey);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  });

  // The compute store holds a SINGLE focused-node slice. Clear it on node switch
  // so a node whose poll 404s never renders the previous node's cluster — UNLESS
  // this node is the cloud-relay device, which CloudStatusBridge owns and clears.
  useEffect(() => {
    if (!isDemoMode() && cloudDeviceId !== deviceId) {
      useComputeStore.getState().clear();
    }
  }, [deviceId, cloudDeviceId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // One request at a time: a slow or unreachable node answers after the
    // client timeout, and interval ticks would otherwise stack requests.
    let inFlight = false;

    const pollOnce = async () => {
      if (inFlight) return;
      inFlight = true;
      let status: Record<string, unknown> | null;
      try {
        const client = new ComputeAgentClient(host, apiKeyRef.current);
        status = await client.getStatus();
      } finally {
        inFlight = false;
      }
      if (cancelled || !status) return;
      // The sidecar carries the `compute*` fields verbatim; inject the profile
      // so buildComputePatch's `profile === "workstation"` gate passes.
      const patch = buildComputePatch(
        { ...status, profile: "workstation" },
        { cluster: useComputeStore.getState().cluster },
        Date.now(),
      );
      if (patch) useComputeStore.getState().setCluster(patch.cluster);

      // Live GPU snapshot — a separate, independently-nullable block on the
      // same sidecar. Drives the workstation GPU surfaces; a finite utilisation
      // also feeds the rolling sparkline ring (mirroring CPU/memory history).
      const gpu = parseComputeGpu((status as Record<string, unknown>).gpu);
      useComputeStore.getState().setGpu(gpu);
      if (gpu && gpu.utilizationPct != null) {
        useAgentSystemStore.getState().pushGpuUtilization(gpu.utilizationPct);
      }
    };

    void pollOnce();
    const handle = setInterval(() => void pollOnce(), COMPUTE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [active, host]);
}
