/**
 * @module mock/demo-pilot-stall.test
 * @description A mission stall pinned through `window.__adosDemoPilot.pin`
 * reaches the pilot frame as the agent sends it: a mission stall counts down
 * to an automatic skip that records the waypoint as a gap, a held stall waits
 * for the operator, and a blocked return counts down to a landing. The demo
 * pilot answers Skip waypoint, Return and Land here by ending the stall.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Arming starts the flight log's weather and place lookups; keep them off the
// network so no request outlives the test file.
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => undefined }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => undefined }));

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";

const ID = resolveNodeId("alpha-1");
const MISSION = { state: "active", seq: 3, total: 6 };

function vehicle(): MockProtocol {
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
  expect(protocol).toBeInstanceOf(MockProtocol);
  return protocol as MockProtocol;
}

function pilot(): PilotState {
  const feed = useNavStreamStore.getState().byDrone[ID]?.pilot;
  expect(feed).toBeDefined();
  return feed!.data;
}

function pinStall(stall: Record<string, unknown>, holdReason: string): void {
  window.__adosDemoPilot!.pin({
    owner: "mission_fc",
    mission: MISSION,
    mission_stall: { since_ms: Date.now(), window_s: 15, ...stall },
    hold_reason: holdReason,
  });
}

const MISSION_STALL = { kind: "mission", seq: 3, wp_label: "3", skip_in_s: 45 };

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  vehicle().flight.init({ armed: true, airborne: true, mode: "AUTO" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo mission stall", () => {
  it("a pinned mission stall counts down, then skips the waypoint on its own and records the gap", () => {
    pinStall(MISSION_STALL, "mission-stalled");
    expect(pilot().missionStall).toMatchObject({ kind: "mission", seq: 3, wpLabel: "3", windowS: 15 });
    expect(pilot().holdReason).toBe("mission-stalled");
    expect(pilot().missionStall!.skipInS).toBeCloseTo(45, 0);

    vi.advanceTimersByTime(10_000);
    expect(pilot().missionStall!.skipInS).toBeCloseTo(35, 0);

    vi.advanceTimersByTime(36_000);
    expect(pilot().missionStall).toBeNull();
    expect(pilot().holdReason).toBeNull();
    expect(pilot().mission?.gaps).toEqual([expect.objectContaining({ seq: 3, reason: "stall_timeout" })]);
    expect(pilot().banner?.textKey).toBe("pilot.banner.mission_wp_skipped");
  });

  it("a held stall waits for the operator, and Skip waypoint ends it", async () => {
    pinStall({ ...MISSION_STALL, skip_in_s: null }, "mission-stalled");
    vi.advanceTimersByTime(120_000);
    expect(pilot().missionStall).toMatchObject({ kind: "mission", skipInS: null });

    await expect(requestPilotAction("mission_skip")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().missionStall).toBeNull();
    expect(pilot().mission?.gaps).toEqual([expect.objectContaining({ seq: 3, reason: "stall_operator" })]);
    expect(pilot().banner).toMatchObject({ textKey: "pilot.banner.mission_wp_skipped", args: { wp: "3" } });
  });

  it("Return ends a mission stall and returns", async () => {
    pinStall(MISSION_STALL, "mission-stalled");
    await expect(requestPilotAction("rth")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().missionStall).toBeNull();
    expect(pilot().mission?.gaps ?? []).toEqual([]);
    expect(vehicle().flight.mode).toBe("RTL");
  });

  it("a blocked return counts down to a landing", () => {
    pinStall({ kind: "return", seq: null, wp_label: null, skip_in_s: 45 }, "return-blocked");
    expect(pilot().missionStall).toMatchObject({ kind: "return", seq: null });
    vi.advanceTimersByTime(46_000);
    expect(pilot().missionStall).toBeNull();
    expect(vehicle().flight.airborne).toBe(false);
  });

  it("Land here ends a blocked return and lands", async () => {
    pinStall({ kind: "return", seq: null, wp_label: null, skip_in_s: 45 }, "return-blocked");
    await expect(requestPilotAction("land")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().missionStall).toBeNull();
    expect(vehicle().flight.airborne).toBe(false);
  });

  it("refuses Skip waypoint with no stall up as no_stall, read through the refusal table", async () => {
    const r = await requestPilotAction("mission_skip");
    expect(r).toEqual({ ok: false, err: "no_stall" });
    expect(refusalText(r.err)).toBe("No stalled waypoint to skip");
  });
});
