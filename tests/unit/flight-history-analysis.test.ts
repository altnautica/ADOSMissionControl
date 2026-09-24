/**
 * What History derives from recorded and imported telemetry: flight slicing
 * of onboard logs, the altitude frame of every altitude figure, the recorded
 * attitude unit, the imported PX4 track and the EKF health events.
 *
 * Recorded contracts these pin:
 * - attitude angles are degrees, as live AttitudeData;
 * - `relativeAlt` is height above home; `alt` is AMSL and never feeds
 *   maxAlt, the altitude chart or the phases;
 * - a flight is sliced from arm to disarm, and a log that ends armed still
 *   yields its last flight.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import type { DataflashLog, DataflashRecord } from "@/lib/dataflash/parser";
import type { UlogFile } from "@/lib/ulog/parser";
import type { EkfData } from "@/lib/types";
import { detectFlightSlices, dataflashToFlightRecords } from "@/lib/dataflash/to-flight-record";
import { ulogToFlightRecords } from "@/lib/ulog/to-flight-record";
import { tlogToFlightRecord } from "@/lib/tlog/parser";
import { extractPositions } from "@/lib/simulation/log-track";
import { buildSeries } from "@/lib/flight-analysis/series-builder";
import { analyzeFlight } from "@/lib/flight-analysis/analyzer";
import { detectPhases } from "@/lib/flight-analysis/phase-detector";
import { computeFlightStats } from "@/lib/flight-lifecycle/stats";
import { CHANNEL_REGISTRY } from "@/components/history/detail/charts/custom-chart/channel-registry";

function dataflashLog(messages: Record<string, DataflashRecord[]>): DataflashLog {
  return {
    formats: new Map(),
    params: new Map(),
    messages: new Map(Object.entries(messages)),
    bytesRead: 0,
    resyncSkipped: 0,
  };
}

function ulog(data: Record<string, Record<string, unknown>[]>): UlogFile {
  return {
    version: 1,
    timestamp: 0n,
    formats: new Map(),
    params: new Map(),
    info: new Map(),
    subscriptions: new Map(),
    data: new Map(Object.entries(data)),
    logging: [],
    dropouts: [],
  };
}

const S = 1_000_000; // µs per second

// ── Dataflash slicing ────────────────────────────────────────

describe("dataflash flight slicing", () => {
  it("keeps a flight that is still armed when the log ends", () => {
    const log = dataflashLog({
      EV: [
        { TimeUS: 1 * S, Id: 10 },
        { TimeUS: 5 * S, Id: 11 },
        // Second flight arms and the log stops (brown-out) with no disarm.
        { TimeUS: 10 * S, Id: 10 },
      ],
      ATT: Array.from({ length: 61 }, (_, i) => ({ TimeUS: i * S, Roll: 0, Pitch: 0, Yaw: 0 })),
    });
    const flights = dataflashToFlightRecords(log);
    expect(flights).toHaveLength(2);
    expect(flights[1].record.duration).toBe(50);
    expect(flights[1].record.status).toBe("aborted");
    expect(flights[0].record.status).toBe("completed");
  });

  it("slices a large log with no arm events without overflowing the stack", () => {
    const rows: DataflashRecord[] = [];
    for (let i = 0; i < 600_000; i++) rows.push({ TimeUS: 2 * S + i * 1000 });
    const slices = detectFlightSlices(dataflashLog({ ATT: rows }));
    expect(slices).toEqual([{ startUs: 2 * S, endUs: 2 * S + 599_999 * 1000, endedArmed: false }]);
  });
});

// ── Attitude unit ────────────────────────────────────────────

describe("recorded attitude is degrees", () => {
  it("charts a degree attitude frame as degrees", () => {
    const series = buildSeries([{ offsetMs: 0, channel: "attitude", data: { roll: 15, pitch: -5, yaw: 270 } }]);
    expect(series.attitude[0]).toMatchObject({ roll: 15, pitch: -5, yaw: 270 });
  });

  it("plots a small degree angle as itself in the custom chart", () => {
    const attitude = CHANNEL_REGISTRY.find((c) => c.channel === "attitude");
    const roll = attitude?.fields.find((f) => f.key === "roll");
    expect(roll?.extract({ roll: 3 })).toBe(3);
  });

  it("plots recorded servo outputs from the servos array", () => {
    const servo = CHANNEL_REGISTRY.find((c) => c.channel === "servoOutput");
    const out3 = servo?.fields.find((f) => f.key === "ch3");
    expect(out3?.extract({ port: 0, servos: [1100, 1200, 1300, 1400] })).toBe(1300);
  });

  it("imports dataflash ATT (degrees) unchanged", () => {
    const log = dataflashLog({
      EV: [{ TimeUS: 0, Id: 10 }, { TimeUS: 2 * S, Id: 11 }],
      ATT: [{ TimeUS: 1 * S, Roll: 15, Pitch: -5, Yaw: 270 }],
    });
    const att = dataflashToFlightRecords(log)[0].frames.find((f) => f.channel === "attitude");
    expect(att?.data).toMatchObject({ roll: 15, pitch: -5, yaw: 270 });
  });

  it("imports tlog ATTITUDE (radians on the wire) as degrees", () => {
    const packet = (t: number) => {
      const raw = new Uint8Array(10 + 28 + 2);
      raw[0] = 0xfd;
      raw[1] = 28;
      raw[7] = 30;
      const dv = new DataView(raw.buffer, 10, 28);
      dv.setFloat32(4, (15 * Math.PI) / 180, true);
      return { timestampUs: t, raw };
    };
    const result = tlogToFlightRecord([packet(0), packet(S)]);
    const att = result?.frames.find((f) => f.channel === "attitude")?.data as { roll: number };
    expect(att.roll).toBeCloseTo(15, 3);
  });

  it("imports ULog vehicle_attitude quaternions as degrees", () => {
    const half = (15 * Math.PI) / 180 / 2;
    const log = ulog({ vehicle_attitude: [{ timestamp: 0, q: [Math.cos(half), Math.sin(half), 0, 0] }, { timestamp: S, q: [1, 0, 0, 0] }] });
    const att = ulogToFlightRecords(log)[0].frames.find((f) => f.channel === "attitude")?.data as { roll: number };
    expect(att.roll).toBeCloseTo(15, 3);
  });
});

// ── Altitude frame ───────────────────────────────────────────

/** A flight 30 m above a 920 m AMSL field, with the AMSL VFR_HUD alt beside it. */
function hoverAtThirtyMetres(): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  for (let s = 0; s < 60; s++) {
    frames.push({
      offsetMs: s * 1000,
      channel: "position",
      data: { lat: 12.9 + s * 1e-5, lon: 77.6, alt: 950, relativeAlt: 30, groundSpeed: 6 },
    });
    frames.push({ offsetMs: s * 1000 + 500, channel: "vfr", data: { alt: 950, groundspeed: 6 } });
  }
  return frames;
}

