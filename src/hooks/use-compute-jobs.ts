"use client";

/**
 * @module use-compute-jobs
 * @description Local-first source for a compute node's reconstruction / offload
 * jobs. A LAN-paired compute node is not necessarily beaconing to Convex
 * (local-first), and the job API lives on the engine's own `:8092` listener (not the
 * cloud heartbeat), so the Forge workbench polls the node directly. Mirrors
 * `use-compute-local-state`'s gating: inert unless local-first, the Atlas flag
 * is on, a node is selected, a LAN key is held, and the node is not the active
 * cloud-relay device. Returns the job list plus a client for on-demand reads
 * (outputs) and writes (cancel). Stops on unmount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import {
  ComputeAgentClient,
  type ComputeJob,
  type ComputeOutput,
} from "@/lib/agent/compute-client";
import { isDemoMode } from "@/lib/utils";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/** How often to poll the node's job list, in ms. Jobs are slow-moving, so a
 * 2 s cadence is plenty (the engine state machine ticks far slower). */
export const COMPUTE_JOBS_POLL_INTERVAL_MS = 2000;

/** LAN target for the demo compute client. Never dialled for outputs (the
 * demo jobs carry no artifacts); the consumers need a non-null client to render
 * the job list, counts, and viewer. */
const DEMO_COMPUTE_HOST = "http://demo-workstation.local";
const DEMO_COMPUTE_KEY = "demo";

/** Demo compute client: a demo job has no artifacts, so the output read answers
 * "reachable, none" instead of a failed dial to a host that does not exist. */
class DemoComputeAgentClient extends ComputeAgentClient {
  override async getOutputs(): Promise<ComputeOutput[] | null> {
    return [];
  }
}

/** A stable, honest mock job list for demo mode (a realistic mix of
 * running / queued / completed / failed, not fabricated all-success). Anchored
 * once at module load so its reference is stable (a fresh array each render
 * would churn the group-by / viewer memos). */
const DEMO_JOBS_BASE = Date.now();
const DEMO_COMPUTE_JOBS: ComputeJob[] = [
  {
    id: "job-recon-04",
    kind: "reconstruct",
    datasetId: "ds-survey-04",
    state: "running",
    progress: 0.62,
    resultRef: null,
    error: null,
    sessionId: "atlas-1042",
    steps: 30000,
    params: { backend: "auto", session_id: "atlas-1042", steps: 30000, generation: 3, device_id: "demo-drone-1" },
    createdMs: DEMO_JOBS_BASE - 4 * 60_000,
    updatedMs: DEMO_JOBS_BASE - 5_000,
  },
  {
    id: "job-recon-05",
    kind: "reconstruct",
    datasetId: "ds-survey-05",
    state: "queued",
    progress: 0,
    resultRef: null,
    error: null,
    sessionId: "atlas-1043",
    steps: 15000,
    params: { backend: "auto", session_id: "atlas-1043", steps: 15000, generation: 1, device_id: "demo-drone-1" },
    createdMs: DEMO_JOBS_BASE - 90_000,
    updatedMs: DEMO_JOBS_BASE - 90_000,
  },
  {
    id: "job-recon-03",
    kind: "reconstruct",
    datasetId: "ds-survey-03",
    state: "completed",
    progress: 1,
    resultRef: "artifact://splat-03",
    error: null,
    sessionId: "atlas-1039",
    steps: 30000,
    params: { backend: "auto", session_id: "atlas-1039", steps: 30000, generation: 2, device_id: "demo-drone-1" },
    createdMs: DEMO_JOBS_BASE - 22 * 60_000,
    updatedMs: DEMO_JOBS_BASE - 12 * 60_000,
  },
  {
    id: "job-offload-11",
    kind: "perception_offload",
    datasetId: null,
    state: "completed",
    progress: 1,
    resultRef: "artifact://detections-11",
    error: null,
    sessionId: null,
    steps: null,
    params: {},
    createdMs: DEMO_JOBS_BASE - 35 * 60_000,
    updatedMs: DEMO_JOBS_BASE - 34 * 60_000,
  },
  {
    id: "job-recon-02",
    kind: "reconstruct",
    datasetId: "ds-survey-02",
    state: "failed",
    progress: 0.18,
    resultRef: null,
    error: "capture ended before the minimum keyframe count",
    sessionId: "atlas-1031",
    steps: 15000,
    params: { backend: "auto", session_id: "atlas-1031", steps: 15000, generation: 1, device_id: "demo-drone-1" },
    createdMs: DEMO_JOBS_BASE - 55 * 60_000,
    updatedMs: DEMO_JOBS_BASE - 53 * 60_000,
  },
];

