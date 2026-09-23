/**
 * Onboard-log download over LOG_REQUEST_DATA / LOG_DATA. A log is imported as
 * a flight, so the download may only resolve with the whole log: a stalled
 * transfer or one with a lost packet in the middle must never come back as
 * if it were complete.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  downloadLog,
  handleLogData,
  cancelLogDownload,
  type LogContext,
} from "@/lib/protocol/mavlink-adapter-logs";
import type { MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import type { Transport } from "@/lib/protocol/types";

const LOG_ID = 7;

function makeCtx(): { ctx: LogContext; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  const transport = {
    isConnected: true,
    send: (bytes: Uint8Array) => {
      sent.push(bytes);
    },
  } as unknown as Transport;
  const ctx: LogContext = {
    transport,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    logListDownload: null,
    logDataDownload: null,
  };
  return { ctx, sent };
}

/** The log's byte at `i`, so reassembly errors show up as content mismatches. */
const byteAt = (i: number) => (i * 7 + 3) & 0xff;

/** A LOG_DATA frame carrying bytes [ofs, ofs+count) of the log. */
function logData(ofs: number, count: number): MAVLinkFrame {
  const payload = new DataView(new ArrayBuffer(97));
  payload.setUint32(0, ofs, true);
  payload.setUint16(4, LOG_ID, true);
  payload.setUint8(6, count);
  for (let i = 0; i < count; i++) payload.setUint8(7 + i, byteAt(ofs + i));
  return { msgId: 120, systemId: 1, componentId: 1, sequence: 0, payload, timestamp: 0 };
}

function expectedLog(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => byteAt(i));
}

/** The LOG_REQUEST_DATA frames sent, as { ofs, count }. */
function dataRequests(sent: Uint8Array[]): Array<{ ofs: number; count: number }> {
  return sent
    .filter((f) => f[7] === 119 && f[8] === 0 && f[9] === 0)
    .map((f) => {
      const dv = new DataView(f.buffer, f.byteOffset + 10, 12);
      return { ofs: dv.getUint32(0, true), count: dv.getUint32(4, true) };
    });
}

/** Track a promise's outcome without awaiting it. */
function track<T>(p: Promise<T>): { value?: T; error?: Error; settled: () => boolean } {
  const out: { value?: T; error?: Error; settled: () => boolean } = {
    settled: () => out.value !== undefined || out.error !== undefined,
  };
  p.then(
    (v) => {
      out.value = v;
    },
    (e: Error) => {
      out.error = e;
    },
  );
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("onboard log download", () => {
  it("resolves with every byte of a log that arrives whole", async () => {
    const { ctx } = makeCtx();
    const p = downloadLog(ctx, LOG_ID);
    for (let ofs = 0; ofs < 360; ofs += 90) handleLogData(ctx, logData(ofs, 90));
    handleLogData(ctx, logData(360, 20));
    expect(await p).toEqual(expectedLog(380));
  });

  it("rejects a stalled download as incomplete instead of returning the bytes it has", async () => {
    const { ctx } = makeCtx();
    const result = track(downloadLog(ctx, LOG_ID));
    handleLogData(ctx, logData(0, 90));
    handleLogData(ctx, logData(90, 90));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(result.value).toBeUndefined();
    expect(result.error?.message).toMatch(/incomplete.*180 bytes/);
  });

  it("requests a lost packet again and resolves only once it has arrived", async () => {
    const { ctx, sent } = makeCtx();
    const result = track(downloadLog(ctx, LOG_ID));
    handleLogData(ctx, logData(0, 90));
    // 90..180 lost in transit.
    handleLogData(ctx, logData(180, 90));
    handleLogData(ctx, logData(270, 20));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.settled()).toBe(false);
    expect(dataRequests(sent).at(-1)).toEqual({ ofs: 90, count: 90 });

    handleLogData(ctx, logData(90, 90));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value).toEqual(expectedLog(290));
  });

  it("rejects when a lost packet never comes back", async () => {
    const { ctx } = makeCtx();
    const result = track(downloadLog(ctx, LOG_ID));
    handleLogData(ctx, logData(0, 90));
    handleLogData(ctx, logData(180, 90));
    handleLogData(ctx, logData(270, 20));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(result.value).toBeUndefined();
    expect(result.error?.message).toMatch(/90 of 290 bytes never arrived/);
  });

  it("keeps a download going past five minutes while data keeps arriving", async () => {
    const { ctx } = makeCtx();
    const result = track(downloadLog(ctx, LOG_ID));
    const packets = 200;
    for (let i = 0; i < packets; i++) {
      handleLogData(ctx, logData(i * 90, 90));
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(result.settled()).toBe(false);
    handleLogData(ctx, logData(packets * 90, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value?.byteLength).toBe(packets * 90 + 10);
  });

  it("reports a cancel as a cancel, not as an empty log", async () => {
    const { ctx } = makeCtx();
    const p = downloadLog(ctx, LOG_ID);
    handleLogData(ctx, logData(0, 90));
    cancelLogDownload(ctx);
    await expect(p).rejects.toThrow(/cancelled/);
  });
});
