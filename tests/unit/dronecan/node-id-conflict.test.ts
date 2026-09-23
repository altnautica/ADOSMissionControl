import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countUptimeRegressions,
  scanNodeIdConflicts,
  type ConflictScanClient,
} from "@/lib/dronecan/node-id-conflict";
import type { GetNodeInfoResponse } from "@/lib/dronecan/dsdl/get-node-info";
import type { NodeStatus } from "@/lib/dronecan/dsdl/node-status";

function info(uidByte: number): GetNodeInfoResponse {
  return {
    hardware_version: { unique_id: new Uint8Array(16).fill(uidByte) },
  } as GetNodeInfoResponse;
}

function status(uptime: number): NodeStatus {
  return { uptime_sec: uptime, health: 0, mode: 0, sub_mode: 0, vendor_specific_status_code: 0 } as NodeStatus;
}

/** Client whose GetNodeInfo answers come from a per-ID queue and whose
 *  NodeStatus listener the test drives directly. */
function makeClient(answers: Record<number, Array<number | "timeout">>) {
  let listener: ((src: number, s: NodeStatus) => void) | null = null;
  const client: ConflictScanClient = {
    getNodeInfo: vi.fn(async (id: number) => {
      const next = answers[id]?.shift() ?? "timeout";
      if (next === "timeout") throw new Error("timeout");
      return info(next);
    }) as ConflictScanClient["getNodeInfo"],
    onNodeStatus: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  };
  const emit = (src: number, uptime: number) => listener?.(src, status(uptime));
  return { client, emit };
}

describe("scanNodeIdConflicts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flags an ID answered by two nodes with different unique_ids", async () => {
    const { client } = makeClient({ 10: [0xaa, 0xbb, 0xaa], 11: [0xcc, 0xcc, 0xcc] });
    const scan = scanNodeIdConflicts(client, [10, 11], { windowMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const report = await scan;
    expect(report.conflicts).toEqual([{ nodeId: 10, uniqueIds: ["aaaa".repeat(8), "bbbb".repeat(8)] }]);
    expect(report.clean).toEqual([11]);
  });

  it("flags an ID whose NodeStatus uptime interleaves, even if one node always answers first", async () => {
    const { client, emit } = makeClient({ 20: [0xaa, 0xaa, 0xaa] });
    const scan = scanNodeIdConflicts(client, [20], { windowMs: 3_000 });
    for (const uptime of [500, 12, 501, 13, 502, 14]) emit(20, uptime);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await scan).conflicts.map((c) => c.nodeId)).toEqual([20]);
  });

  it("does not call a single reboot a conflict", async () => {
    const { client, emit } = makeClient({ 21: [0xaa, 0xaa, 0xaa] });
    const scan = scanNodeIdConflicts(client, [21], { windowMs: 3_000 });
    for (const uptime of [500, 501, 0, 1, 2]) emit(21, uptime);
    await vi.advanceTimersByTimeAsync(3_000);
    const report = await scan;
    expect(report.conflicts).toEqual([]);
    expect(report.clean).toEqual([21]);
  });

  it("reports an ID with no response and no broadcast as silent, not clean", async () => {
    const { client } = makeClient({});
    const scan = scanNodeIdConflicts(client, [30], { windowMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const report = await scan;
    expect(report.silent).toEqual([30]);
    expect(report.clean).toEqual([]);
  });

  it("counts only backward uptime steps", () => {
    expect(countUptimeRegressions([1, 2, 3])).toBe(0);
    expect(countUptimeRegressions([5, 1, 6, 2])).toBe(2);
  });
});
