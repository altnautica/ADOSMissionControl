/**
 * @license GPL-3.0-only
 *
 * ULog import: per-instance topics, the velocity/heading current PX4 logs
 * only on vehicle_local_position, the GPS clock that dates the flight, and
 * the unit contracts of the mapped channels.
 */

import { describe, expect, it } from "vitest";

import { parseUlog } from "../parser";
import { ulogToFlightRecords } from "../to-flight-record";
import { normalizeTopicData } from "../topics";

type Field = [type: string, name: string, value: number];

/** Assemble a minimal ULog file: header, formats, subscriptions, data. */
class UlogBuilder {
  private chunks: Uint8Array[] = [];
  private enc = new TextEncoder();

  constructor() {
    const header = new Uint8Array(16);
    header.set([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35, 0x01]);
    this.chunks.push(header);
  }

  private msg(type: string, body: Uint8Array): this {
    const head = new Uint8Array(3);
    new DataView(head.buffer).setUint16(0, body.length, true);
    head[2] = type.charCodeAt(0);
    this.chunks.push(head, body);
    return this;
  }

  format(name: string, fields: Field[]): this {
    const spec = `${name}:${fields.map(([t, n]) => `${t} ${n};`).join("")}`;
    return this.msg("F", this.enc.encode(spec));
  }

  subscribe(msgId: number, multiId: number, name: string): this {
    const nameBytes = this.enc.encode(name);
    const body = new Uint8Array(3 + nameBytes.length);
    body[0] = multiId;
    new DataView(body.buffer).setUint16(1, msgId, true);
    body.set(nameBytes, 3);
    return this.msg("A", body);
  }

  data(msgId: number, fields: Field[]): this {
    const size = fields.reduce((n, [t]) => n + (t.endsWith("64_t") || t === "double" ? 8 : 4), 2);
    const body = new Uint8Array(size);
    const dv = new DataView(body.buffer);
    dv.setUint16(0, msgId, true);
    let at = 2;
    for (const [t, , v] of fields) {
      if (t === "uint64_t") { dv.setBigUint64(at, BigInt(v), true); at += 8; }
      else if (t === "double") { dv.setFloat64(at, v, true); at += 8; }
      else if (t === "float") { dv.setFloat32(at, v, true); at += 4; }
      else { dv.setInt32(at, v, true); at += 4; }
    }
    return this.msg("D", body);
  }

  build(): ArrayBuffer {
    const len = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(len);
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    return out.buffer;
  }
}

const S = 1_000_000;
const UTC_AT_BOOT = 1_700_000_000_000_000; // µs since the epoch

const battery = (ts: number, v: number, remaining: number): Field[] => [
  ["uint64_t", "timestamp", ts],
  ["float", "voltage_v", v],
  ["float", "remaining", remaining],
];

function flightLog(): ArrayBuffer {
  const b = new UlogBuilder()
    .format("battery_status", battery(0, 0, 0))
    .format("vehicle_global_position", [
      ["uint64_t", "timestamp", 0], ["double", "lat", 0], ["double", "lon", 0], ["float", "alt", 0],
    ])
    .format("vehicle_local_position", [
      ["uint64_t", "timestamp", 0], ["float", "vx", 0], ["float", "vy", 0], ["float", "heading", 0],
    ])
    .format("vehicle_gps_position", [
      ["uint64_t", "timestamp", 0], ["uint64_t", "time_utc_usec", 0],
      ["double", "latitude_deg", 0], ["double", "longitude_deg", 0], ["double", "altitude_msl_m", 0],
    ])
    .subscribe(1, 0, "battery_status")
    .subscribe(2, 1, "battery_status")
    .subscribe(3, 0, "vehicle_global_position")
    .subscribe(4, 0, "vehicle_local_position")
    .subscribe(5, 0, "vehicle_gps_position");
  for (let s = 0; s <= 10; s++) {
    const ts = 100 * S + s * S;
    b.data(1, battery(ts, 16.8 - s * 0.05, 0.9))
      .data(2, battery(ts, 12.0, -1))
      .data(4, [["uint64_t", "timestamp", ts], ["float", "vx", 3], ["float", "vy", 4], ["float", "heading", Math.PI / 2]])
      .data(3, [["uint64_t", "timestamp", ts], ["double", "lat", 12 + s * 1e-5], ["double", "lon", 77], ["float", "alt", 900]])
      .data(5, [
        ["uint64_t", "timestamp", ts], ["uint64_t", "time_utc_usec", UTC_AT_BOOT + ts],
        ["double", "latitude_deg", 12 + s * 1e-5], ["double", "longitude_deg", 77], ["double", "altitude_msl_m", 900.5],
      ]);
  }
  return b.build();
}

describe("ULog import", () => {
  it("keeps a second instance of a topic out of instance 0", () => {
    const log = parseUlog(flightLog());
    const primary = log.data.get("battery_status") ?? [];
    expect(primary).toHaveLength(11);
    expect(primary.every((r) => (r.voltage_v as number) > 16)).toBe(true);
    expect(log.data.get("battery_status:1")).toHaveLength(11);
  });

  it("fills ground speed and heading from the local position", () => {
    const [flight] = ulogToFlightRecords(parseUlog(flightLog()));
    const fix = flight.frames.find((f) => f.channel === "globalPosition")?.data as
      | { groundSpeed?: number; heading?: number }
      | undefined;
    expect(fix?.groundSpeed).toBeCloseTo(5, 5);
    expect(fix?.heading).toBeCloseTo(90, 5);
    expect(flight.record.maxSpeed).toBeCloseTo(5, 5);
  });

  it("dates the flight from the GPS clock", () => {
    const [flight] = ulogToFlightRecords(parseUlog(flightLog()));
    expect(flight.record.startTime).toBe(Math.round((UTC_AT_BOOT + 100 * S) / 1000));
  });

  it("reads the PX4 1.14 float GPS fields", () => {
    const [flight] = ulogToFlightRecords(parseUlog(flightLog()));
    const gps = flight.frames.find((f) => f.channel === "gps")?.data;
    expect(gps).toMatchObject({ lat: 12, lon: 77, alt: 900.5 });
  });
});

describe("normalizeTopicData unit contracts", () => {
  it("marks an unestimated battery remaining as -1", () => {
    expect(normalizeTopicData("battery_status", { remaining: -1 }).remaining).toBe(-1);
    expect(normalizeTopicData("battery_status", { remaining: 0.42 }).remaining).toBeCloseTo(42, 6);
  });

  it("reports sensor_combined in mg and mrad/s", () => {
    const d = normalizeTopicData("sensor_combined", {
      accelerometer_m_s2: [0, 0, -9.80665],
      gyro_rad: [0.1, 0, 0],
    });
    expect(d.zacc).toBeCloseTo(-1000, 6);
    expect(d.xgyro).toBeCloseTo(100, 6);
  });

  it("maps actuator outputs onto the servo-output shape", () => {
    expect(normalizeTopicData("actuator_outputs", { output: [1500, 1600] })).toEqual({
      servos: [1500, 1600],
    });
  });
});
