/**
 * Fly Here while the ADOS pilot flies the drone: the map point goes to the
 * pilot as a `goto` action with the altitude above home, never as a
 * flight-controller reposition, and the pilot's refusal reaches the operator.
 * Without the pilot (or when the pilot does not take a `goto` from a surface)
 * the flight-controller reposition stays.
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
import {
  handlePilotServerFrame,
  setPilotSender,
  usePilotLinkStore,
  type PilotOutboundFrame,
} from "@/lib/input/pilot-stream";
import type { PilotState } from "@/lib/hud/cockpit-frames";
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

function ctx(): SkillContext {
  const protocol = useDroneManager.getState().drones.get(DRONE)!.protocol;
  return {
    droneId: DRONE,
    protocol,
    armState: "armed",
    flightMode: "GUIDED",
    availableModes: [],
    missionState: null,
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
  } as unknown as SkillContext;
}

function pilotWith(surfaceOps: string[], owner = "pilot"): void {
  useNavStreamStore
    .getState()
    .setPilot(DRONE, { controlMode: "ados", surfaceOps, owner } as unknown as PilotState, Date.now());
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
  useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
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

  it("keeps the flight-controller reposition when the pilot takes no goto", async () => {
    pilotWith([]);
    await activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30);
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });

  it.each(["mission_fc", "skill", "fc_mode", "goto"])(
    "sends the pilot the goto whatever runs now (owner %s)",
    async (owner) => {
      pilotWith(["goto"], owner);
      const done = activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
      await answer(true);
      await done;
      expect(frames.find((f) => f.op === "action")).toMatchObject({ name: "goto" });
      expect(guidedGoto).not.toHaveBeenCalled();
    },
  );

  it.each(["fc_manual", "elrs"])("repositions the flight controller under %s control", async (mode) => {
    handlePilotServerFrame(DRONE, { kind: "pilot", data: { control_mode: mode } });
    pilotWith(["goto"]);
    await activate("fly-here", ctx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30);
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });
});
