/**
 * A return or landing this ground station commanded is not a failsafe, but
 * only while it lasts: the mode is recorded once the drone accepts the
 * command, and forgotten as soon as the drone is seen leaving it or the drone
 * goes away. A later return the flight controller chose itself then reads as
 * the failsafe it is, and Pause stays refused in it. Every route that commands
 * a return or landing (the skills, the fleet recall, a direct flight
 * controller driven from a fleet board) records it the same way.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above the static imports, so its factory loads the helper itself.
vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
  (await import("../../../../tests/helpers/fleet-drones")).fleetDronesModuleMock(await importOriginal()),
);

import { setFixtureFleet } from "../../../../tests/helpers/fleet-drones";
import { refusalText } from "@/lib/hud/refusal";
import { initSkillSubscriptions } from "@/lib/skills";
import { pauseSkill } from "../builtins/pause";
import { rthSkill } from "../builtins/rth";
import { setModeSkill } from "../builtins/set-mode";
import { fcFailsafeActive, resetCommandedModes } from "../flight-facts";
import { returnFleetToLaunch } from "@/lib/fleet-commands";
import { resolveNodeCommandReach } from "@/lib/nodes/command-sink";
import type { CommandResult } from "@/lib/protocol/types";
import type { FleetDrone } from "@/lib/types";
import type { SkillContext } from "../types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";

const OK: CommandResult = { success: true, resultCode: 0, message: "" };
const REFUSED: CommandResult = { success: false, resultCode: 4, message: "denied" };

const returnToLaunch = vi.fn(async () => OK);
const setFlightMode = vi.fn(async () => OK);

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: "d1",
    protocol: { returnToLaunch, setFlightMode, pauseMission: vi.fn(async () => OK) } as never,
    armState: "armed",
    flightMode: "LOITER",
    availableModes: [],
    missionState: null,
    supports: () => true,
    autonomousNav: "yes",
    checklistReady: true,
    confirm: async () => true,
    notify: () => undefined,
    ...over,
  } as SkillContext;
}

function manage(...ids: string[]): void {
  useDroneManager.setState({
    drones: new Map(
      ids.map((id) => [
        id,
        { id, name: id, protocol: { isConnected: true, returnToLaunch, land: vi.fn(async () => OK), setFlightMode } },
      ]),
    ) as unknown as Map<string, ManagedDrone>,
    selectedDroneId: ids[0] ?? null,
  });
}

/** The selected drone's heartbeat reports `mode`. */
function observe(mode: string): void {
  useDroneStore.getState().setFlightMode(mode as never);
}

let stop: (() => void) | void;

beforeEach(() => {
  resetCommandedModes();
  returnToLaunch.mockReset();
  returnToLaunch.mockImplementation(async () => OK);
  setFlightMode.mockClear();
  useDroneStore.setState({ flightMode: "LOITER", armState: "armed", systemStatus: 4 });
  manage("d1");
  stop = initSkillSubscriptions();
});

