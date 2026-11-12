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
import { MAV_LANDED_STATE_ON_GROUND, noteFcLandedState } from "../flight-facts";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
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

const NO_LINK = { kind: "disabled", reason: "refusal.no_fc_link" };
const STALE = { kind: "idle", warning: "refusal.link_stale" };
const STALE_DISABLED = { kind: "disabled", reason: "refusal.link_stale_disabled" };

describe("skill link freshness", () => {
  let clock = Date.now();
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
    // Each test runs on its own minute, so a one-shot fired in an earlier
    // test is never inside the activation debounce window.
    clock += 60_000;
    vi.setSystemTime(clock);
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

  it("sends kill blind after link loss left the arm state unknown", async () => {
    // Heartbeat silent 6 s with the transport still open: link loss has
    // reset the arm state to unknown.
    useDroneStore.setState({ armState: "unknown", lastHeartbeat: Date.now() - 6000 });
    const notes: string[] = [];
    const ctx = {
      ...buildSkillContext(DRONE),
      notify: (msg: string) => void notes.push(msg),
      confirm: async () => true,
    };
    await activate("kill", ctx);
    expect(notes).not.toContain("refusal.no_fc_link");
    expect(killSwitch).toHaveBeenCalledWith(true);
  });

  it("kill goes out in any arm state, disarmed included (shared spec)", async () => {
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    const ctx = { ...buildSkillContext(DRONE), confirm: async () => true };
    await activate("kill", ctx);
    expect(killSwitch).toHaveBeenCalledWith(true);
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

  it("a completed pad stop hold sends kill with no second hold", async () => {
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    const policies: ConfirmPolicy[] = [];
    const ctx = {
      ...buildSkillContext(DRONE),
      confirm: async (policy: ConfirmPolicy) => {
        policies.push(policy);
        return false;
      },
    };
    await activate("kill", ctx, { confirmedByHold: true, heldMs: layoutSpec.holds_ms.stop });
    expect(policies).toHaveLength(0);
    expect(killSwitch).toHaveBeenCalledWith(true);
  });

  it("a short pad hold or a key press still needs the full spec stop hold", async () => {
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    const policies: ConfirmPolicy[] = [];
    const ctx = {
      ...buildSkillContext(DRONE),
      confirm: async (policy: ConfirmPolicy) => {
        policies.push(policy);
        return false;
      },
    };
    await activate("kill", ctx, { confirmedByHold: true, heldMs: layoutSpec.holds_ms.stop - 1 });
    await activate("kill", ctx, { confirmedByHold: true });
    await activate("kill", ctx);
    expect(policies).toHaveLength(3);
    for (const p of policies) {
      expect(p.gesture).toBe("guarded");
      expect(p.holdMs).toBe(layoutSpec.holds_ms.stop);
    }
    expect(killSwitch).not.toHaveBeenCalled();
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
    // On the ground, as the flight controller reports it: Disarm's own gate holds.
    noteFcLandedState(DRONE, MAV_LANDED_STATE_ON_GROUND);
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("disarm").kind).toBe("idle");
    expect(stateOf("kill")).toEqual({ kind: "idle" });

    // No further heartbeat arrives; nothing in any store changes.
    vi.advanceTimersByTime(SKILL_LINK_FRESH_MS + 600);
    expect(stateOf("disarm")).toEqual(NO_LINK);
    expect(stateOf("kill")).toEqual(STALE);

    // The link comes back: the next sample re-enables the skill.
    noteFcLandedState(DRONE, MAV_LANDED_STATE_ON_GROUND);
    useDroneStore.setState({ lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("disarm").kind).toBe("idle");
    expect(stateOf("kill")).toEqual({ kind: "idle" });
  });
});
