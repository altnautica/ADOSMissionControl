/**
 * @module dronecan/node-id-conflict
 * @description Detects two DroneCAN nodes claiming the same node ID.
 *
 * A single GetNodeInfo call resolves on the first responder, so one call per
 * ID can never see a duplicate. The scan instead gathers evidence over a
 * listening window:
 *   - several GetNodeInfo samples per ID; more than one distinct unique_id
 *     means more than one node answered;
 *   - the NodeStatus uptime stream per ID; two nodes sharing an ID interleave
 *     their broadcasts, so uptime steps backwards repeatedly. A single step
 *     back is a reboot and is not counted as a conflict;
 *   - two NodeStatus frames in the same uptime second that disagree on
 *     health, mode or vendor status, which one node cannot produce.
 * Two identical nodes powered together report equal uptimes and the same
 * one usually answers GetNodeInfo first, so neither of the first two signals
 * fires. Such an ID is never reported clean on thin evidence: when
 * GetNodeInfo never succeeds (interleaved multi-frame answers fail their
 * CRC), or NodeStatus arrives at about twice the nominal 1 Hz, the ID is
 * reported inconclusive. IDs that produced neither a response nor a
 * NodeStatus are reported as silent.
 *
 * @license GPL-3.0-only
 */

import type { DroneCanClient } from "./client";
import type { NodeStatus } from "./dsdl/node-status";

export type ConflictScanClient = Pick<DroneCanClient, "getNodeInfo" | "onNodeStatus">;

export interface NodeIdConflict {
  nodeId: number;
  /** Distinct unique_ids seen for this ID (hex); may be one when the uptime stream gave it away. */
  uniqueIds: string[];
}

export interface ConflictScanReport {
  conflicts: NodeIdConflict[];
  /** IDs that answered GetNodeInfo and showed a single node. */
  clean: number[];
  /** IDs heard on the bus whose evidence could not rule out a duplicate. */
  inconclusive: number[];
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

/** NodeStatus frames per uptime second at or above this look like two 1 Hz publishers. */
const DOUBLED_RATE = 1.8;

/** Uptime span, in seconds, needed before the rate is judged. */
const RATE_MIN_SPAN_S = 2;

/** Whether two frames in the same uptime second disagree on node state. */
export function hasSameSecondDisagreement(statuses: readonly NodeStatus[]): boolean {
  const bySecond = new Map<number, string>();
  for (const s of statuses) {
    const state = `${s.health}/${s.mode}/${s.vendor_specific_status_code}`;
    const seen = bySecond.get(s.uptime_sec);
    if (seen !== undefined && seen !== state) return true;
    bySecond.set(s.uptime_sec, state);
  }
  return false;
}

/** Whether NodeStatus arrived at about twice the nominal 1 Hz over the window. */
export function hasDoubledRate(statuses: readonly NodeStatus[]): boolean {
  if (statuses.length === 0) return false;
  const uptimes = statuses.map((s) => s.uptime_sec);
  const span = Math.max(...uptimes) - Math.min(...uptimes);
  if (span < RATE_MIN_SPAN_S) return false;
  return statuses.length / (span + 1) >= DOUBLED_RATE;
}

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
  const statuses = new Map<number, NodeStatus[]>();
  const unsubscribe = client.onNodeStatus((src, status) => {
    if (!wanted.has(src)) return;
    const list = statuses.get(src) ?? [];
    list.push(status);
    statuses.set(src, list);
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

  const report: ConflictScanReport = { conflicts: [], clean: [], inconclusive: [], silent: [] };
  for (const id of [...nodeIds].sort((a, b) => a - b)) {
    const seenUids = uids.get(id);
    const seenStatuses = statuses.get(id) ?? [];
    if (!seenUids && seenStatuses.length === 0) {
      report.silent.push(id);
      continue;
    }
    const uidList = seenUids ? Array.from(seenUids) : [];
    const uptimes = seenStatuses.map((s) => s.uptime_sec);
    if (
      uidList.length > 1 ||
      countUptimeRegressions(uptimes) >= INTERLEAVE_REGRESSIONS ||
      hasSameSecondDisagreement(seenStatuses)
    ) {
      report.conflicts.push({ nodeId: id, uniqueIds: uidList });
    } else if (!seenUids || hasDoubledRate(seenStatuses)) {
      report.inconclusive.push(id);
    } else {
      report.clean.push(id);
    }
  }
  return report;
}
