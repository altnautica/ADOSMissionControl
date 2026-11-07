/**
 * Link freshness drives the command skills: a heartbeat older than the
 * freshness window means a command most likely goes nowhere, so every command
 * skill reads "no FC link" — except the last-resort set (kill, return home,
 * land), which stays fireable with a stale-link warning and is sent blind. The
 * bar must find a stale link by itself, because a heartbeat that stops arriving
 * changes no store field.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activate,
  buildSkillContext,
  initSkillSubscriptions,
  registerBuiltins,
  useSkillRegistry,
  SKILL_LINK_FRESH_MS,
  type ConfirmPolicy,
} from "@/lib/skills";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-link";
const killSwitch = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));

function selectConnectedDrone(): void {
  const drone = {
    id: DRONE,
    name: DRONE,
    protocol: {
      isConnected: true,
      getCapabilities: () =>
        ({ supportsAutonomousNav: true }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      killSwitch,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({
    drones: new Map([[DRONE, drone]]),
    selectedDroneId: DRONE,
  });
}

function stateOf(skillId: string) {
  return useSkillRegistry.getState().getState(DRONE, skillId);
}

const NO_LINK = { kind: "disabled", reason: "skills.reason.noFcLink" };
const STALE = { kind: "idle", warning: "skills.reason.linkStale" };
const STALE_DISABLED = { kind: "disabled", reason: "skills.reason.linkStaleDisabled" };

describe("skill link freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    killSwitch.mockClear();
    registerBuiltins();
    selectConnectedDrone();
  });

  afterEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    vi.useRealTimers();
  });

  it("stale link: kill and pause send blind, rth and land disable with the reason (shared spec)", () => {
    useDroneStore.setState({
      armState: "armed",
      lastHeartbeat: Date.now() - 3500,
    });
    useSkillRegistry.getState().recomputeSelected();

    for (const id of ["kill", "pause"]) {
      expect(stateOf(id)).toEqual(STALE);
    }
    for (const id of ["rth", "land"]) {
      expect(stateOf(id)).toEqual(STALE_DISABLED);
    }
    for (const id of ["disarm", "resume", "take_control", "mode.loiter"]) {
      expect(stateOf(id)).toEqual(NO_LINK);
    }
    useDroneStore.setState({ armState: "disarmed" });
    useSkillRegistry.getState().recomputeSelected();
    for (const id of ["arm", "takeoff"]) {
      expect(stateOf(id)).toEqual(NO_LINK);
    }
  });

  it("disables the last-resort set too before any heartbeat was heard", () => {
    useDroneStore.setState({ armState: "unknown", lastHeartbeat: 0 });
    useSkillRegistry.getState().recomputeSelected();
    for (const id of ["kill", "pause", "rth", "land"]) {
      expect(stateOf(id)).toEqual(NO_LINK);
    }
  });

  it("sends kill blind on a stale link and warns on the sheet", async () => {
    useDroneStore.setState({
      armState: "armed",
      lastHeartbeat: Date.now() - 3500,
    });
    const policies: ConfirmPolicy[] = [];
    const ctx = {
      ...buildSkillContext(DRONE),
      confirm: async (policy: ConfirmPolicy) => {
        policies.push(policy);
        return true;
      },
    };
    await activate("kill", ctx);
    expect(policies).toHaveLength(1);
    expect(policies[0].staleLink).toBe(true);
    expect(policies[0].values?.drone).toBe(DRONE);
    expect(killSwitch).toHaveBeenCalledWith(true);
  });

  it("enables them again on a fresh heartbeat", () => {
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    useSkillRegistry.getState().recomputeSelected();
    expect(stateOf("arm").kind).toBe("idle");

    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    useSkillRegistry.getState().recomputeSelected();
    expect(stateOf("land")).toEqual({ kind: "idle" });
    expect(stateOf("rth")).toEqual({ kind: "idle" });
  });

  it("notices a heartbeat going stale with no store change", () => {
    initSkillSubscriptions();
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("disarm").kind).toBe("idle");
    expect(stateOf("kill")).toEqual({ kind: "idle" });

    // No further heartbeat arrives; nothing in any store changes.
    vi.advanceTimersByTime(SKILL_LINK_FRESH_MS + 600);
    expect(stateOf("disarm")).toEqual(NO_LINK);
    expect(stateOf("kill")).toEqual(STALE);

    // The link comes back: the next sample re-enables the skill.
    useDroneStore.setState({ lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("disarm").kind).toBe("idle");
    expect(stateOf("kill")).toEqual({ kind: "idle" });
  });
});