export interface ComputeJobsState {
  jobs: ComputeJob[];
  /** True until the first poll resolves (the workbench shows a spinner). */
  loading: boolean;
  /** True when the job API is unreachable (404 / transport / no LAN client) —
   * the workbench shows a calm "awaiting compute node" state, not an error. */
  unreachable: boolean;
  /** A client for on-demand reads (outputs) + writes (cancel), or null when
   * not local-first for this node (signed in, demo, cloud, no LAN key). */
  client: ComputeAgentClient | null;
}

/**
 * Poll the selected compute node's job API and return its jobs + a client.
 * No-op (client null, empty jobs) when not local-first for the node, when the
 * Atlas flag is off, or when no node is selected.
 *
 * @param nodeId The selected compute node's device id, or null/undefined.
 */
export function useComputeJobs(
  nodeId: string | null | undefined,
): ComputeJobsState {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  // The selection id is the canonical `node:<deviceId>`, but local-nodes-store
  // and cloudDeviceId are keyed by the bare deviceId — resolve it before lookup.
  const deviceId = nodeId ? (deviceIdFromNodeId(nodeId) ?? nodeId) : null;
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );

  const host = node?.hostname ?? "";
  const apiKey = node?.apiKey ?? "";
  const demo = isDemoMode();
  // A locally-paired node (present in local-nodes-store with host + apiKey) is
  // reached over the LAN regardless of cloud auth (local-first). The
  // `cloudDeviceId !== nodeId` guard is what keeps us off the one node the cloud
  // bridge drives — being signed in is NOT a reason to stop polling a workstation
  // that runs its own compute on the same box.
  const active =
    !demo &&
    Boolean(deviceId) &&
    Boolean(host) &&
    Boolean(apiKey) &&
    cloudDeviceId !== deviceId;

  // Demo mode: serve the static mock job list against a stub client so the
  // workstation surfaces populate without a live compute node. Gated on a
  // selected node; the only non-null nodeId caller in demo is the workstation
  // surface (Atlas is a default there).
  const demoActive = demo && Boolean(deviceId);

  // The client is a pure derivation of the active LAN target (or the demo stub),
  // so memoizing it (rather than storing it via the effect) keeps the effect
  // free of in-body setState — and its identity drives the poll.
  const client = useMemo(
    () =>
      demoActive
        ? new DemoComputeAgentClient(DEMO_COMPUTE_HOST, DEMO_COMPUTE_KEY)
        : active
          ? new ComputeAgentClient(host, apiKey)
          : null,
    [demoActive, active, host, apiKey],
  );
  // The poll result is tagged with the target it came from, so a node switch
  // never surfaces the previous node's jobs while the new poll is in flight.
  const clientKey = active ? `${host}|${apiKey}` : "";
  const [poll, setPoll] = useState<{
    key: string;
    jobs: ComputeJob[];
    unreachable: boolean;
  }>({ key: "", jobs: [], unreachable: false });

  useEffect(() => {
    // The demo serves a static list (no live poll).
    if (!client || demoActive) return;
    let cancelled = false;
    const pollOnce = async () => {
      const result = await client.listJobs();
      if (cancelled) return;
      setPoll(
        result === null
          ? { key: clientKey, jobs: [], unreachable: true }
          : { key: clientKey, jobs: result, unreachable: false },
      );
    };
    void pollOnce();
    const handle = setInterval(
      () => void pollOnce(),
      COMPUTE_JOBS_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [client, clientKey, demoActive]);

  // Demo short-circuit (after every hook has run, so hook order is stable).
  if (demoActive) {
    return {
      jobs: DEMO_COMPUTE_JOBS,
      loading: false,
      unreachable: false,
      client,
    };
  }

  const fresh = clientKey !== "" && poll.key === clientKey;
  return {
    jobs: fresh ? poll.jobs : [],
    loading: active && !fresh,
    unreachable: fresh ? poll.unreachable : false,
    client,
  };
}
