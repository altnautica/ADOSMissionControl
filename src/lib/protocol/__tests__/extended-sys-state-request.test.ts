/**
 * @module protocol/extended-sys-state-request.test
 * @description On connect, and on every stream re-request (link restored or
 * flight-controller reboot), the adapter asks the flight controller for
 * EXTENDED_SYS_STATE at 1 Hz (MAV_CMD_SET_MESSAGE_INTERVAL), the landed state
 * Disarm gates on. A refusal is ignored: the connection carries on and the
 * request is not repeated until the next re-request.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAVLinkAdapter } from "../mavlink-adapter";
import { buildFrame } from "../encoders/frame";
import type { Transport, TransportEventMap } from "../types";
import { useSettingsStore } from "@/stores/settings-store";

const COMMAND_LONG = 76;
const SET_MESSAGE_INTERVAL = 511;
const EXTENDED_SYS_STATE = 245;
const MAV_RESULT_DENIED = 2;

type Handler = (data: unknown) => void;

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  canCommand = true;
  readonly sent: Uint8Array[] = [];
  private readonly handlers = new Map<keyof TransportEventMap, Set<Handler>>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
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
  /** Every COMMAND_LONG sent, decoded. */
  commands(): { command: number; params: number[] }[] {
    return this.sent
      .filter((f) => (f[7] | (f[8] << 8) | (f[9] << 16)) === COMMAND_LONG)
      .map((f) => {
        // MAVLink 2 trims trailing zero bytes; restore the 33-byte payload.
        const p = new Uint8Array(33);
        p.set(f.subarray(10, 10 + f[1]));
        const dv = new DataView(p.buffer);
        return {
          command: dv.getUint16(28, true),
          params: Array.from({ length: 7 }, (_, i) => dv.getFloat32(i * 4, true)),
        };
      });
  }
}

function heartbeat(): Uint8Array {
  const p = new Uint8Array(9);
  p[4] = 2; // quadrotor
  p[5] = 3; // ArduPilot
  p[8] = 3;
  return buildFrame(0, p, 1, 1, 0);
}

function commandAck(command: number, result: number): Uint8Array {
  const p = new Uint8Array(10);
  new DataView(p.buffer).setUint16(0, command, true);
  p[2] = result;
  p[8] = 255;
  p[9] = 190;
  return buildFrame(77, p, 1, 1, 0);
}

function systemTime(timeBootMs: number): Uint8Array {
  const p = new Uint8Array(12);
  new DataView(p.buffer).setUint32(8, timeBootMs, true);
  return buildFrame(2, p, 1, 1, 0);
}

const open: MAVLinkAdapter[] = [];

async function connected(): Promise<{ adapter: MAVLinkAdapter; link: FakeTransport }> {
  const link = new FakeTransport();
  const adapter = new MAVLinkAdapter();
  open.push(adapter);
  const pending = adapter.connect(link);
  link.emit(heartbeat());
  await pending;
  return { adapter, link };
}

const landedStateRequests = (link: FakeTransport) =>
  link.commands().filter((c) => c.command === SET_MESSAGE_INTERVAL && c.params[0] === EXTENDED_SYS_STATE);

beforeEach(() => {
  useSettingsStore.setState({ gcsManagesTelemetryRates: false });
});

afterEach(async () => {
  for (const a of open.splice(0)) await a.disconnect();
});

describe("landed-state stream on connect", () => {
  it("asks once for EXTENDED_SYS_STATE at 1 Hz", async () => {
    const { link } = await connected();
    expect(landedStateRequests(link)).toEqual([
      { command: SET_MESSAGE_INTERVAL, params: [EXTENDED_SYS_STATE, 1_000_000, 0, 0, 0, 0, 0] },
    ]);
  });

  it("ignores a refusal and does not ask again", async () => {
    const { adapter, link } = await connected();
    link.emit(commandAck(SET_MESSAGE_INTERVAL, MAV_RESULT_DENIED));
    await Promise.resolve();
    expect(adapter.isConnected).toBe(true);
    expect(landedStateRequests(link)).toHaveLength(1);
  });

  it("asks again after the flight controller reboots", async () => {
    const { link } = await connected();
    link.emit(systemTime(60_000));
    link.emit(systemTime(61_000));
    expect(landedStateRequests(link)).toHaveLength(1);
    // time_boot_ms going backwards: the FC rebooted and lost the interval.
    link.emit(systemTime(500));
    expect(landedStateRequests(link)).toEqual([
      { command: SET_MESSAGE_INTERVAL, params: [EXTENDED_SYS_STATE, 1_000_000, 0, 0, 0, 0, 0] },
      { command: SET_MESSAGE_INTERVAL, params: [EXTENDED_SYS_STATE, 1_000_000, 0, 0, 0, 0, 0] },
    ]);
  });

  it("does not double-send when the PX4 stream set already carries it", async () => {
    useSettingsStore.setState({ gcsManagesTelemetryRates: true });
    const link = new FakeTransport();
    const adapter = new MAVLinkAdapter();
    open.push(adapter);
    const pending = adapter.connect(link);
    const hb = new Uint8Array(9);
    hb[4] = 2;
    hb[5] = 12; // PX4
    hb[8] = 3;
    link.emit(buildFrame(0, hb, 1, 1, 0));
    await pending;
    expect(landedStateRequests(link)).toHaveLength(1);
  });
});
