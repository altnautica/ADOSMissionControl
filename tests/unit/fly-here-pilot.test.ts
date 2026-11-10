/**
 * Fly Here sends what the map offers, re-read at the press: while the ADOS
 * pilot takes a goto (fresh state listing `goto`, ADOS control, flying, no
 * failsafe) the map point goes to the pilot as a `goto` action with the
 * altitude above home, never as a flight-controller reposition, and the
 * pilot's refusal reaches the operator. Otherwise the flight controller is
 * repositioned only while it already flies GUIDED, and never switched into
 * it; with neither route the press is refused and nothing is sent.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import strings from "@/lib/cockpit-spec/setup-strings.json";
import { activate } from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { resetCooldownState } from "@/lib/skills/cooldown";
import { cancelGuidedTarget } from "@/lib/skills/guided-target";
import { flyHereSkill } from "@/lib/skills/builtins/fly-here";
import { flyHereRoute } from "@/components/map/map-point";
import { refusalText } from "@/lib/hud/refusal";
import {
  handlePilotServerFrame,
  setPilotSender,
  usePilotLinkStore,
  type PilotOutboundFrame,
} from "@/lib/input/pilot-stream";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import type { FlightMode } from "@/lib/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGuidedStore } from "@/stores/guided-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import type { SkillContext } from "@/lib/skills/types";

const ACCEPTED: CommandResult = { success: true, resultCode: 0, message: "Accepted" };
let seq = 0;
let DRONE = "";

const guidedGoto = vi.fn(async (): Promise<CommandResult> => ACCEPTED);
let frames: PilotOutboundFrame[];

/** The FC flies `mode`, armed; the dispatcher's context reads the same. */
function fcIn(mode: FlightMode): void {
  useDroneStore.setState({ flightMode: mode, armState: "armed", connectionState: "armed", lastHeartbeat: Date.now() });
}

function ctx(): SkillContext {
  const protocol = useDroneManager.getState().drones.get(DRONE)!.protocol;
  return {
    droneId: DRONE,
    protocol,
    armState: "armed",
    flightMode: useDroneStore.getState().flightMode,
    availableModes: [],
    missionState: null,
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
  } as unknown as SkillContext;
}

/** A pilot state, flying, received `ageMs` ago. */
function pilotWith(surfaceOps: string[], owner = "pilot", controlMode = "ados", ageMs = 0): void {
  useNavStreamStore.getState().setPilot(
    DRONE,
    { controlMode, surfaceOps, owner, armed: true, landed: false, fcFailsafe: false } as unknown as PilotState,
    Date.now() - ageMs,
  );
}

/** Answer the next sent action as the pilot would. */
async function answer(ok: boolean, err?: string): Promise<void> {
  await vi.waitFor(() => expect(frames.some((f) => f.op === "action")).toBe(true));
  const a = frames.find((f) => f.op === "action") as Extract<PilotOutboundFrame, { op: "action" }>;
  handlePilotServerFrame(DRONE, { kind: "action_result", name: a.name, id: a.id, ok, err });
}

beforeEach(() => {
  seq += 1;
  // A fresh drone per test: the dispatcher debounces a skill per drone.
  DRONE = `fly-here-pilot-${seq}`;
  frames = [];
  guidedGoto.mockClear();
  resetCooldownState();
  useSkillRegistry.setState({ skills: new Map(), states: new Map(), _order: new Map(), _seq: 0 });
  useSkillRegistry.getState().register(flyHereSkill);
  const protocol = {
    isConnected: true,
    guidedGoto,
    getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
    getFirmwareHandler: () => null,
    getCapabilities: () => ({}),
  } as unknown as DroneProtocol;
  useDroneManager.setState({
    selectedDroneId: DRONE,
    drones: new Map([[DRONE, { id: DRONE, name: "Alpha", protocol } as unknown as ManagedDrone]]),
  });
  fcIn("GUIDED");
  setPilotSender((f) => {
    frames.push(f);
    return true;
  }, DRONE);
  handlePilotServerFrame(DRONE, { kind: "pilot", data: { control_mode: "ados" } });
});

