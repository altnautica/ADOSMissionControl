/**
 * How arm/disarm turns into a flight record, and how recordings are stored:
 * - a 0,0 position at arm is "no fix yet", not the takeoff point;
 * - a recording already running at arm (record-on-connect) supplies the
 *   flight's frames, cut to the arm/disarm span;
 * - a quick re-arm while the last flight is finalizing keeps its own state;
 * - the preflight bitmasks are the arming drone's own SYS_STATUS;
 * - concurrent recording writes never drop an index entry, and imports are
 *   never trimmed by the live-recording cap.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  // Every access resolves asynchronously, like IndexedDB, so unserialized
  // read-modify-write sequences interleave.
  const later = <T,>(value: T) => Promise.resolve().then(() => value);
  return {
    get: (k: string) => later(store.get(k)),
    set: (k: string, v: unknown) => later(void store.set(k, v)),
    del: (k: string) => later(void store.delete(k)),
    keys: () => later([...store.keys()]),
    createStore: () => ({}),
  };
});
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => null }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => null, haversineKmLocal: () => 0 }));

import { clearLifecycleState, notifyArmed } from "@/lib/flight-lifecycle";
import {
  isRecordingFor,
  listRecordings,
  loadRecordingFrames,
  recordFrameFor,
  setRecordingFromFrames,
  startRecordingFor,
  stopRecordingFor,
} from "@/lib/telemetry-recorder";
import { useHistoryStore } from "@/stores/history-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { SysStatusData } from "@/lib/types";

const DRONE = "node:d1";
let now = 1_700_000_000_000;

function tick(ms: number): void {
  now += ms;
}

function recordFor(droneId: string) {
  return useHistoryStore.getState().records.filter((r) => r.droneId === droneId);
}

async function completed(droneId: string, count = 1) {
  await vi.waitFor(() => {
    const done = recordFor(droneId).filter((r) => r.status === "completed");
    expect(done).toHaveLength(count);
  });
  return recordFor(droneId).filter((r) => r.status === "completed");
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockImplementation(() => now);
  useHistoryStore.setState({ records: [] });
  useSettingsStore.setState({ autoRecordOnArm: true });
});

afterEach(async () => {
  clearLifecycleState(DRONE);
  clearLifecycleState("node:d2");
  await stopRecordingFor(DRONE);
  await stopRecordingFor("node:d2");
  vi.restoreAllMocks();
});

describe("arm position", () => {
  it("does not store a 0,0 position as the takeoff point", async () => {
    notifyArmed(DRONE, "Drone 1", true, { lat: 0, lon: 0, gpsFixType: 0 });
    const [draft] = recordFor(DRONE);
    expect(draft.takeoffLat).toBeUndefined();
    expect(draft.takeoffLon).toBeUndefined();
    expect(draft.sunMoon).toBeUndefined();
  });
});

describe("a recording already running at arm", () => {
  it("supplies the flight's frames, cut to the arm/disarm span", async () => {
    useSettingsStore.setState({ autoRecordOnArm: false });
    startRecordingFor(DRONE, "Drone 1");
    recordFrameFor(DRONE, "position", { lat: 10, lon: 10, relativeAlt: 0 });
    tick(1000);

    notifyArmed(DRONE, "Drone 1", true, {});
    tick(1000);
    recordFrameFor(DRONE, "position", { lat: 12.97, lon: 77.59, relativeAlt: 0 });
    tick(1000);
    recordFrameFor(DRONE, "position", { lat: 12.98, lon: 77.59, relativeAlt: 30 });
    tick(1000);
    notifyArmed(DRONE, "Drone 1", false, {});
    tick(1000);
    recordFrameFor(DRONE, "position", { lat: 20, lon: 20, relativeAlt: 0 });

    const [flight] = await completed(DRONE);
    expect(flight.hasTelemetry).toBe(true);
    expect(flight.maxAlt).toBe(30);
    // ~1.1 km between the two in-flight fixes; the fixes before arm and
    // after disarm are not part of the flight.
    expect(flight.distance).toBeGreaterThan(1000);
    expect(flight.distance).toBeLessThan(1200);
    expect(flight.recordingId).toBeDefined();
    const frames = await loadRecordingFrames(flight.recordingId!);
    expect(frames.map((f) => f.offsetMs)).toEqual([1000, 2000]);
    // The connect recording keeps running.
    expect(isRecordingFor(DRONE)).toBe(true);
  });
});

describe("a flight with no recording", () => {
  it("leaves distance, altitude and speed unmeasured instead of 0", async () => {
    useSettingsStore.setState({ autoRecordOnArm: false });
    notifyArmed(DRONE, "Drone 1", true, {});
    tick(60_000);
    notifyArmed(DRONE, "Drone 1", false, {});
    const [flight] = await completed(DRONE);
    expect(flight.hasTelemetry).toBe(false);
    expect(flight.distance).toBeUndefined();
    expect(flight.maxAlt).toBeUndefined();
    expect(flight.maxSpeed).toBeUndefined();
  });
});

describe("quick re-arm", () => {
  it("keeps the next flight's state while the previous one finalizes", async () => {
    notifyArmed(DRONE, "Drone 1", true, {});
    tick(1000);
    recordFrameFor(DRONE, "position", { lat: 12.97, lon: 77.59, relativeAlt: 5 });
    tick(1000);
    notifyArmed(DRONE, "Drone 1", false, {});
    // Re-arm before the first disarm's IndexedDB writes finish.
    notifyArmed(DRONE, "Drone 1", true, {});
    await completed(DRONE, 1);
    tick(1000);
    notifyArmed(DRONE, "Drone 1", false, {});

    const flights = await completed(DRONE, 2);
    expect(flights.every((f) => f.status === "completed")).toBe(true);
  });
});

describe("preflight snapshot", () => {
  it("records the arming drone's own SYS_STATUS bitmasks", () => {
    const sys: SysStatusData = {
      timestamp: now,
      cpuLoad: 0,
      sensorsPresent: 0b111,
      sensorsEnabled: 0b101,
      sensorsHealthy: 0b001,
      batteryRemaining: 90,
      dropRateComm: 0,
      errorsComm: 0,
    };
    notifyArmed("node:d2", "Drone 2", true, { sysStatus: sys });
    const [draft] = recordFor("node:d2");
    expect(draft.preflight).toMatchObject({ sysStatusPresent: 0b111, sysStatusEnabled: 0b101, sysStatusHealth: 0b001 });
  });
});

describe("recordings index", () => {
  it("keeps both entries when two drones' recordings finish together", async () => {
    startRecordingFor("node:a", "A");
    startRecordingFor("node:b", "B");
    recordFrameFor("node:a", "attitude", { roll: 1 });
    recordFrameFor("node:b", "attitude", { roll: 2 });
    const [a, b] = await Promise.all([stopRecordingFor("node:a"), stopRecordingFor("node:b")]);
    const ids = (await listRecordings()).map((r) => r.id);
    expect(ids).toContain(a!.id);
    expect(ids).toContain(b!.id);
  });

  it("never trims imported recordings to make room for live ones", async () => {
    await setRecordingFromFrames("import-keep", "Imported", [{ offsetMs: 0, channel: "attitude", data: {} }]);
    for (let i = 0; i < 21; i++) {
      tick(10);
      startRecordingFor("node:live", "Live");
      await stopRecordingFor("node:live");
    }
    const index = await listRecordings();
    expect(index.some((r) => r.id === "import-keep")).toBe(true);
    expect(await loadRecordingFrames("import-keep")).toHaveLength(1);
    expect(index.filter((r) => !r.imported)).toHaveLength(20);
  });
});
