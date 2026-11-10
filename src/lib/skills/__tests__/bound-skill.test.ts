/**
 * The binding resolver (an arm binding disarms an armed vehicle, a pause
 * binding resumes a paused mission) and the dispatcher's confirm contract
 * (the sheet names the drone, and the vehicle is re-read after approval).
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  activateBound,
  buildSkillContext,
  registerBuiltins,
  resolveBoundSkillId,
  type ConfirmPolicy,
  type SkillContext,
} from "@/lib/skills";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { ProtocolCapabilities } from "@/lib/protocol/types";
import { forgetDrone, MAV_LANDED_STATE_ON_GROUND, noteFcLandedState } from "@/lib/skills/flight-facts";

const DRONE = "drone-bound";
const OK = { success: true, resultCode: 0, message: "" };
const arm = vi.fn(async () => OK);
const disarm = vi.fn(async () => OK);
const resumeMission = vi.fn(async () => OK);
const setFlightMode = vi.fn(async () => OK);

function selectDrone(caps: Partial<ProtocolCapabilities> = {}): void {
  const drone = {
    id: DRONE,
    name: "Survey One",
    protocol: {
      isConnected: true,
      getCapabilities: () =>
        ({ supportsAutonomousNav: true, ...caps }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      arm,
      disarm,
      resumeMission,
      setFlightMode,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({
    drones: new Map([[DRONE, drone]]),
    selectedDroneId: DRONE,
  });
}

function ctxWith(confirm: SkillContext["confirm"], notify = vi.fn()): SkillContext {
  return { ...buildSkillContext(DRONE), confirm, notify };
}

const noMission = { missionState: null } as const;

describe("resolveBoundSkillId", () => {
  it("flips arm to disarm only while armed and known to be on the ground", () => {
    const onGround = { missionState: null, droneId: DRONE } as const;
    noteFcLandedState(DRONE, MAV_LANDED_STATE_ON_GROUND);
    expect(resolveBoundSkillId("arm", "armed", onGround)).toBe("disarm");
    expect(resolveBoundSkillId("arm", "disarmed", onGround)).toBe("arm");
    expect(resolveBoundSkillId("arm", "unknown", onGround)).toBe("arm");
    forgetDrone(DRONE);
    expect(resolveBoundSkillId("arm", "armed", onGround)).toBe("arm");
    expect(resolveBoundSkillId("arm", "armed", noMission)).toBe("arm");
  });

  it("flips pause to resume only while the mission state is paused", () => {
    expect(resolveBoundSkillId("pause", "armed", { missionState: "paused" })).toBe("resume");
    expect(resolveBoundSkillId("pause", "armed", noMission)).toBe("pause");
    expect(resolveBoundSkillId("pause", "armed", { missionState: "active" })).toBe("pause");
    expect(resolveBoundSkillId("pause", "armed", { missionState: "loaded" })).toBe("pause");
    expect(resolveBoundSkillId("rth", "armed", { missionState: "paused" })).toBe("rth");
  });
});

describe("bound dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (const fn of [arm, disarm, resumeMission, setFlightMode]) fn.mockClear();
    registerBuiltins();
  });

  afterEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    forgetDrone(DRONE);
    vi.useRealTimers();
  });

  it("an arm binding disarms an armed vehicle through the disarm hold confirm", async () => {
    selectDrone();
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    noteFcLandedState(DRONE, MAV_LANDED_STATE_ON_GROUND);
    const policies: ConfirmPolicy[] = [];
    const notify = vi.fn();
    await activateBound(
      "arm",
      ctxWith(async (p) => {
        policies.push(p);
        return true;
      }, notify),
    );
    expect(policies[0].title).toBe("confirm.disarm.title");
    expect(policies[0].gesture).toBe("hold");
    expect(disarm).toHaveBeenCalledTimes(1);
    expect(arm).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith("refusal.already_armed", "warning");
  });

  it("a pause binding resumes a paused mission", async () => {
    selectDrone({ supportsMissionUpload: true });
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() + 1 });
    await activateBound("pause", { ...ctxWith(async () => true), missionState: "paused" });
    expect(resumeMission).toHaveBeenCalledTimes(1);
    expect(setFlightMode).not.toHaveBeenCalledWith("LOITER");
  });

  it("names the target drone in the confirm values", async () => {
    selectDrone();
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() + 2 });
    const policies: ConfirmPolicy[] = [];
    await activate(
      "arm",
      ctxWith(async (p) => {
        policies.push(p);
        return false;
      }),
    );
    expect(policies[0].values?.drone).toBe("Survey One");
  });

  it("cancels the send when the arm state changed under the open sheet", async () => {
    selectDrone();
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    const notify = vi.fn();
    await activate(
      "arm",
      ctxWith(async () => {
        // Another station armed the vehicle while the slide was in progress.
        useDroneStore.setState({ armState: "armed" });
        return true;
      }, notify),
    );
    expect(arm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("refusal.changed_since_prompt", "warning");
  });
});
