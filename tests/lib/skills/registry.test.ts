/**
 * Tests for the skill registry store: registration order as a stable
 * tie-breaker within a category bucket, idempotent re-registration (plugin
 * re-mount keeps its slot), category bucket sorting, the autonomous-nav
 * resolve filter, and per-drone state cache cleanup on unregister.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSkillRegistry } from "@/lib/skills/registry";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import type { Skill, SkillState } from "@/lib/skills/types";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

/**
 * A minimal connected drone whose firmware reports the given geofence
 * capability. `buildSkillContextFor` reads only the id, the protocol's
 * connected flag, its capabilities, and its firmware handler.
 */
function connectedDroneWithGeoFence(
  id: string,
  supportsGeoFence: boolean,
): ManagedDrone {
  return {
    id,
    protocol: {
      isConnected: true,
      getCapabilities: () => ({ supportsGeoFence }) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
    },
  } as unknown as ManagedDrone;
}

function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

function fake(
  id: string,
  over: Partial<Skill> = {},
): Skill {
  return {
    id,
    label: `skills.${id}`,
    icon: "Box",
    category: "flight",
    source: "builtin",
    toggle: false,
    getState: () => ({ kind: "idle" }) as SkillState,
    activate: async () => {},
    ...over,
  };
}

describe("skill registry", () => {
  beforeEach(() => {
    clearRegistry();
    // No selected drone and no managed drones: buildSkillContext holds no live
    // protocol, so the firmware's autonomous-nav capability is unknown.
    useDroneStore.setState({ selectedId: null });
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });

  it("resolves skills sorted by category bucket then registration order", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("safety-a", { category: "safety" }));
    reg.register(fake("flight-a", { category: "flight" }));
    reg.register(fake("behavior-a", { category: "behavior" }));
    reg.register(fake("flight-b", { category: "flight" }));

    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);

    // flight (bucket 0) before behavior (1) before safety (3); within flight,
    // registration order is the tie-breaker.
    expect(ids).toEqual(["flight-a", "flight-b", "behavior-a", "safety-a"]);
  });

  it("keeps the original slot when a skill re-registers (plugin re-mount)", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("first", { category: "flight" }));
    reg.register(fake("second", { category: "flight" }));

    // Re-register "first" (e.g. a plugin slot re-mounts) — it must keep its
    // earlier order, not jump behind "second".
    useSkillRegistry.getState().register(fake("first", { category: "flight" }));

    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);
    expect(ids).toEqual(["first", "second"]);
  });

  it("keeps autonomous-nav skills when the firmware capability is unknown", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("plain", { category: "flight" }));
    reg.register(
      fake("nav", { category: "flight", requiresAutonomousNav: true }),
    );

    // No live handshake -> the capability is unknown, not "cannot" -> the nav
    // skill is kept (shown disabled-with-reason downstream), never hidden on a
    // guess about a node that may well be able to return home.
    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);
    expect(ids).toEqual(["plain", "nav"]);
  });

  it("filters out autonomous-nav skills when a connected firmware cannot do it", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("plain", { category: "flight" }));
    reg.register(
      fake("nav", { category: "flight", requiresAutonomousNav: true }),
    );

    // A live handshake that reports no geofence support is a firmware that
    // genuinely cannot do autonomous nav (an acro flight controller), so the
    // nav skill is filtered out — the selected-drone path is unchanged.
    useDroneManager.setState({
      selectedDroneId: "drone-1",
      drones: new Map([
        ["drone-1", connectedDroneWithGeoFence("drone-1", false)],
      ]),
    });

    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);
    expect(ids).toEqual(["plain"]);
  });

  it("keeps autonomous-nav skills when a connected firmware supports them", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("plain", { category: "flight" }));
    reg.register(
      fake("nav", { category: "flight", requiresAutonomousNav: true }),
    );

    useDroneManager.setState({
      selectedDroneId: "drone-1",
      drones: new Map([
        ["drone-1", connectedDroneWithGeoFence("drone-1", true)],
      ]),
    });

    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);
    expect(ids).toEqual(["plain", "nav"]);
  });

  it("falls back to idle state for an unknown (drone, skill) pair", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("known"));
    expect(reg.getState("drone-x", "known").kind).toBe("idle");
    expect(reg.getState("drone-x", "absent").kind).toBe("idle");
  });

  it("drops a skill from every per-drone state cache on unregister", () => {
    const reg = useSkillRegistry.getState();
    reg.register(fake("temp"));
    // Seed a per-drone state cache entry directly.
    useSkillRegistry.setState((s) => {
      const states = new Map(s.states);
      states.set("drone-1", new Map([["temp", { kind: "idle" } as SkillState]]));
      return { states };
    });

    useSkillRegistry.getState().unregister("temp");

    const after = useSkillRegistry.getState();
    expect(after.skills.has("temp")).toBe(false);
    expect(after.states.get("drone-1")?.has("temp")).toBe(false);
    expect(after._order.has("temp")).toBe(false);
  });

  it("recovers a benign disabled state when a skill getState throws", () => {
    const reg = useSkillRegistry.getState();
    reg.register(
      fake("boom", {
        getState: () => {
          throw new Error("plugin blew up");
        },
      }),
    );
    useDroneStore.setState({ selectedId: "drone-1" });

    // recomputeSelected must not propagate the throw; it caches a disabled
    // fallback so the bar stays alive.
    expect(() => useSkillRegistry.getState().recomputeSelected()).not.toThrow();
    const state = useSkillRegistry.getState().getState("drone-1", "boom");
    expect(state.kind).toBe("disabled");
    expect(state.reason).toBe("skills.reason.stateError");
  });
});
