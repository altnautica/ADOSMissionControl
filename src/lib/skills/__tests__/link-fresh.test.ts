/**
 * Link freshness drives the command skills: a heartbeat older than the
 * freshness window means a command most likely goes nowhere, so every command
 * skill reads "no FC link" — and the bar must find that out by itself, because
 * a heartbeat that stops arriving changes no store field.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initSkillSubscriptions,
  registerBuiltins,
  useSkillRegistry,
  SKILL_LINK_FRESH_MS,
} from "@/lib/skills";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-link";

function selectConnectedDrone(): void {
  const drone = {
    id: DRONE,
    name: DRONE,
    protocol: {
      isConnected: true,
      getCapabilities: () =>
        ({ supportsAutonomousNav: true }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
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
    registerBuiltins();
    selectConnectedDrone();
  });

  afterEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    vi.useRealTimers();
  });

  it("disables arm, return-home and land with noFcLink on a 3.5 s old heartbeat", () => {
    useDroneStore.setState({
      armState: "armed",
      lastHeartbeat: Date.now() - 3500,
    });
    useSkillRegistry.getState().recomputeSelected();

    for (const id of ["arm", "rth", "land"]) {
      expect(stateOf(id)).toEqual({
        kind: "disabled",
        reason: "skills.reason.noFcLink",
      });
    }
  });

  it("enables them again on a fresh heartbeat", () => {
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    useSkillRegistry.getState().recomputeSelected();
    expect(stateOf("arm").kind).toBe("idle");
    expect(stateOf("rth").kind).toBe("idle");

    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    useSkillRegistry.getState().recomputeSelected();
    expect(stateOf("land").kind).toBe("idle");
  });

  it("notices a heartbeat going stale with no store change", () => {
    initSkillSubscriptions();
    useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("land").kind).toBe("idle");

    // No further heartbeat arrives; nothing in any store changes.
    vi.advanceTimersByTime(SKILL_LINK_FRESH_MS + 600);
    expect(stateOf("land")).toEqual({
      kind: "disabled",
      reason: "skills.reason.noFcLink",
    });

    // The link comes back: the next sample re-enables the skill.
    useDroneStore.setState({ lastHeartbeat: Date.now() });
    vi.advanceTimersByTime(600);
    expect(stateOf("land").kind).toBe("idle");
  });
});
