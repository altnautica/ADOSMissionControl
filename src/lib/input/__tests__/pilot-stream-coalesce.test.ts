/**
 * @license GPL-3.0-only
 *
 * The pilot WebSocket keeps only the newest stick frame while the socket
 * still holds unsent bytes: a slow link flies the latest stick, never a
 * queue of old ones, and a release is never followed by an older stick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coalescingSender, type PilotSocket } from "../pilot-coalesce";
import type { PilotOutboundFrame } from "../pilot-stream";

class FakeSocket implements PilotSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: PilotOutboundFrame[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as PilotOutboundFrame);
  }
}

function input(seq: number): PilotOutboundFrame {
  return { op: "input", src: "mc", sid: "tab-1", session: 7, seq, t_ms: seq, axes: [0, seq / 10, 0, 0], buttons: 0 };
}

const seqs = (s: FakeSocket) => s.sent.map((f) => (f.op === "input" ? f.seq : f.op));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pilot stream coalescing", () => {
  it("sends every stick frame while the socket buffer is empty", () => {
    const s = new FakeSocket();
    const send = coalescingSender(s);
    expect(send(input(1))).toBe(true);
    expect(send(input(2))).toBe(true);
    expect(seqs(s)).toEqual([1, 2]);
  });

  it("keeps only the newest stick frame while bytes are buffered, and sends it once drained", () => {
    const s = new FakeSocket();
    const send = coalescingSender(s);
    s.bufferedAmount = 512;
    for (let i = 1; i <= 5; i++) expect(send(input(i))).toBe(true);
    vi.advanceTimersByTime(50);
    expect(seqs(s)).toEqual([]);
    s.bufferedAmount = 0;
    vi.advanceTimersByTime(50);
    expect(seqs(s)).toEqual([5]);
    vi.advanceTimersByTime(200);
    expect(seqs(s)).toEqual([5]);
  });

  it("a release drops the waiting stick frame, so no older stick flies after it", () => {
    const s = new FakeSocket();
    const send = coalescingSender(s);
    s.bufferedAmount = 64;
    send(input(1));
    send({ op: "release", src: "mc", sid: "tab-1", session: 7 });
    s.bufferedAmount = 0;
    vi.advanceTimersByTime(100);
    expect(seqs(s)).toEqual(["release"]);
  });

  it("actions are never coalesced", () => {
    const s = new FakeSocket();
    const send = coalescingSender(s);
    s.bufferedAmount = 64;
    send({ op: "action", name: "pause", src: "mc", sid: "tab-1", id: "a1" });
    send({ op: "action", name: "rth", src: "mc", sid: "tab-1", id: "a2" });
    expect(seqs(s)).toEqual(["action", "action"]);
  });

  it("refuses frames on a closed socket and drops the waiting one when it closes", () => {
    const s = new FakeSocket();
    const send = coalescingSender(s);
    s.bufferedAmount = 64;
    send(input(1));
    s.readyState = 3;
    s.bufferedAmount = 0;
    vi.advanceTimersByTime(100);
    expect(send(input(2))).toBe(false);
    expect(seqs(s)).toEqual([]);
  });
});
