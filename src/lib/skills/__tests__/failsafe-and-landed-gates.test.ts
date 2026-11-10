/**
 * Pause is refused while the flight controller flies a failsafe return or
 * landing (also on the flight-controller fallback), and Disarm (with the arm
 * binding's flip to it) is offered only while the vehicle is known to be on
 * the ground: the fresh pilot's `landed`, else the flight controller's own
 * landed state. Unknown is refused like airborne, each with its own text.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";

import { disarmSkill } from "../builtins/disarm";
import { pauseSkill } from "../builtins/pause";
import { rthSkill } from "../builtins/rth";
import { resolveBoundSkillId } from "../bound-skill";
import {
  fcFailsafeActive,
  forgetDrone,
  noteFcLandedState,
  observeFlightMode,
  resetCommandedModes,
  vehicleLanded,
} from "../flight-facts";
import { refusalText } from "@/lib/hud/refusal";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import type { SkillContext } from "../types";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const OK = { success: true, resultCode: 0, message: "" };

/** MAV_LANDED_STATE values. */
const ON_GROUND = 1;
const IN_AIR = 2;

const setFlightMode = vi.fn(async () => OK);
const disarm = vi.fn(async () => OK);

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  const protocol = {
    setFlightMode,
    pauseMission: vi.fn(async () => OK),
    returnToLaunch: vi.fn(async () => OK),
    disarm,
  };
  return {
    droneId: "d1",
    protocol: protocol as never,
    armState: "armed",
    flightMode: "LOITER",
    availableModes: [],
    missionState: null,
    supports: () => true,
    autonomousNav: "yes",
    checklistReady: true,
    confirm: async () => ({ approved: true }) as never,
    notify: () => undefined,
    ...over,
  } as SkillContext;
}

function setHeight(m: number) {
  useTelemetryStore.getState().position.push({ timestamp: Date.now(), lat: 1, lon: 1, alt: m, relativeAlt: m } as never);
}

function pilotLanded(landed: boolean, receivedAt: number) {
  const data = parsePilotState({ ...pilotFixture, landed });
  useNavStreamStore.setState({ byDrone: { d1: { pilot: { data, receivedAt } } } as never });
}

describe("Pause during a flight-controller failsafe", () => {
  beforeEach(() => {
    resetCommandedModes();
    setFlightMode.mockClear();
  });

  it("is refused while the FC flies an RTL nobody here asked for", async () => {
    const c = ctx({ flightMode: "RTL" });
    expect(pauseSkill.getState(c)).toEqual({ kind: "disabled", reason: refusalText("failsafe") });
    const r = await pauseSkill.activate(c);
    expect(r).toMatchObject({ success: false, message: refusalText("failsafe") });
    expect(setFlightMode).not.toHaveBeenCalled();
  });

  it("is refused while the heartbeat reports EMERGENCY", () => {
    expect(pauseSkill.getState(ctx({ flightMode: "AUTO", systemStatus: 6 }))).toMatchObject({ kind: "disabled" });
  });

  it("stays available in a return this ground station commanded", async () => {
    const c = ctx({ flightMode: "RTL" });
    await rthSkill.activate(c);
    observeFlightMode("d1", "RTL");
    expect(pauseSkill.getState(c).kind).not.toBe("disabled");
  });

  it("is refused in a later return nobody here asked for", async () => {
    await rthSkill.activate(ctx());
    observeFlightMode("d1", "RTL");
    observeFlightMode("d1", "LOITER");
    observeFlightMode("d1", "RTL");
    expect(pauseSkill.getState(ctx({ flightMode: "RTL" }))).toEqual({
      kind: "disabled",
      reason: refusalText("failsafe"),
    });
  });
});

describe("the fresh pilot's failsafe flag decides", () => {
  function pilotSays(fcFailsafe: boolean, ageMs: number) {
    const data = parsePilotState({ ...pilotFixture, fc_failsafe: fcFailsafe, failsafe_cause: fcFailsafe ? "fc" : null });
    useNavStreamStore.setState({ byDrone: { d1: { pilot: { data, receivedAt: Date.now() - ageMs } } } as never });
  }
  beforeEach(() => resetCommandedModes());
  afterEach(() => useNavStreamStore.setState({ byDrone: {} }));

  it("refuses Pause when the pilot reports an FC failsafe, whatever the mode looks like", () => {
    pilotSays(true, 100);
    expect(fcFailsafeActive("d1", "LOITER", 0)).toBe(true);
    expect(pauseSkill.getState(ctx({ flightMode: "LOITER" }))).toMatchObject({ kind: "disabled" });
  });

  it("allows Pause in an RTL the pilot says is no failsafe", () => {
    pilotSays(false, 100);
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(false);
  });

  it("falls back to the FC's own state once the pilot is stale", () => {
    pilotSays(false, 2000);
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });
});

