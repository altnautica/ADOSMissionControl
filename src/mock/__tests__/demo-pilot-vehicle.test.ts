/**
 * @module mock/demo-pilot-vehicle.test
 * @description The demo pilot mirrors and drives the demo vehicle: a drone
 * flying its mission in AUTO reads as the FC's mission on the waypoint it
 * flies toward, Pause holds it with the mission paused and Resume carries on,
 * Land puts it down and disarms it, RTH flies it home, a stick session that
 * stops holds with `controller-lost`, a frozen link stops the pilot kind, and
 * a blocked nav stream falls back to the reduced-rate poll.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { chipFacts, flightStateChip, type ChipView } from "@/lib/hud/flight-state";
import { NAV_STATUS_POLL_MS, NAV_STREAM_FALLBACK_MS } from "@/lib/agent/nav-stream";
import { onPilotState, requestPilotAction, sendPilotInput } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { MockNavStream } from "@/mock/mock-nav";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { FLIGHT_PATHS } from "@/mock/flight-paths";
import { haversineDistance } from "@/lib/geo/distance";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId, useNodeRegistryStore } from "@/stores/node-registry";

const ID = resolveNodeId("alpha-1");

function vehicle(): MockProtocol {
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
  expect(protocol).toBeInstanceOf(MockProtocol);
  return protocol as MockProtocol;
}

function pilotFeed(): { data: PilotState; receivedAt: number } {
  const feed = useNavStreamStore.getState().byDrone[ID]?.pilot;
  expect(feed).toBeDefined();
  return feed!;
}

function chip(): ChipView {
  const { data, receivedAt } = pilotFeed();
  return flightStateChip(
    chipFacts(data, Date.now() - receivedAt, { homeDistM: null, modeDetail: null, completeAgeMs: null }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mockEngine.start(50);
  vehicle().flight.init({ armed: true, airborne: true, mode: "AUTO" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  vi.useRealTimers();
});

describe("demo pilot mirrors the demo vehicle", () => {
  it("reads an armed AUTO flight as the FC's mission on its waypoint", () => {
    const { data } = pilotFeed();
    const progress = vehicle().flight.missionProgress;
    expect(progress).not.toBeNull();
    expect(progress!.total).toBeGreaterThan(0);
    expect(data).toMatchObject({ owner: "mission_fc", armed: true, landed: false, fcModeName: "AUTO" });
    expect(data.mission).toMatchObject({ state: "active", seq: progress!.seq, total: progress!.total, landingSeq: false });
    expect(chip().text).toMatch(new RegExp(`^MISSION · WP ${progress!.seq}/${progress!.total}`));
  });

  it("pauses the mission in a hold, then resumes it in AUTO", async () => {
    expect((await requestPilotAction("pause")).ok).toBe(true);
    expect(vehicle().flight.mode).toBe("LOITER");
    const { data } = pilotFeed();
    expect(data.owner).toBe("fc_mode");
    expect(data.mission?.state).toBe("paused");
    expect(chip()).toMatchObject({ ruleId: "mission_paused", button: "resume" });
    expect(chip().text).toMatch(/^MISSION PAUSED · WP \d+\/\d+$/);

    // The demo vehicle holds where it paused.
    const at = useNodeRegistryStore.getState().getEntry(ID)!.fc.position!;
    vi.advanceTimersByTime(1000);
    const now = useNodeRegistryStore.getState().getEntry(ID)!.fc.position!;
    expect(now.groundSpeed).toBe(0);
    expect(haversineDistance(at.lat, at.lon, now.lat, now.lon)).toBeLessThan(5);

    expect((await requestPilotAction("resume")).ok).toBe(true);
    expect(vehicle().flight.mode).toBe("AUTO");
    expect(pilotFeed().data).toMatchObject({ owner: "mission_fc", mission: { state: "active" } });
  });

  it("lands and disarms the demo vehicle", async () => {
    expect((await requestPilotAction("land")).ok).toBe(true);
    expect(vehicle().flight).toMatchObject({ airborne: false, armed: false });
    expect(pilotFeed().data).toMatchObject({ owner: "idle", armed: false, landed: true });
    vi.advanceTimersByTime(500);
    expect(useNodeRegistryStore.getState().getEntry(ID)?.fc.armState).toBe("disarmed");
    expect(chip().ruleId).toBe("idle_ready");
  });

  it("refuses a disarm in flight", async () => {
    expect(await requestPilotAction("disarm")).toEqual({ ok: false, err: "not_landed" });
    expect(vehicle().flight.armed).toBe(true);
  });

  it("flies home on RTH, then touches down and disarms there", async () => {
    expect((await requestPilotAction("rth")).ok).toBe(true);
    expect(vehicle().flight.mode).toBe("RTL");
    expect(pilotFeed().data.owner).toBe("fc_mode");
    expect(chip().ruleId).toBe("fc_rth");

    for (let i = 0; i < 600 && vehicle().flight.airborne; i++) vi.advanceTimersByTime(1000);
    expect(vehicle().flight).toMatchObject({ airborne: false, armed: false });
    const home = FLIGHT_PATHS[0][0];
    const pos = useNodeRegistryStore.getState().getEntry(ID)!.fc.position!;
    expect(haversineDistance(home.lat, home.lon, pos.lat, pos.lon)).toBeLessThan(5);
    vi.advanceTimersByTime(200);
    expect(pilotFeed().data).toMatchObject({ owner: "idle", landed: true });
  });

  it("kill stops the motors", async () => {
    expect((await requestPilotAction("kill")).ok).toBe(true);
    expect(vehicle().flight).toMatchObject({ armed: false, airborne: false });
  });

  it("holds with controller-lost when the stick session stops streaming", async () => {
    expect((await requestPilotAction("take_control")).ok).toBe(true);
    sendPilotInput([0, 0, 0, 0], 0);
    vi.advanceTimersByTime(100);
    expect(pilotFeed().data).toMatchObject({ owner: "pilot", holdReason: null });
    vi.advanceTimersByTime(400);
    expect(pilotFeed().data.holdReason).toBe("controller-lost");
  });
});

describe("demo link faults", () => {
  it("freezeTelemetry stops the pilot kind, so the chip dims to LINK", () => {
    const frames: number[] = [];
    const off = onPilotState(() => frames.push(Date.now()));
    const before = pilotFeed().receivedAt;
    mockEngine.freezeTelemetry();
    vi.advanceTimersByTime(2500);
    expect(frames).toHaveLength(0);
    expect(pilotFeed().receivedAt).toBe(before);
    expect(chip()).toMatchObject({ ruleId: "link_stale", text: "LINK", dim: true });

    mockEngine.resumeTelemetry();
    vi.advanceTimersByTime(200);
    off();
    expect(frames.length).toBeGreaterThan(0);
    expect(chip().ruleId).not.toBe("link_stale");
  });

  it("a blocked nav stream falls back to the reduced-rate poll", () => {
    const nav = new MockNavStream((grey, w, h) => `png:${w}x${h}:${grey.length}`);
    nav.start(ID, Date.now());
    try {
      vi.advanceTimersByTime(NAV_STATUS_POLL_MS);
      expect(useNavStreamStore.getState().byDrone[ID]?.transport).toBe("stream");

      mockEngine.blockNavStream(true);
      const blockedAt = Date.now();
      vi.advanceTimersByTime(NAV_STREAM_FALLBACK_MS - NAV_STATUS_POLL_MS);
      // Nothing arrives while the bridge waits out the fallback delay.
      expect(pilotFeed().receivedAt).toBeLessThanOrEqual(blockedAt);
      expect(useNavStreamStore.getState().byDrone[ID]?.transport).toBe("stream");

      vi.advanceTimersByTime(NAV_STATUS_POLL_MS);
      expect(useNavStreamStore.getState().byDrone[ID]?.transport).toBe("poll");

      // The pilot kind now arrives at the poll rate, not 10 Hz.
      const stamps = new Set<number>([pilotFeed().receivedAt]);
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(100);
        stamps.add(pilotFeed().receivedAt);
      }
      expect(stamps.size - 1).toBe(2000 / NAV_STATUS_POLL_MS);

      mockEngine.blockNavStream(false);
      vi.advanceTimersByTime(NAV_STATUS_POLL_MS);
      expect(useNavStreamStore.getState().byDrone[ID]?.transport).toBe("stream");
    } finally {
      nav.stop();
    }
  });
});
