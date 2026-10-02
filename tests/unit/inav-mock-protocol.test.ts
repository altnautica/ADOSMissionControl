/**
 * Unit tests for INavMockProtocol.
 *
 * Covers: connect, vehicle info, capabilities, settings round-trip,
 * mission upload/download, safehome CRUD, geozone CRUD, and
 * telemetry callback firing via fake timers.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { INavMockProtocol } from "@/mock/inav-mock-protocol";
import { SettingType } from "@/lib/protocol/msp/settings";
import { INAV_WP_ACTION, INAV_WP_FLAG_LAST } from "@/lib/protocol/msp/msp-decoders-inav";
import type { MissionItem } from "@/lib/protocol/types";
import { MockTransport } from "@/mock/mock-transport";

// ── Factory helpers ──────────────────────────────────────────

function makeCopter() {
  return new INavMockProtocol({ vehicleClass: "copter" });
}

function makePlane() {
  return new INavMockProtocol({ vehicleClass: "plane" });
}

function fakeTransport(): MockTransport {
  return new MockTransport();
}

// ── Connect / VehicleInfo ────────────────────────────────────

describe("connect", () => {
  it("returns VehicleInfo with firmwareType inav", async () => {
    const proto = makeCopter();
    const info = await proto.connect(fakeTransport());
    expect(info.firmwareType).toBe("inav");
  });

  it("version string includes '7.'", async () => {
    const proto = makeCopter();
    const info = await proto.connect(fakeTransport());
    expect(info.firmwareVersionString).toMatch(/7\./);
  });

  it("vehicleClass is copter for copter config", async () => {
    const proto = makeCopter();
    const info = await proto.connect(fakeTransport());
    expect(info.vehicleClass).toBe("copter");
  });

  it("vehicleClass is plane for plane config", async () => {
    const proto = makePlane();
    const info = await proto.connect(fakeTransport());
    expect(info.vehicleClass).toBe("plane");
  });
});

// ── Capabilities ─────────────────────────────────────────────

describe("capabilities", () => {
  it("reflects iNav handler capabilities", () => {
    const proto = makeCopter();
    const caps = proto.getCapabilities();
    expect(caps.supportsSafehome).toBe(true);
    expect(caps.supportsGeozone).toBe(true);
    expect(caps.supportsMultiMission).toBe(true);
    expect(caps.supportsSettings).toBe(true);
  });
});

// ── Settings capability ──────────────────────────────────────

describe("settings.getSetting", () => {
  it("reads seeded nav_rth_altitude as uint16 with value 2500", async () => {
    const proto = makeCopter();
    const sv = await proto.settings.getSetting("nav_rth_altitude");
    expect(sv.type).toBe("uint16");
    expect(sv.value).toBe(2500);
  });

  it("rejects an unknown setting name instead of reading it as zero", async () => {
    // Real iNav fails MSP2_COMMON_SETTING for a name it does not have. The mock
    // used to answer a zero uint8, so any panel addressing a name outside the
    // seed rendered a fabricated 0 that looked like a measurement.
    const proto = makeCopter();
    await expect(proto.settings.getSetting("nonexistent_setting")).rejects.toThrow(
      /nonexistent_setting/,
    );
  });

  it("platform_type is 0 for copter, 1 for plane", async () => {
    const copter = makeCopter();
    const plane = makePlane();
    expect((await copter.settings.getSetting("platform_type")).value).toBe(0);
    expect((await plane.settings.getSetting("platform_type")).value).toBe(1);
  });
});

describe("settings.setSetting", () => {
  it("round-trips a uint16 setting and reports success", async () => {
    const proto = makeCopter();
    const result = await proto.settings.setSetting("nav_rth_altitude", 3000);
    expect(result.success).toBe(true);
    const sv = await proto.settings.getSetting("nav_rth_altitude");
    expect(sv.type).toBe("uint16");
    expect(sv.value).toBe(3000);
  });

  it("round-trips a uint8 setting", async () => {
    const proto = makeCopter();
    await proto.settings.setSetting("failsafe_procedure", 2);
    const sv = await proto.settings.getSetting("failsafe_procedure");
    expect(sv.value).toBe(2);
  });
});

describe("settings.getSettingInfo / enumerate", () => {
  it("reports typed metadata for a named setting", async () => {
    const proto = makeCopter();
    const info = await proto.settings.getSettingInfo("nav_rth_altitude");
    expect(info.name).toBe("nav_rth_altitude");
    expect(info.type).toBe(SettingType.UINT16);
  });

  it("enumerates the seeded settings", async () => {
    const proto = makeCopter();
    const all = await proto.settings.enumerate();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((s) => s.name === "nav_rth_altitude")).toBe(true);
  });
});

// ── Mission upload / download ────────────────────────────────

describe("mission upload and download", () => {
  function makeItems(count: number): MissionItem[] {
    return Array.from({ length: count }, (_, i) => ({
      seq: i, frame: 3, command: 16, current: i === 0 ? 1 : 0, autocontinue: 1,
      param1: 0, param2: 0, param3: 0, param4: 0,
      x: Math.round((12.9 + i * 0.001) * 1e7),
      y: Math.round((77.6 + i * 0.001) * 1e7),
      z: 50 + i * 5,
    }));
  }

  it("upload 5 waypoints then download returns 5 items", async () => {
    const proto = makeCopter();
    const items = makeItems(5);
    await proto.uploadMission(items);
    const downloaded = await proto.downloadMission();
    expect(downloaded).toHaveLength(5);
  });

  it("last waypoint in getINavWaypoints has INAV_WP_FLAG_LAST flag", async () => {
    const proto = makeCopter();
    const items = makeItems(5);
    await proto.uploadMission(items);
    const wps = proto.getINavWaypoints();
    expect(wps[4].flag).toBe(INAV_WP_FLAG_LAST);
  });

  it("intermediate waypoints have flag 0", async () => {
    const proto = makeCopter();
    const items = makeItems(3);
    await proto.uploadMission(items);
    const wps = proto.getINavWaypoints();
    expect(wps[0].flag).toBe(0);
    expect(wps[1].flag).toBe(0);
  });

  it("downloaded lat/lon round-trips within float precision", async () => {
    const proto = makeCopter();
    const items = makeItems(1);
    await proto.uploadMission(items);
    const downloaded = await proto.downloadMission();
    const origLat = items[0].x / 1e7;
    const gotLat = downloaded[0].x / 1e7;
    expect(Math.abs(gotLat - origLat)).toBeLessThan(0.0001);
  });

  it("clearMission empties waypoints", async () => {
    const proto = makeCopter();
    await proto.uploadMission(makeItems(3));
    await proto.clearMission();
    const wps = proto.getINavWaypoints();
    expect(wps).toHaveLength(0);
  });
});

// ── Safehomes and geozones ───────────────────────────────────

describe("safehome table", () => {
  it("downloads every slot, unused ones disabled", async () => {
    const proto = makeCopter();
    const slots = await proto.downloadSafehomes();
    expect(slots).toHaveLength(8);
    expect(slots.every((s) => !s.enabled)).toBe(true);
  });

  it("upload then download round-trips and disables the slots past the list", async () => {
    const proto = makeCopter();
    await proto.uploadSafehomes([
      { index: 0, enabled: true, lat: 12.9, lon: 77.5 },
      { index: 1, enabled: true, lat: 12.9716, lon: 77.5946 },
    ]);
    await proto.uploadSafehomes([{ index: 0, enabled: true, lat: 12.8, lon: 77.4 }]);
    const slots = await proto.downloadSafehomes();
    expect(slots[0]).toEqual({ index: 0, enabled: true, lat: 12.8, lon: 77.4 });
    expect(slots[1].enabled).toBe(false);
  });

  it("refuses more safehomes than the firmware has slots", async () => {
    const proto = makeCopter();
    const nine = Array.from({ length: 9 }, (_, index) => ({ index, enabled: true, lat: 1, lon: 1 }));
    expect((await proto.uploadSafehomes(nine)).success).toBe(false);
  });
});

describe("geozone table", () => {
  const zone = { number: 1, type: 0, shape: 1, minAlt: 0, maxAlt: 5000, isSeaLevelRef: false, fenceAction: 0, vertexCount: 4 };
  const vertices = [
    { geozoneId: 1, vertexIdx: 0, lat: 12.91, lon: 77.59 }, { geozoneId: 1, vertexIdx: 1, lat: 12.93, lon: 77.59 },
    { geozoneId: 1, vertexIdx: 2, lat: 12.93, lon: 77.61 }, { geozoneId: 1, vertexIdx: 3, lat: 12.91, lon: 77.61 },
  ];

  it("upload then download round-trips zones and their vertices", async () => {
    const proto = makePlane();
    await proto.uploadGeozones([zone], vertices);
    const read = await proto.downloadGeozones();
    expect(read.zones).toEqual([zone]);
    expect(read.vertices).toHaveLength(4);
  });

  it("an upload replaces every zone the FC held", async () => {
    const proto = makePlane();
    await proto.uploadGeozones([zone], vertices);
    await proto.uploadGeozones([], []);
    expect(await proto.downloadGeozones()).toEqual({ zones: [], vertices: [] });
  });

  it("refuses a zone outside the firmware's slots", async () => {
    const proto = makePlane();
    expect((await proto.uploadGeozones([{ ...zone, number: 63 }], [])).success).toBe(false);
  });
});

// ── Telemetry callbacks fire on interval ─────────────────────

describe("telemetry tick", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("attitude callback fires after 100ms interval", async () => {
    const proto = makeCopter();
    // connect() awaits a 300ms delay; advance past it so the promise resolves.
    const connectP = proto.connect(fakeTransport());
    await vi.advanceTimersByTimeAsync(300);
    await connectP;

    const received: number[] = [];
    proto.onAttitude((d) => received.push(d.timestamp));

    vi.advanceTimersByTime(350);
    expect(received.length).toBeGreaterThanOrEqual(3);
    await proto.disconnect();
  });

  it("battery drains over time in flight", async () => {
    const proto = makeCopter();
    const connectP = proto.connect(fakeTransport());
    await vi.advanceTimersByTimeAsync(300);
    await connectP;
    await proto.arm();

    const levels: number[] = [];
    proto.onBattery((d) => levels.push(d.remaining));

    vi.advanceTimersByTime(500);
    expect(levels.length).toBeGreaterThanOrEqual(4);
    // Battery should have drained slightly
    const first = levels[0];
    const last = levels[levels.length - 1];
    expect(last).toBeLessThan(first);
    await proto.disconnect();
  });

  it("disconnect stops telemetry callbacks", async () => {
    const proto = makeCopter();
    const connectP = proto.connect(fakeTransport());
    await vi.advanceTimersByTimeAsync(300);
    await connectP;

    const received: number[] = [];
    proto.onAttitude((d) => received.push(d.timestamp));

    vi.advanceTimersByTime(200);
    const countBefore = received.length;

    await proto.disconnect();
    vi.advanceTimersByTime(500);
    expect(received.length).toBe(countBefore);
  });

  it("starts disarmed on the ground and follows arm/disarm", async () => {
    const proto = makeCopter();
    const connectP = proto.connect(fakeTransport());
    await vi.advanceTimersByTimeAsync(300);
    await connectP;

    const armed: boolean[] = [];
    proto.onHeartbeat((hb) => armed.push(hb.armed));
    const alts: (number | undefined)[] = [];
    proto.onPosition((p) => alts.push(p.relativeAlt));

    vi.advanceTimersByTime(150);
    expect(armed.at(-1)).toBe(false);
    expect(alts.at(-1)).toBe(0);
    expect((await proto.setMotorTestOutputs([20, 0, 0, 0], 2)).success).toBe(true);

    await proto.arm();
    vi.advanceTimersByTime(150);
    expect(armed.at(-1)).toBe(true);
    expect((await proto.setMotorTestOutputs([20, 0, 0, 0], 2)).success).toBe(false);

    await proto.disarm();
    vi.advanceTimersByTime(150);
    expect(armed.at(-1)).toBe(false);
    await proto.disconnect();
  });
});

// ── Seeded config from constructor ───────────────────────────

describe("constructor seeding", () => {
  it("constructor-provided safehomes are immediately readable", async () => {
    const proto = new INavMockProtocol({
      vehicleClass: "copter",
      safehomes: [{ index: 3, enabled: true, lat: 12.0, lon: 77.0 }],
    });
    const slots = await proto.downloadSafehomes();
    expect(slots[3].enabled).toBe(true);
  });

  it("constructor-provided geozones are immediately readable", async () => {
    const proto = new INavMockProtocol({
      vehicleClass: "plane",
      geozones: [{ number: 2, type: 0, shape: 0, minAlt: 0, maxAlt: 9000, isSeaLevelRef: false, fenceAction: 0, vertexCount: 1 }],
      geozoneVertices: [{ geozoneId: 2, vertexIdx: 0, lat: 12.0, lon: 77.0, radius: 20000 }],
    });
    const read = await proto.downloadGeozones();
    expect(read.zones.map((z) => z.number)).toEqual([2]);
    expect(read.vertices[0].radius).toBe(20000);
  });

  it("constructor-provided waypoints are reflected in getINavWaypoints", async () => {
    const proto = new INavMockProtocol({
      vehicleClass: "copter",
      missionWaypoints: [
        { number: 1, action: INAV_WP_ACTION.WAYPOINT, lat: 12.9, lon: 77.5, altitude: 50, p1: 0, p2: 0, p3: 0, flag: INAV_WP_FLAG_LAST },
      ],
    });
    const wps = proto.getINavWaypoints();
    expect(wps).toHaveLength(1);
    expect(wps[0].flag).toBe(INAV_WP_FLAG_LAST);
  });
});