describe("Disarm only on the ground", () => {
  const LANDED_UNKNOWN = { kind: "disabled", reason: refusalText("landed_unknown") };
  const NOT_LANDED = { kind: "disabled", reason: refusalText("not_landed") };
  const armBinding = () => resolveBoundSkillId("arm", "armed", { missionState: null, droneId: "d1" });

  beforeEach(() => {
    useNavStreamStore.setState({ byDrone: {} });
    useTelemetryStore.getState().clear();
    forgetDrone("d1");
    disarm.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    useTelemetryStore.getState().clear();
    useNavStreamStore.setState({ byDrone: {} });
    forgetDrone("d1");
  });

  it("is refused while nothing says whether the vehicle is landed, even low over home", async () => {
    setHeight(0.5);
    expect(vehicleLanded("d1")).toBeNull();
    expect(disarmSkill.getState(ctx())).toEqual(LANDED_UNKNOWN);
    expect(armBinding()).toBe("arm");
    await expect(disarmSkill.activate(ctx())).resolves.toMatchObject({
      success: false,
      message: refusalText("landed_unknown"),
    });
    expect(disarm).not.toHaveBeenCalled();
  });

  it("is refused in the air with the land-first text, and the arm binding never flips to it", async () => {
    noteFcLandedState("d1", IN_AIR);
    expect(disarmSkill.getState(ctx())).toEqual(NOT_LANDED);
    expect(armBinding()).toBe("arm");
    await expect(disarmSkill.activate(ctx())).resolves.toMatchObject({
      success: false,
      message: refusalText("not_landed"),
    });
    expect(disarm).not.toHaveBeenCalled();
  });

  it("is offered on the ground the flight controller reports", async () => {
    noteFcLandedState("d1", ON_GROUND);
    expect(disarmSkill.getState(ctx()).kind).toBe("idle");
    expect(armBinding()).toBe("disarm");
    await disarmSkill.activate(ctx());
    expect(disarm).toHaveBeenCalledTimes(1);
  });

  it("reads a stale flight-controller landed state as unknown", () => {
    noteFcLandedState("d1", ON_GROUND, Date.now() - 6000);
    expect(disarmSkill.getState(ctx())).toEqual(LANDED_UNKNOWN);
  });

  it("takes the fresh pilot's landed over the flight controller's", () => {
    noteFcLandedState("d1", ON_GROUND);
    pilotLanded(false, Date.now());
    expect(disarmSkill.getState(ctx())).toEqual(NOT_LANDED);
    expect(armBinding()).toBe("arm");
  });

  it("stops trusting the pilot's landed at exactly 2 s", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    pilotLanded(true, 10_000 - 1999);
    expect(vehicleLanded("d1")).toBe(true);
    pilotLanded(true, 10_000 - 2000);
    expect(vehicleLanded("d1")).toBeNull();
    expect(disarmSkill.getState(ctx())).toEqual(LANDED_UNKNOWN);
  });
});

describe("Disarm on firmware with no landed state", () => {
  const armBinding = () => resolveBoundSkillId("arm", "armed", { missionState: null, droneId: "d1" });

  function manageAs(protocolName: string) {
    useDroneManager.setState({
      drones: new Map([["d1", { id: "d1", name: "d1", protocol: { protocolName, isConnected: true, disarm } }]]) as unknown as Map<
        string,
        ManagedDrone
      >,
    });
  }

  beforeEach(() => {
    useNavStreamStore.setState({ byDrone: {} });
    forgetDrone("d1");
    disarm.mockClear();
  });
  afterEach(() => useDroneManager.setState({ drones: new Map() }));

  it("is reachable on an armed MSP drone with no pilot, behind its confirm", async () => {
    manageAs("msp");
    expect(disarmSkill.getState(ctx()).kind).toBe("idle");
    expect(armBinding()).toBe("disarm");
    await disarmSkill.activate(ctx());
    expect(disarm).toHaveBeenCalledTimes(1);
  });

  it("stays refused on an armed MAVLink drone whose landed state is unknown", async () => {
    manageAs("mavlink");
    expect(disarmSkill.getState(ctx())).toEqual({ kind: "disabled", reason: refusalText("landed_unknown") });
    expect(armBinding()).toBe("arm");
    await disarmSkill.activate(ctx());
    expect(disarm).not.toHaveBeenCalled();
  });
});
