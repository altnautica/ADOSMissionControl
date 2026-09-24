/**
 * @module protocol/adapter-links-and-transfers.test
 * @description MAVLinkAdapter behaviour driven through fake transports:
 *
 * - every link parses its own byte stream, so a chunk from one link never
 *   splices into a partial frame from another;
 * - broadcast PARAM_VALUE frames from another component on the vehicle's
 *   system id do not feed the autopilot's parameters;
 * - the HOME_POSITION altitude reaches the PX4 takeoff conversion;
 * - an empty rally or fence upload clears the vehicle and waits for its ACK;
 * - an unacknowledged LOG_ERASE is reported as unacknowledged.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { MAVLinkAdapter } from "../mavlink-adapter";
import { buildFrame } from "../encoders/frame";
import type { ParameterValue, Transport, TransportEventMap } from "../types";

type Handler = (data: unknown) => void;

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  readonly canCommand = true;
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
  /** Sent frames of one message id. */
  frames(msgId: number): Uint8Array[] {
    return this.sent.filter((f) => (f[7] | (f[8] << 8) | (f[9] << 16)) === msgId);
  }
}

const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_AUTOPILOT_PX4 = 12;

function heartbeat(autopilot: number, sysId = 1, compId = 1): Uint8Array {
  const p = new Uint8Array(9);
  p[4] = 2; // MAV_TYPE_QUADROTOR
  p[5] = autopilot;
  p[7] = 4; // MAV_STATE_ACTIVE
  p[8] = 3;
  return buildFrame(0, p, sysId, compId, 0);
}

function paramValue(name: string, value: number, compId: number): Uint8Array {
  const p = new Uint8Array(25);
  const dv = new DataView(p.buffer);
  dv.setFloat32(0, value, true);
  dv.setUint16(4, 900, true); // param_count
  dv.setUint16(6, 12, true); // param_index
  p.set(new TextEncoder().encode(name), 8);
  p[24] = 9; // REAL32
  return buildFrame(22, p, 1, compId, 0);
}

const open: MAVLinkAdapter[] = [];

async function connected(autopilot: number): Promise<{ adapter: MAVLinkAdapter; link: FakeTransport }> {
  const adapter = new MAVLinkAdapter();
  open.push(adapter);
  const link = new FakeTransport();
  const pending = adapter.connect(link);
  link.emit(heartbeat(autopilot));
  await pending;
  return { adapter, link };
}

afterEach(async () => {
  for (const a of open.splice(0)) await a.disconnect();
});

describe("multi-link parsing", () => {
  it("keeps a chunk from one link out of another link's partial frame", async () => {
    const { adapter, link: a } = await connected(MAV_AUTOPILOT_ARDUPILOTMEGA);
    const b = new FakeTransport();
    const added = adapter.addLink(b);
    b.emit(heartbeat(MAV_AUTOPILOT_ARDUPILOTMEGA));
    expect(await added).toMatchObject({ ok: true });

    const seen: number[] = [];
    adapter.onMavlinkFrame((f) => seen.push(f.msgId));
    const attitude = buildFrame(30, new Uint8Array(28).fill(1), 1, 1, 7);
    const vfr = buildFrame(74, new Uint8Array(20).fill(2), 1, 1, 8);
    a.emit(attitude.subarray(0, 10));
    b.emit(vfr);
    a.emit(attitude.subarray(10));
    expect(seen).toContain(74);
    expect(seen).toContain(30);
  });
});

describe("parameter frames from other components", () => {
  it("ignores a PARAM_VALUE broadcast by a non-autopilot component", async () => {
    const { adapter, link } = await connected(MAV_AUTOPILOT_ARDUPILOTMEGA);
    const got: ParameterValue[] = [];
    adapter.onParameter((p) => got.push(p));
    link.emit(paramValue("CAM_MODE", 3, 100));
    link.emit(paramValue("WPNAV_SPEED", 500, 1));
    expect(got.map((p) => p.name)).toEqual(["WPNAV_SPEED"]);
  });
});

describe("PX4 takeoff altitude from HOME_POSITION", () => {
  it("converts the takeoff height with the reported home altitude", async () => {
    const { adapter, link } = await connected(MAV_AUTOPILOT_PX4);
    const home = new Uint8Array(60);
    new DataView(home.buffer).setInt32(8, 488_000, true); // altitude, mm AMSL
    link.emit(buildFrame(242, home, 1, 1, 9));

    void adapter.takeoff(10);
    const takeoff = link
      .frames(76)
      .map((f) => new DataView(f.buffer, f.byteOffset + 10, f[1]))
      .find((dv) => dv.getUint16(28, true) === 22);
    expect(takeoff?.getFloat32(24, true)).toBeCloseTo(498);
  });
});

describe("empty rally and fence uploads", () => {
  /** MISSION_ACK from the vehicle to this GCS (255/190) for `missionType`. */
  const ack = (missionType: number) => buildFrame(47, Uint8Array.from([255, 190, 0, missionType]), 1, 1, 10);

  it.each([
    ["rally", 2, (a: MAVLinkAdapter) => a.uploadRallyPoints([])],
    ["fence", 1, (a: MAVLinkAdapter) => a.uploadFenceMission([])],
  ])("an empty %s upload sends MISSION_COUNT 0 and resolves on the ACK", async (_kind, missionType, upload) => {
    const { adapter, link } = await connected(MAV_AUTOPILOT_ARDUPILOTMEGA);
    const result = upload(adapter);
    const counts = link.frames(44).map((f) => f.subarray(10, 10 + f[1]));
    expect(counts).toHaveLength(1);
    expect(counts[0][0] | (counts[0][1] << 8)).toBe(0);
    expect(counts[0][4]).toBe(missionType);
    link.emit(ack(missionType));
    expect((await result).success).toBe(true);
  });
});

describe("log erase", () => {
  it("reports an unacknowledged erase as unacknowledged", async () => {
    const { adapter } = await connected(MAV_AUTOPILOT_ARDUPILOTMEGA);
    const result = await adapter.eraseAllLogs();
    expect(result.acknowledged).toBe(false);
  });
});