afterEach(() => {
  cancelGuidedTarget();
  setPilotSender(null);
  usePilotLinkStore.getState().set({ controlMode: null, agentFor: null });
  useNavStreamStore.setState({ byDrone: {} });
  useGuidedStore.setState({ confirmPending: null, target: null });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("Fly Here through the pilot", () => {
  it("sends the pilot a goto with the altitude above home, not a reposition", async () => {
    pilotWith(["goto"]);
    const done = activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    await answer(true);
    await done;
    expect(frames.find((f) => f.op === "action")).toMatchObject({
      op: "action",
      name: "goto",
      args: { lat: 10, lon: 20, alt_m: 30 },
    });
    expect(guidedGoto).not.toHaveBeenCalled();
  });

  it.each(["bad_args", "not_armed", "landed", "tuning", "no_home", "launching", "control_mode", "failsafe"])(
    "shows the pilot's %s refusal",
    async (code) => {
      pilotWith(["goto"]);
      const c = ctx();
      const done = activate("fly-here", c, { lat: 10, lon: 20, altitudeM: 30 });
      await answer(false, code);
      await done;
      expect(c.notify).toHaveBeenCalledWith((strings.strings as Record<string, string>)[`refusal.${code}`], "error");
      expect(guidedGoto).not.toHaveBeenCalled();
    },
  );

  it.each(["mission_fc", "skill", "fc_mode", "goto"])(
    "sends the pilot the goto whatever runs now (owner %s)",
    async (owner) => {
      fcIn("AUTO");
      pilotWith(["goto"], owner);
      const done = activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
      await answer(true);
      await done;
      expect(frames.find((f) => f.op === "action")).toMatchObject({ name: "goto" });
      expect(guidedGoto).not.toHaveBeenCalled();
    },
  );
});

describe("Fly Here through the flight controller", () => {
  it("repositions the FC in GUIDED without a mode change when the pilot takes no goto", async () => {
    pilotWith([]);
    await activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30, { changeMode: false });
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });

  it.each(["fc_manual", "elrs"])("repositions the FC in GUIDED under %s control", async (mode) => {
    handlePilotServerFrame(DRONE, { kind: "pilot", data: { control_mode: mode } });
    pilotWith(["goto"], "pilot", mode);
    await activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30, { changeMode: false });
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });

  it.each(["ALT_HOLD", "AUTO", "LOITER"] as const)(
    "never switches the FC into GUIDED from %s when the pilot takes no goto",
    async (mode) => {
      fcIn(mode);
      pilotWith([]);
      const c = ctx();
      await activate("fly-here", c, { lat: 10, lon: 20, altitudeM: 30 });
      expect(guidedGoto).not.toHaveBeenCalled();
      expect(frames.some((f) => f.op === "action")).toBe(false);
      expect(c.notify).toHaveBeenCalledWith(expect.stringContaining(refusalText("bad_state")), "error");
    },
  );
});

describe("Fly Here sends the route offered at the press", () => {
  it("refuses, and repositions nothing, when the pilot goes stale between the offer and the send in ALT_HOLD", async () => {
    fcIn("ALT_HOLD");
    pilotWith(["goto"]);
    expect(flyHereRoute(DRONE)).toBe("pilot");
    // The confirm hold runs; the pilot's state stops arriving meanwhile.
    pilotWith(["goto"], "pilot", "ados", 2500);
    const c = ctx();
    await activate("fly-here", c, { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).not.toHaveBeenCalled();
    expect(frames.some((f) => f.op === "action")).toBe(false);
    expect(c.notify).toHaveBeenCalledWith(expect.stringContaining(refusalText("bad_state")), "error");
  });

  it("refuses when the pilot reports a failsafe at the send", async () => {
    fcIn("RTL");
    useNavStreamStore.getState().setPilot(
      DRONE,
      { controlMode: "ados", surfaceOps: ["goto"], armed: true, landed: false, fcFailsafe: true } as unknown as PilotState,
      Date.now(),
    );
    await activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).not.toHaveBeenCalled();
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });
});