describe("altitude is height above home", () => {
  it("records maxAlt from relativeAlt, not the AMSL VFR_HUD alt", () => {
    expect(computeFlightStats(hoverAtThirtyMetres()).maxAlt).toBe(30);
  });

  it("charts altitude as height above home only", () => {
    const alts = buildSeries(hoverAtThirtyMetres()).altitude.map((p) => p.alt);
    expect(Math.max(...alts)).toBe(30);
  });

  it("gives a climb phase its height above home, not the field elevation", () => {
    // Climbing at 2 m/s to 120 m: position at 5 Hz, VFR_HUD (AMSL) at 1 Hz.
    const frames: TelemetryFrame[] = [];
    for (let ms = 0; ms <= 60_000; ms += 200) {
      frames.push({ offsetMs: ms, channel: "position", data: { lat: 12.9, lon: 77.6, relativeAlt: ms / 500, groundSpeed: 6 } });
      if (ms % 1000 === 0) frames.push({ offsetMs: ms + 100, channel: "vfr", data: { alt: 920 + ms / 500, groundspeed: 6 } });
    }
    const phases = detectPhases(frames);
    expect(phases.some((p) => p.type === "climb")).toBe(true);
    for (const p of phases) expect(p.maxAlt ?? 0).toBeLessThanOrEqual(120);
  });

  it("takes dataflash maxAlt from RelHomeAlt, or from Alt over the arm point", () => {
    const withRel = dataflashLog({
      EV: [{ TimeUS: 0, Id: 10 }, { TimeUS: 3 * S, Id: 11 }],
      POS: [
        { TimeUS: 1 * S, Lat: 12.9, Lng: 77.6, Alt: 920, RelHomeAlt: 0 },
        { TimeUS: 2 * S, Lat: 12.9001, Lng: 77.6, Alt: 950, RelHomeAlt: 30 },
      ],
    });
    expect(dataflashToFlightRecords(withRel)[0].record.maxAlt).toBe(30);

    const withoutRel = dataflashLog({
      EV: [{ TimeUS: 0, Id: 10 }, { TimeUS: 3 * S, Id: 11 }],
      POS: [
        { TimeUS: 1 * S, Lat: 12.9, Lng: 77.6, Alt: 920 },
        { TimeUS: 2 * S, Lat: 12.9001, Lng: 77.6, Alt: 950 },
      ],
    });
    expect(dataflashToFlightRecords(withoutRel)[0].record.maxAlt).toBe(30);
  });
});

