/**
 * The picker and palette show what a press would do now: the skill states are
 * recomputed when the pilot's state changes (a failsafe, a lift-off), when the
 * heartbeat's system status changes, and when a pilot state or the flight
 * controller's landed state ages out with nothing else changing. The flight
 * controller's own landed state (EXTENDED_SYS_STATE) is read from each managed
 * drone's protocol. Teardown stops all of it.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { initSkillSubscriptions, registerBuiltins, useSkillRegistry } from "@/lib/skills";
import { vehicleLanded } from "../flight-facts";
import type { ExtendedSysStateCallback, ProtocolCapabilities } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "drone-subs";
let landedCb: ExtendedSysStateCallback | null = null;
const unsubLanded = vi.fn();

function selectDrone(): void {
  const drone = {
    id: DRONE,
    name: DRONE,
    protocol: {
      isConnected: true,
      getCapabilities: () => ({ supportsAutonomousNav: true }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      onExtendedSysState: (cb: ExtendedSysStateCallback) => {
        landedCb = cb;
        return unsubLanded;
      },
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
}

function pilot(over: Record<string, unknown>): void {
  const data = parsePilotState({ ...pilotFixture, ...over });
  if (!data) throw new Error("fixture");
  useNavStreamStore.getState().setPilot(DRONE, data, Date.now());
}

function stateOf(skillId: string) {
  return useSkillRegistry.getState().getState(DRONE, skillId);
}

/** Let a scheduled recompute run (animation frame). */
function frame(): void {
  vi.advanceTimersByTime(20);
}

let stop: (() => void) | void;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  landedCb = null;
  unsubLanded.mockClear();
  registerBuiltins();
  selectDrone();
  useDroneStore.setState({ armState: "armed", flightMode: "LOITER", systemStatus: 4, lastHeartbeat: Date.now() });
  stop = initSkillSubscriptions();
  useSkillRegistry.getState().recomputeSelected();
});

afterEach(() => {
  if (typeof stop === "function") stop();
  useNavStreamStore.setState({ byDrone: {} });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  vi.useRealTimers();
});

describe("skill states follow the vehicle", () => {
  it("refuse Pause as soon as the pilot reports a flight-controller failsafe", () => {
    pilot({ fc_failsafe: false });
    frame();
    expect(stateOf("pause").kind).not.toBe("disabled");
    pilot({ fc_failsafe: true, failsafe_cause: "fc" });
    frame();
    expect(stateOf("pause")).toEqual({ kind: "disabled", reason: refusalText("failsafe") });
  });

  it("refuse Pause when the heartbeat turns critical", () => {
    frame();
    expect(stateOf("pause").kind).not.toBe("disabled");
    useDroneStore.setState({ systemStatus: 6 });
    frame();
    expect(stateOf("pause")).toMatchObject({ kind: "disabled" });
  });

  it("withdraw Disarm once the pilot's landed state ages out, with nothing else changing", () => {
    pilot({ landed: true });
    frame();
    expect(stateOf("disarm").kind).toBe("idle");
    vi.advanceTimersByTime(2500);
    expect(stateOf("disarm")).toEqual({ kind: "disabled", reason: refusalText("landed_unknown") });
  });

  it("read the flight controller's own landed state", () => {
    expect(landedCb).not.toBeNull();
    landedCb!({ timestamp: Date.now(), vtolState: 0, landedState: 1 });
    expect(vehicleLanded(DRONE)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(stateOf("disarm").kind).toBe("idle");
    landedCb!({ timestamp: Date.now(), vtolState: 0, landedState: 2 });
    vi.advanceTimersByTime(1000);
    expect(stateOf("disarm")).toEqual({ kind: "disabled", reason: refusalText("not_landed") });
  });

  it("stop on teardown", () => {
    pilot({ fc_failsafe: false });
    frame();
    expect(typeof stop).toBe("function");
    (stop as () => void)();
    stop = undefined;
    expect(unsubLanded).toHaveBeenCalled();
    pilot({ fc_failsafe: true, failsafe_cause: "fc" });
    vi.advanceTimersByTime(1500);
    expect(stateOf("pause").kind).not.toBe("disabled");
  });
});
