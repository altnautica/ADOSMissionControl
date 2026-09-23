import { describe, it, expect, vi } from "vitest";
import { foldLegacyWaypoints } from "@/lib/mission/flat-rows";
import type { CommandMissionAction, Waypoint } from "@/lib/types/mission";

describe("foldLegacyWaypoints — nesting top-level action rows", () => {
  it("folds consecutive DO/CONDITION rows into the preceding NAV waypoint", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
      { id: "a-speed", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 12 },
      { id: "a-yaw", lat: 0, lon: 0, alt: 0, command: "CONDITION_YAW", param1: 90, param2: 20 },
      { id: "w1", lat: 2, lon: 2, alt: 20, command: "WAYPOINT" },
    ];
    const out = foldLegacyWaypoints(flat);
    expect(out.map((w) => w.command)).toEqual(["WAYPOINT", "WAYPOINT"]);
    expect(out[0].actions?.map((a) => a.command)).toEqual(["DO_SET_SPEED", "CONDITION_YAW"]);
    expect(out[0].actions?.[0].param1).toBe(12);
    expect(out[0].actions?.[1].param1).toBe(90);
    expect(out[0].actions?.[1].param2).toBe(20);
    expect(out[1].actions).toEqual([]);
  });

  it("resolves a legacy DO_JUMP param1 (1-based flat index) to the target element's id", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
      { id: "w1", lat: 2, lon: 2, alt: 20, command: "WAYPOINT" },
      { id: "w2", lat: 3, lon: 3, alt: 20, command: "WAYPOINT" },
      { id: "jump", lat: 0, lon: 0, alt: 0, command: "DO_JUMP", param1: 2, param2: 4 },
    ];
    const out = foldLegacyWaypoints(flat);
    // The jump folds into the current NAV (w2) and targets flat[1] = w1 (1-based 2).
    const jump = out[2].actions?.[0] as CommandMissionAction | undefined;
    expect(jump?.command).toBe("DO_JUMP");
    expect(jump?.jumpTargetId).toBe("w1");
    expect(jump?.param2).toBe(4); // repeat preserved
    expect(jump?.param1).toBeUndefined(); // target-param role cleared
  });

  it("a legacy DO_JUMP whose target index lands on an action row uses the nearest preceding NAV", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
      { id: "a-speed", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 8 },
      { id: "w1", lat: 2, lon: 2, alt: 20, command: "WAYPOINT" },
      { id: "jump", lat: 0, lon: 0, alt: 0, command: "DO_JUMP", param1: 2, param2: 1 },
    ];
    const out = foldLegacyWaypoints(flat);
    // 1-based index 2 → flat[1] = the DO_SET_SPEED action → nearest preceding NAV = w0.
    const jump = out[1].actions?.find((a) => a.command === "DO_JUMP") as CommandMissionAction | undefined;
    expect(jump?.jumpTargetId).toBe("w0");
  });

  it("drops a leading action row that precedes any navigation waypoint (with a warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flat: Waypoint[] = [
      { id: "orphan", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 5 },
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
    ];
    const out = foldLegacyWaypoints(flat);
    expect(out.map((w) => w.command)).toEqual(["WAYPOINT"]);
    expect(out[0].actions).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("restores ROI lat/lon/alt into the MissionAction", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
      { id: "roi", lat: 11.25, lon: 22.5, alt: 3, command: "ROI" },
    ];
    const out = foldLegacyWaypoints(flat);
    const roi = out[0].actions?.[0] as CommandMissionAction | undefined;
    expect(roi?.command).toBe("ROI");
    expect(roi?.lat).toBe(11.25);
    expect(roi?.lon).toBe(22.5);
    expect(roi?.alt).toBe(3);
  });
});

describe("foldLegacyWaypoints — idempotency & pass-through", () => {
  it("is idempotent: fold(fold(x)) deep-equals fold(x)", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT" },
      { id: "a-speed", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 12 },
      { id: "w1", lat: 2, lon: 2, alt: 20, command: "WAYPOINT" },
      { id: "jump", lat: 0, lon: 0, alt: 0, command: "DO_JUMP", param1: 1, param2: 2 },
    ];
    const once = foldLegacyWaypoints(flat);
    const twice = foldLegacyWaypoints(once);
    expect(twice).toEqual(once);
  });

  it("a pure-navigation list passes through with waypoints/params preserved", () => {
    const flat: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "TAKEOFF", holdTime: 2, param1: 3 },
      { id: "w1", lat: 2, lon: 2, alt: 40, command: "WAYPOINT" },
      { id: "w2", lat: 3, lon: 3, alt: 40, command: "RTL" },
    ];
    const out = foldLegacyWaypoints(flat);
    expect(out).toEqual(flat.map((w) => ({ ...w, actions: [] })));
  });

  it("an already-nested mission passes through unchanged", () => {
    const nested: Waypoint[] = [
      { id: "w0", lat: 1, lon: 1, alt: 20, command: "WAYPOINT",
        actions: [{ id: "a", command: "DO_SET_SPEED", param1: 9 }] },
      { id: "w1", lat: 2, lon: 2, alt: 20, command: "WAYPOINT", actions: [] },
    ];
    const out = foldLegacyWaypoints(nested);
    expect(out).toEqual(nested);
  });
});
