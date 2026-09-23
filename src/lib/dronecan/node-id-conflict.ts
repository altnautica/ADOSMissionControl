/**
 * @module dronecan/node-id-conflict
 * @description Detects two DroneCAN nodes claiming the same node ID.
 *
 * A single GetNodeInfo call resolves on the first responder, so one call per
 * ID can never see a duplicate. The scan instead gathers two kinds of
 * evidence over a listening window:
 *   - several GetNodeInfo samples per ID; more than one distinct unique_id
 *     means more than one node answered;
 *   - the NodeStatus uptime stream per ID; two nodes sharing an ID interleave
 *     their broadcasts, so uptime steps backwards repeatedly. A single step
 *     back is a reboot and is not counted as a conflict.
 * IDs that produced neither a response nor a NodeStatus are reported as
 * silent, separately from IDs that were checked and found clean.
 *
 * @license GPL-3.0-only
 */

import type { DroneCanClient } from "./client";

export type ConflictScanClient = Pick<DroneCanClient, "getNodeInfo" | "onNodeStatus">;

export interface NodeIdConflict {
  nodeId: number;
  /** Distinct unique_ids seen for this ID (hex); may be one when the uptime stream gave it away. */
  uniqueIds: string[];
}

export interface ConflictScanReport {
  conflicts: NodeIdConflict[];
  /** IDs that answered or broadcast and showed a single node. */
  clean: number[];
  /** IDs that neither answered GetNodeInfo nor broadcast NodeStatus. */
  silent: number[];
}

export interface ConflictScanOptions {
  /** How long to listen to NodeStatus broadcasts. DroneCAN nodes publish at least 1 Hz. */
  windowMs?: number;
  /** GetNodeInfo calls per ID. */
  samples?: number;
  /** Timeout for each GetNodeInfo call. */
  timeoutMs?: number;
}

/** Uptime regressions at or above this count mean interleaved publishers. */
const INTERLEAVE_REGRESSIONS = 2;

/** Count strictly decreasing steps in an uptime sequence. */
export function countUptimeRegressions(uptimes: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < uptimes.length; i++) {
    if (uptimes[i] < uptimes[i - 1]) n++;
  }
  return n;
}

function uniqueIdHex(uid: Uint8Array): string {
  let out = "";
  for (const b of uid) out += b.toString(16).padStart(2, "0");
  return out;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function scanNodeIdConflicts(
  client: ConflictScanClient,
  nodeIds: readonly number[],
  { windowMs = 3_000, samples = 3, timeoutMs = 700 }: ConflictScanOptions = {},
): Promise<ConflictScanReport> {
  const wanted = new Set(nodeIds);
  const uptimes = new Map<number, number[]>();
  const unsubscribe = client.onNodeStatus((src, status) => {
    if (!wanted.has(src)) return;
    const list = uptimes.get(src) ?? [];
    list.push(status.uptime_sec);
    uptimes.set(src, list);
  });

  const uids = new Map<number, Set<string>>();
  const sampleId = async (id: number) => {
    for (let i = 0; i < samples; i++) {
      try {
        const info = await client.getNodeInfo(id, { timeoutMs });
        const set = uids.get(id) ?? new Set<string>();
        set.add(uniqueIdHex(info.hardware_version.unique_id));
        uids.set(id, set);
      } catch {
        // A timeout is recorded by absence; the ID is silent only if the
        // NodeStatus stream is empty too.
      }
    }
  };

  try {
    await Promise.all([sleep(windowMs), ...nodeIds.map(sampleId)]);
  } finally {
    unsubscribe();
  }

  const report: ConflictScanReport = { conflicts: [], clean: [], silent: [] };
  for (const id of [...nodeIds].sort((a, b) => a - b)) {
    const seenUids = uids.get(id);
    const seenUptimes = uptimes.get(id) ?? [];
    if (!seenUids && seenUptimes.length === 0) {
      report.silent.push(id);
      continue;
    }
    const uidList = seenUids ? Array.from(seenUids) : [];
    if (uidList.length > 1 || countUptimeRegressions(seenUptimes) >= INTERLEAVE_REGRESSIONS) {
      report.conflicts.push({ nodeId: id, uniqueIds: uidList });
    } else {
      report.clean.push(id);
    }
  }
  return report;
}
