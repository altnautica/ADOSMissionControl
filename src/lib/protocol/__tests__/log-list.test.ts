/**
 * @module protocol/log-list.test
 * @description The onboard log list over LOG_REQUEST_LIST / LOG_ENTRY: a lost
 * entry is requested again by id range, a list the vehicle never completes
 * rejects instead of resolving short, and silence is not "no logs".
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getLogList, handleLogEntry, type LogContext } from "../mavlink-adapter-logs";
import type { MAVLinkFrame } from "../mavlink-parser";

function ctx(): { ctx: LogContext; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  return {
    sent,
    ctx: {
      transport: { isConnected: true, send: (d: Uint8Array) => sent.push(d) } as unknown as LogContext["transport"], // the two members the list touches
      targetSysId: 1, targetCompId: 1, sysId: 255, compId: 190,
      logListDownload: null, logDataDownload: null,
    },
  };
}

/** A LOG_ENTRY frame: time_utc, size, id, num_logs, last_log_num. */
function entry(id: number, numLogs: number, lastLogNum: number): MAVLinkFrame {
  const p = new DataView(new ArrayBuffer(14));
  p.setUint32(0, 1_700_000_000, true);
  p.setUint32(4, 4096 * id, true);
  p.setUint16(8, id, true);
  p.setUint16(10, numLogs, true);
  p.setUint16(12, lastLogNum, true);
  return { msgId: 118, systemId: 1, componentId: 1, sequence: 0, payload: p, timestamp: 0 };
}

/** start/end of each LOG_REQUEST_LIST sent. */
function listRequests(sent: Uint8Array[]): Array<[number, number]> {
  return sent
    .filter((f) => f[7] === 117)
    .map((f) => {
      const dv = new DataView(f.buffer, f.byteOffset + 10, f[1]);
      return [dv.getUint16(0, true), dv.getUint16(2, true)];
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("log list", () => {
  it("re-requests a lost entry and resolves only with the whole list", async () => {
    vi.useFakeTimers();
    const { ctx: c, sent } = ctx();
    const list = getLogList(c);
    handleLogEntry(c, entry(1, 3, 3));
    handleLogEntry(c, entry(3, 3, 3)); // entry 2 was lost
    await vi.advanceTimersByTimeAsync(2500);
    expect(listRequests(sent).at(-1)).toEqual([2, 2]);
    handleLogEntry(c, entry(2, 3, 3));
    expect((await list).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("rejects a list the vehicle never completes", async () => {
    vi.useFakeTimers();
    const { ctx: c } = ctx();
    const list = getLogList(c);
    const outcome = list.then(() => "resolved", (e: Error) => e.message);
    handleLogEntry(c, entry(1, 3, 3));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatch(/incomplete: received 1 of 3/);
  });

  it("rejects silence instead of reporting no logs", async () => {
    vi.useFakeTimers();
    const { ctx: c } = ctx();
    const outcome = getLogList(c).then(() => "resolved", (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatch(/No response/);
  });

  it("resolves an empty list when the vehicle reports no logs", async () => {
    const { ctx: c } = ctx();
    const list = getLogList(c);
    handleLogEntry(c, entry(0, 0, 0));
    expect(await list).toEqual([]);
  });
});
