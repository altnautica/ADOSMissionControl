/**
 * @module mock/demo-seed/compute
 * @description Seeds the workstation compute cluster and GPU snapshot in demo mode.
 * @license GPL-3.0-only
 */

import { useComputeStore } from "@/stores/compute-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { DEMO_WORKSTATION } from "@/mock/drones";

/** Seed the compute node's cluster + GPU snapshot (drives the workstation
 * overview compute cards + brand hero). `updatedAt` is refreshed each tick so
 * the cluster card's 15s staleness gate never trips in a running demo. */
export function seedComputeStore(now: number): void {
  useComputeStore.getState().setCluster({
    role: "master",
    masterId: nodeIdForDevice(DEMO_WORKSTATION.deviceId),
    queueDepth: 1,
    activeJobs: 1,
    // Two drones are streaming frames here for perception offload — the "Serving
    // N sessions" line on the workstation's compute card.
    activeSessions: 2,
    workersIdle: 3,
    aggregateWorkersIdle: 5,
    slaves: [
      {
        nodeId: nodeIdForDevice("worker-01"),
        accelerators: ["cuda:0"],
        workersIdle: 2,
        queueDepth: 0,
      },
    ],
    updatedAt: now,
  });
  useComputeStore.getState().setGpu({
    name: "Apple M-series",
    cores: 40,
    unifiedMemoryMb: 65536,
    metal: "Metal 4",
    // A gentle wobble so the GPU sparkline reads as live rather than pinned.
    utilizationPct: 30 + Math.round(Math.random() * 18),
  });
}
