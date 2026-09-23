/**
 * @module command/bridges/status-mapper/compute
 * @description Builds the per-slice patch the bridge applies to the compute
 * store when the agent profile is `workstation` (the master/slave cluster view +
 * this node's queue depth and worker occupancy). Returns null when the
 * profile is not workstation or no compute fields are present. Pure.
 * @license GPL-3.0-only
 */

import type { ComputeClusterStatus, ComputeSlave } from "@/stores/compute-store";

export interface ComputeFanOutCurrent {
  cluster: ComputeClusterStatus;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function coerceSlaves(raw: unknown): ComputeSlave[] {
  if (!Array.isArray(raw)) return [];
  const out: ComputeSlave[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const nodeId = asString(row.nodeId);
    if (!nodeId) continue;
    out.push({
      nodeId,
      accelerators: Array.isArray(row.accelerators)
        ? row.accelerators.filter((a): a is string => typeof a === "string")
        : [],
      workersIdle: asNumber(row.workersIdle),
      queueDepth: asNumber(row.queueDepth),
    });
  }
  return out;
}

/**
 * Build the patch the bridge applies to `useComputeStore` when the agent
 * profile is `workstation`. Returns `null` when the profile is not workstation or
 * when the heartbeat carries no compute fields (so a LAN poll keeps its
 * authority and we avoid a no-op setState).
 */
export function buildComputePatch(
  cloudStatus: Record<string, unknown>,
  current: ComputeFanOutCurrent,
  nowMs: number,
): { cluster: ComputeClusterStatus } | null {
  if (cloudStatus.profile !== "workstation") return null;

  const role = asString(cloudStatus.computeRole);
  const masterId = asString(cloudStatus.computeClusterMasterId);
  const queueDepth = asNumber(cloudStatus.computeQueueDepth);
  const activeJobs = asNumber(cloudStatus.computeActiveJobs);
  const activeSessions = asNumber(cloudStatus.computeActiveSessions);
  const workersIdle = asNumber(cloudStatus.computeWorkersIdle);
  const aggregateWorkersIdle = asNumber(
    cloudStatus.computeClusterAggregateWorkersIdle,
  );
  const hasSlaves = Array.isArray(cloudStatus.computeClusterSlaves);

  // Nothing compute-shaped in this heartbeat — leave the slice untouched.
  if (
    role === null &&
    masterId === null &&
    queueDepth === null &&
    activeJobs === null &&
    activeSessions === null &&
    workersIdle === null &&
    aggregateWorkersIdle === null &&
    !hasSlaves
  ) {
    return null;
  }

  // Merge over the current slice so a sparse heartbeat (e.g. only queue depth
  // changed) preserves the other last-known values.
  const cluster: ComputeClusterStatus = {
    role: role ?? current.cluster.role,
    masterId: masterId ?? current.cluster.masterId,
    queueDepth: queueDepth ?? current.cluster.queueDepth,
    activeJobs: activeJobs ?? current.cluster.activeJobs,
    activeSessions: activeSessions ?? current.cluster.activeSessions,
    workersIdle: workersIdle ?? current.cluster.workersIdle,
    aggregateWorkersIdle:
      aggregateWorkersIdle ?? current.cluster.aggregateWorkersIdle,
    slaves: hasSlaves
      ? coerceSlaves(cloudStatus.computeClusterSlaves)
      : current.cluster.slaves,
    updatedAt: nowMs,
  };

  return { cluster };
}