afterEach(() => {
  if (typeof stop === "function") stop();
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("a commanded return lasts only while the drone flies it", () => {
  it("reads a later return nobody here asked for as a failsafe, and refuses Pause in it", async () => {
    await rthSkill.activate(ctx());
    observe("RTL");
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(false);
    // The RC pilot takes over and flies on; later a failsafe returns home.
    observe("LOITER");
    observe("RTL");
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
    expect(pauseSkill.getState(ctx({ flightMode: "RTL" }))).toEqual({
      kind: "disabled",
      reason: refusalText("failsafe"),
    });
  });

  it("does not record a return the drone refused", async () => {
    returnToLaunch.mockImplementation(async () => REFUSED);
    await rthSkill.activate(ctx());
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });

  it("counts a return the heartbeat reported before the acknowledgement as seen", async () => {
    observe("RTL");
    await rthSkill.activate(ctx({ flightMode: "RTL" }));
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(false);
    observe("LOITER");
    observe("RTL");
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });

  it("is forgotten when the drone goes away", async () => {
    await rthSkill.activate(ctx());
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });

  it("is replaced by a later mode change the operator asked for", async () => {
    await rthSkill.activate(ctx());
    await setModeSkill.activate(ctx(), { targetMode: "LOITER" });
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });
});

describe("every route that commands a return records it", () => {
  function fleetDrone(id: string): FleetDrone {
    return {
      id,
      name: id,
      status: "in_mission",
      connectionState: "armed",
      flightMode: "AUTO",
      armState: "armed",
      lastHeartbeat: Date.now(),
      fcAttached: true,
      fcLinkLost: false,
    } as FleetDrone;
  }

  it("the fleet recall records each drone that accepted it, and only those", async () => {
    manage("f1", "f2");
    returnToLaunch.mockImplementationOnce(async () => OK).mockImplementationOnce(async () => REFUSED);
    setFixtureFleet({ drones: [fleetDrone("f1"), fleetDrone("f2")] });
    const outcome = await returnFleetToLaunch();
    expect(outcome.acknowledged).toEqual(["f1"]);
    expect(fcFailsafeActive("f1", "RTL", 0)).toBe(false);
    expect(fcFailsafeActive("f2", "RTL", 0)).toBe(true);
  });

  it("a direct flight controller driven from a fleet board records its return and landing", async () => {
    manage("fc-1");
    useDroneManager.setState({ selectedDroneId: null });
    const sink = resolveNodeCommandReach({ deviceId: "fc-1", isDirectFc: true }).sink!;
    await sink.returnToLaunch();
    expect(fcFailsafeActive("fc-1", "RTL", 0)).toBe(false);
    await sink.land();
    expect(fcFailsafeActive("fc-1", "LAND", 0)).toBe(false);
    await sink.setFlightMode("SMART_RTL");
    expect(fcFailsafeActive("fc-1", "SMART_RTL", 0)).toBe(false);
  });
});

describe("a commanded mode the drone never reports does not last", () => {
  afterEach(() => vi.useRealTimers());

  it("reads a return that appears 11 s after an accepted, never-seen return as a failsafe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    await rthSkill.activate(ctx());
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(false);
    vi.setSystemTime(1_011_000);
    observe("RTL");
    expect(fcFailsafeActive("d1", "RTL", 0)).toBe(true);
  });
});

describe("every drone's own heartbeat is observed, selected or not", () => {
  type Beat = { armed: boolean; mode: string; systemStatus: number };
  const beats = new Map<string, (b: Beat) => void>();

  function manageWithHeartbeats(...ids: string[]): void {
    if (typeof stop === "function") stop();
    useDroneManager.setState({
      drones: new Map(
        ids.map((id) => [
          id,
          {
            id,
            name: id,
            protocol: {
              isConnected: true,
              returnToLaunch,
              setFlightMode,
              onHeartbeat: (cb: (b: Beat) => void) => {
                beats.set(id, cb);
                return () => beats.delete(id);
              },
            },
          },
        ]),
      ) as unknown as Map<string, ManagedDrone>,
      selectedDroneId: ids[0] ?? null,
    });
    stop = initSkillSubscriptions();
  }

  function beat(id: string, mode: string): void {
    beats.get(id)?.({ armed: true, mode, systemStatus: 4 });
  }

  const fleetRow = (id: string): FleetDrone =>
    ({
      id,
      name: id,
      status: "in_mission",
      connectionState: "armed",
      flightMode: "AUTO",
      armState: "armed",
      lastHeartbeat: Date.now(),
      fcAttached: true,
      fcLinkLost: false,
    }) as FleetDrone;

  afterEach(() => vi.useRealTimers());

  it("a recalled drone that is not selected, switched to LOITER, then returning on its own is in failsafe", async () => {
    manageWithHeartbeats("sel", "f1");
    setFixtureFleet({ drones: [fleetRow("f1")] });
    expect((await returnFleetToLaunch()).acknowledged).toEqual(["f1"]);
    beat("f1", "RTL");
    beat("f1", "LOITER");
    beat("f1", "RTL");
    expect(fcFailsafeActive("f1", "RTL", 4)).toBe(true);
    expect(pauseSkill.getState(ctx({ droneId: "f1", flightMode: "RTL", systemStatus: 4 }))).toEqual({
      kind: "disabled",
      reason: refusalText("failsafe"),
    });
  });

  it("a recalled drone whose heartbeat shows LOITER, and RTL much later, is in failsafe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000);
    manageWithHeartbeats("sel", "f1");
    setFixtureFleet({ drones: [fleetRow("f1")] });
    expect((await returnFleetToLaunch()).acknowledged).toEqual(["f1"]);
    beat("f1", "LOITER");
    vi.setSystemTime(2_030_000);
    beat("f1", "RTL");
    expect(fcFailsafeActive("f1", "RTL", 4)).toBe(true);
    expect(pauseSkill.getState(ctx({ droneId: "f1", flightMode: "RTL", systemStatus: 4 }))).toEqual({
      kind: "disabled",
      reason: refusalText("failsafe"),
    });
  });
});
