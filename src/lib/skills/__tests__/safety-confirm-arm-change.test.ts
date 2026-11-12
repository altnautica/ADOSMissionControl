/**
 * A stop or brake approved on the shared confirm sheet goes out even when the
 * arm state changes under the hold: link loss turns `armed` into `unknown`,
 * and the link's return turns it back. Neither cancels the emergency stop or
 * the pause, and a pause raised with the arm state already unknown is sent.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  buildSkillContext,
  registerBuiltins,
  useSkillRegistry,
  type SkillContext,
} from "@/lib/skills";
import { pauseSkill } from "@/lib/skills/builtins/pause";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import type { ArmState } from "@/lib/types";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-safety-sheet";
const OK = { success: true, resultCode: 0, message: "" };
const killSwitch = vi.fn(async (_on: boolean) => OK);
const setFlightMode = vi.fn(async (_mode: string) => OK);
const pauseMission = vi.fn(async () => OK);

function selectDrone(): void {
  const drone = {
    id: DRONE,
    name: "Survey One",
    protocol: {
      isConnected: true,
      getCapabilities: () => ({ supportsAutonomousNav: true }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      killSwitch,
      setFlightMode,
      pauseMission,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
}

/** The vehicle as the heartbeat reads it: a known arm state comes with a
 *  fresh heartbeat, an unknown one with the heartbeat gone stale. */
function vehicle(armState: ArmState): void {
  useDroneStore.setState({
    armState,
    lastHeartbeat: armState === "unknown" ? Date.now() - 10_000 : Date.now(),
  });
}

function ctx(notify = vi.fn()): SkillContext {
  return { ...buildSkillContext(DRONE), notify };
}

/** Raise `skillId` on the shared sheet, change the vehicle under the hold,
 *  then complete the hold. */
async function confirmAcross(skillId: string, from: ArmState, to: ArmState, notify = vi.fn()) {
  vehicle(from);
  const run = activate(skillId, ctx(notify));
  await vi.waitFor(() => expect(useSkillConfirmStore.getState().pending).not.toBeNull());
  vehicle(to);
  useSkillConfirmStore.getState().resolvePending(true);
  await run;
}

const TRANSITIONS: [ArmState, ArmState][] = [
  ["armed", "unknown"],
  ["unknown", "armed"],
];

/** Each test starts a minute later, clear of the one-shot debounce. */
let minute = 0;

describe("a stop or brake confirmed across an arm-state change", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-03-01T00:00:00Z") + ++minute * 60_000);
    for (const fn of [killSwitch, setFlightMode, pauseMission]) fn.mockClear();
    registerBuiltins();
    selectDrone();
  });

  afterEach(() => {
    useSkillConfirmStore.setState({ pending: null });
    useSkillRegistry.getState().register(pauseSkill);
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    vi.useRealTimers();
  });

  it.each(TRANSITIONS)("sends the emergency stop once (%s to %s)", async (from, to) => {
    const notify = vi.fn();
    await confirmAcross("kill", from, to, notify);
    expect(killSwitch).toHaveBeenCalledTimes(1);
    expect(killSwitch).toHaveBeenCalledWith(true);
    expect(notify).not.toHaveBeenCalledWith("refusal.changed_since_prompt", "warning");
  });

  describe("pause raised on a sheet", () => {
    beforeEach(() => {
      useSkillRegistry.getState().register({
        ...pauseSkill,
        confirm: {
          title: "confirm.pause.title",
          message: "confirm.pause.message",
          confirmLabel: "confirm.pause.confirm",
          variant: "primary",
          gesture: "hold",
        },
      });
    });

    it.each(TRANSITIONS)("sends the brake once (%s to %s)", async (from, to) => {
      const notify = vi.fn();
      await confirmAcross("pause", from, to, notify);
      expect(setFlightMode).toHaveBeenCalledTimes(1);
      expect(setFlightMode).toHaveBeenCalledWith("LOITER");
      expect(notify).not.toHaveBeenCalledWith("refusal.changed_since_prompt", "warning");
    });

    it("sends the brake when the arm state is unknown from the start", async () => {
      await confirmAcross("pause", "unknown", "unknown");
      expect(setFlightMode).toHaveBeenCalledTimes(1);
      expect(setFlightMode).toHaveBeenCalledWith("LOITER");
    });

    it("still cancels the brake once the vehicle reads disarmed", async () => {
      const notify = vi.fn();
      await confirmAcross("pause", "armed", "disarmed", notify);
      expect(setFlightMode).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith("refusal.changed_since_prompt", "warning");
    });
  });
});
