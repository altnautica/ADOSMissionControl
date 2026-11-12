/**
 * Mission upload over MAVLink: the caller hears how many items the vehicle
 * has taken, and a failed upload ends with a code the UI can put into words.
 * @license GPL-3.0-only
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { MAVLinkAdapter } from "../mavlink-adapter";
import { buildFrame } from "../encoders/frame";
import type { MissionItem, Transport, TransportEventMap } from "../types";
import {
  MISSION_TRANSFER_NOT_CONNECTED, MISSION_TRANSFER_STALLED, missionResultKey,
} from "../mission-result";

type Handler = (data: unknown) => void;

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  readonly canCommand = true;
  private readonly handlers = new Map<keyof TransportEventMap, Set<Handler>>();
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> { this.isConnected = false; }
  send(): void {}
  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
  }
  off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }
  emit(bytes: Uint8Array): void {
    for (const h of [...(this.handlers.get("data") ?? [])]) h(bytes);
  }
}

function heartbeat(): Uint8Array {
  const p = new Uint8Array(9);
  p[4] = 2; // quadrotor
  p[5] = 3; // ArduPilot
  p[7] = 4;
  p[8] = 3;
  return buildFrame(0, p, 1, 1, 0);
}

/** MISSION_REQUEST_INT for `seq` of the plain mission, addressed to this GCS. */
function request(seq: number, n: number): Uint8Array {
  const p = new Uint8Array(5);
  new DataView(p.buffer).setUint16(0, seq, true);
  p[2] = 255;
  p[3] = 190;
  p[4] = 0;
  return buildFrame(51, p, 1, 1, n);
}

/** MISSION_ACK with `result` for the plain mission. */
function ack(result: number, n: number): Uint8Array {
  return buildFrame(47, new Uint8Array([255, 190, result, 0]), 1, 1, n);
}

const item = (seq: number): MissionItem => ({
  seq, frame: 3, command: 16, current: 0, autocontinue: 1,
  param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 30,
});

const open: MAVLinkAdapter[] = [];

async function connected(): Promise<{ adapter: MAVLinkAdapter; link: FakeTransport }> {
  const adapter = new MAVLinkAdapter();
  open.push(adapter);
  const link = new FakeTransport();
  const pending = adapter.connect(link);
  link.emit(heartbeat());
  await pending;
  return { adapter, link };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const a of open.splice(0)) await a.disconnect();
});

describe("mission upload progress", () => {
  it("reports items sent out of the total as the vehicle asks for them", async () => {
    vi.useFakeTimers();
    const { adapter, link } = await connected();
    const progress: Array<[number, number]> = [];
    const upload = adapter.uploadMission([item(0), item(1), item(2)], (sent, total) => progress.push([sent, total]));
    await vi.advanceTimersByTimeAsync(0);
    link.emit(request(0, 1));
    link.emit(request(1, 2));
    link.emit(request(1, 3)); // a repeated request does not count twice
    link.emit(request(2, 4));
    link.emit(ack(0, 5));
    expect(await upload).toMatchObject({ success: true });
    expect(progress).toEqual([[1, 3], [2, 3], [2, 3], [3, 3]]);
  });

  it("ends a refused upload with the vehicle's MAV_MISSION_RESULT", async () => {
    vi.useFakeTimers();
    const { adapter, link } = await connected();
    const upload = adapter.uploadMission([item(0)]);
    await vi.advanceTimersByTimeAsync(0);
    link.emit(request(0, 1));
    link.emit(ack(4, 2)); // MAV_MISSION_NO_SPACE
    expect(await upload).toMatchObject({ success: false, resultCode: 4 });
  });

  it("ends a stalled upload with the stalled code", async () => {
    vi.useFakeTimers();
    const { adapter, link } = await connected();
    const upload = adapter.uploadMission([item(0), item(1)]);
    await vi.advanceTimersByTimeAsync(0);
    link.emit(request(0, 1));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await upload).toMatchObject({ success: false, resultCode: MISSION_TRANSFER_STALLED });
  });

  it("ends an upload with no link with the not-connected code", async () => {
    const { adapter, link } = await connected();
    link.isConnected = false;
    expect(await adapter.uploadMission([item(0)])).toMatchObject({ success: false, resultCode: MISSION_TRANSFER_NOT_CONNECTED });
  });
});

describe("missionResultKey", () => {
  it.each([
    [1, "error"], [2, "unsupportedFrame"], [3, "unsupported"], [4, "noSpace"], [5, "invalid"],
    [6, "invalidParam"], [9, "invalidParam"], [10, "invalidPosition"], [11, "invalidPosition"],
    [12, "invalidParam"], [13, "invalidSequence"], [14, "denied"], [15, "cancelled"],
    [-1, "noAnswer"], [MISSION_TRANSFER_STALLED, "stalled"], [MISSION_TRANSFER_NOT_CONNECTED, "notConnected"],
    [99, "unknown"],
  ])("names code %i as %s", (code, key) => {
    expect(missionResultKey(code)).toBe(key);
  });
});
