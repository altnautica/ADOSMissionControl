"use client";

/**
 * @module compute-store
 * @description Focused-agent compute-node runtime telemetry: the
 * master/slave cluster view plus this node's job-queue depth and worker
 * occupancy. Mirrors the focused-agent shape of the ground-station store —
 * one slice for the node currently mapped by the status bridge.
 *
 * Two producers feed this store (both write the same `cluster` slice):
 * the cloud-relay heartbeat fan-out in `CloudStatusBridge` (via
 * `buildComputePatch`), and, on the LAN, a direct poll of the compute
 * node's status endpoint. Today only the cloud fan-out is wired; the LAN
 * poll lands with the compute heartbeat producer. The slice stays empty
 * (every field null / no slaves) until a compute-profile heartbeat
 * arrives, so the card renders an "awaiting heartbeat" state on any other
 * profile.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** One slave node registered with the master in the compute cluster. */
export interface ComputeSlave {
  nodeId: string;
  /** Accelerator ids the slave offers (e.g. "cuda:0", "mps"). */
  accelerators: string[];
  /** Null when the slave did not report it. */
  workersIdle: number | null;
  /** Null when the slave did not report it. */
  queueDepth: number | null;
}

/**
 * GPU / accelerator snapshot for the focused compute node, sampled from its
 * `GET /api/compute/status` sidecar each poll. Null until a poll lands; each
 * field is independently null when the node can't report it (a headless box
 * with no GPU, or a backend that exposes no utilization counter). The Mac/
 * Apple-Silicon path reports a `metal` family string (e.g. "Metal 4") and a
 * live `utilizationPct`.
 */
export interface ComputeGpuInfo {
  name: string | null;
  cores: number | null;
  unifiedMemoryMb: number | null;
  /** Metal feature-set family string (e.g. "Metal 4"), or null off Apple GPUs. */
  metal: string | null;
  /** Live GPU utilisation, 0..100, or null when the backend exposes none. */
  utilizationPct: number | null;
}

/** The compute node's runtime status: its own queue + workers, and the
 * cluster (master id + aggregate idle capacity + registered slaves) it
 * fronts. Every scalar is null until a compute heartbeat populates it. */
export interface ComputeClusterStatus {
  /** "master" | "slave", or null before the first heartbeat. */
  role: string | null;
  masterId: string | null;
  queueDepth: number | null;
  activeJobs: number | null;
  /** Live perception-OFFLOAD sessions this node is currently serving (a drone
   * streaming frames here for detection). Distinct from `activeJobs` (batch
   * reconstruction jobs). Null before the first heartbeat / on a node that
   * does not serve offload. */
  activeSessions: number | null;
  workersIdle: number | null;
  /** Sum of idle workers across the master and all slaves. */
  aggregateWorkersIdle: number | null;
  slaves: ComputeSlave[];
  /** Epoch ms of the heartbeat this slice was last populated from (the
   * source row's updatedAt), or null before the first heartbeat. */
  updatedAt: number | null;
}

export const EMPTY_COMPUTE_CLUSTER: ComputeClusterStatus = {
  role: null,
  masterId: null,
  queueDepth: null,
  activeJobs: null,
  activeSessions: null,
  workersIdle: null,
  aggregateWorkersIdle: null,
  slaves: [],
  updatedAt: null,
};

interface ComputeStoreState {
  cluster: ComputeClusterStatus;
  /** Live GPU snapshot for the focused node, or null before the first poll
   * (or on a node that reports no GPU). Read by the workstation status card,
   * the GPU metrics card, and the brand header. */
  gpu: ComputeGpuInfo | null;
  /** Wall-clock ms of the last `setGpu` call, or null before the first one.
   * Lets the GPU card age the reading when the compute poll stops answering. */
  gpuUpdatedAt: number | null;
  /** Replace the cluster slice (the bridge passes a fully-merged slice). */
  setCluster: (cluster: ComputeClusterStatus) => void;
  /** Replace the GPU snapshot (null clears it — node reports no GPU). */
  setGpu: (gpu: ComputeGpuInfo | null) => void;
  /** Reset to the empty slice (connection reset / node switch). */
  clear: () => void;
}

export const useComputeStore = create<ComputeStoreState>((set) => ({
  cluster: { ...EMPTY_COMPUTE_CLUSTER },
  gpu: null,
  gpuUpdatedAt: null,
  setCluster: (cluster) => set({ cluster }),
  setGpu: (gpu) => set({ gpu, gpuUpdatedAt: Date.now() }),
  clear: () =>
    set({ cluster: { ...EMPTY_COMPUTE_CLUSTER }, gpu: null, gpuUpdatedAt: null }),
}));