// ── PX4 ULog track ───────────────────────────────────────────

/** A PX4 log: EKF origin at the take-off point, GPS fixes moving north. */
function px4Log(): UlogFile {
  const status = [
    { timestamp: 0, arming_state: 1 },
    { timestamp: 1 * S, arming_state: 2 },
    { timestamp: 20 * S, arming_state: 1 },
  ];
  const local: Record<string, unknown>[] = [];
  const global: Record<string, unknown>[] = [];
  for (let s = 2; s <= 18; s++) {
    local.push({ timestamp: s * S + 1000, x: (s - 2) * 10, y: 0, z: -25, vx: 5, vy: 0, vz: 0, ref_lat: 47.0, ref_lon: 8.0 });
    global.push({ timestamp: s * S, lat: 47.0 + (s - 2) * 0.0001, lon: 8.0, alt: 525, alt_ellipsoid: 573, vel_n: 5, vel_e: 0, yaw: Math.PI / 2 });
  }
  return ulog({
    vehicle_status: status,
    home_position: [{ timestamp: 1 * S, alt: 500 }],
    vehicle_local_position: local,
    vehicle_global_position: global,
  });
}

describe("PX4 ULog import", () => {
  it("draws the track from the GPS fixes only, never the EKF origin", () => {
    const flights = ulogToFlightRecords(px4Log());
    const points = extractPositions(flights.flatMap((f) => f.frames));
    expect(points).toHaveLength(17);
    expect(points.every((p, i) => Math.abs(p.lat - (47.0 + i * 0.0001)) < 1e-9)).toBe(true);
    // 16 steps of 0.0001° latitude ≈ 178 m; origin spokes would add kilometres.
    expect(flights[0].record.distance).toBeGreaterThan(170);
    expect(flights[0].record.distance).toBeLessThan(185);
  });

  it("records maxAlt above the logged home, and heading in degrees", () => {
    const [flight] = ulogToFlightRecords(px4Log());
    expect(flight.record.maxAlt).toBe(25);
    const fix = flight.frames.find((f) => f.channel === "globalPosition")?.data as { heading: number };
    expect(fix.heading).toBeCloseTo(90, 6);
  });
});

// ── EKF health events ────────────────────────────────────────

/** EKF_STATUS_REPORT of a healthy GPS flight: every "good" bit set. */
const HEALTHY_FLAGS = 1 | 2 | 4 | 8 | 16 | 32 | 256 | 512;

function ekfFrames(n: number, over: (i: number) => Partial<EkfData> = () => ({})): TelemetryFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    offsetMs: i * 1000,
    channel: "ekf",
    data: {
      flags: HEALTHY_FLAGS,
      velocityVariance: 0.1,
      posHorizVariance: 0.1,
      posVertVariance: 0.1,
      compassVariance: 0.1,
      ...over(i),
    },
  }));
}

const ekfEvents = (frames: TelemetryFrame[]) => analyzeFlight(frames).events.filter((e) => e.type.startsWith("ekf"));

describe("EKF events", () => {
  it("raises nothing for a healthy EKF, whose flags are a non-zero good-bits mask", () => {
    expect(ekfEvents(ekfFrames(60))).toEqual([]);
  });

  it("warns at variance 0.5 and errors at 0.8", () => {
    const warn = ekfEvents(ekfFrames(3, (i) => (i === 1 ? { compassVariance: 0.6 } : {})));
    expect(warn).toMatchObject([{ type: "ekf_variance", severity: "warning" }]);
    const error = ekfEvents(ekfFrames(3, (i) => (i === 1 ? { posHorizVariance: 0.9 } : {})));
    expect(error).toMatchObject([{ type: "ekf_variance", severity: "error" }]);
  });

  it("reports GPS glitching when that fault bit turns on", () => {
    const events = ekfEvents(ekfFrames(4, (i) => (i >= 2 ? { flags: HEALTHY_FLAGS | 32768 } : {})));
    expect(events).toMatchObject([{ type: "ekf_gps_glitch", t: 2000 }]);
  });
});
