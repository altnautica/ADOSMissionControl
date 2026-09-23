/**
 * Planned speeds reach the vehicle: the expander writes a ground-speed
 * DO_CHANGE_SPEED for the mission default and for every leg whose speed
 * changes, and a download folds them back into the speeds the planner showed.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import type { Waypoint } from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types/mission";
import { expandToItems, collapseFromItems } from "@/lib/mission/mission-expand";
import { cmdMap } from "@/lib/mission-io-formats";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import { missionUploadItems } from "@/lib/mission-upload";

vi.mock("@/stores/planner-store", () => ({
  usePlannerStore: {
    getState: () => ({ defaultFrame: "relative", defaultSpeed: 7 }),
    setState: vi.fn(),
  },
}));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

const SPEED = cmdMap.DO_SET_SPEED;

/** `S<speed>` for a speed item, the command name otherwise. */
function describeItems(items: readonly MissionItem[]): string[] {
  const names = new Map(Object.entries(cmdMap).map(([name, id]) => [id, name]));
  return items.map((it) => (it.command === SPEED ? `S${it.param2}` : names.get(it.command) ?? String(it.command)));
}

const wp = (id: string, i: number, extra: Partial<Waypoint> = {}): Waypoint => ({
  id, lat: 12.97 + i * 0.001, lon: 77.59, alt: 30, command: "WAYPOINT", ...extra,
});

const MISSION: Waypoint[] = [
  wp("t", 0, { command: "TAKEOFF" }),
  wp("a", 1, { speed: 3 }),
  wp("b", 2, { speed: 3 }),
  wp("c", 3),
  wp("r", 4, { command: "RTL", alt: 0 }),
];

describe("speed encoding", () => {
  it("writes the default speed first and a ground-speed change before each leg that needs one", () => {
    const items = expandToItems(MISSION, { defaultFrame: "relative", defaultSpeed: 8 });
    expect(describeItems(items)).toEqual(["S8", "TAKEOFF", "S3", "WAYPOINT", "WAYPOINT", "S8", "WAYPOINT", "RTL"]);
    for (const it of items.filter((i) => i.command === SPEED)) {
      expect(it.param1).toBe(1); // ground speed
      expect(it.param3).toBe(-1); // throttle unchanged
    }
    expect(items.every((it, i) => it.seq === i)).toBe(true);
  });

  it("writes no speed item when nothing sets a speed", () => {
    const plain = MISSION.map((w) => ({ ...w, speed: undefined }));
    const items = expandToItems(plain, { defaultFrame: "relative" });
    expect(items.some((it) => it.command === SPEED)).toBe(false);
  });

  it("downloads back as the speed each leg is flown at, and re-uploads identically", () => {
    const items = expandToItems(MISSION, { defaultFrame: "relative", defaultSpeed: 8 });
    const back = collapseFromItems(items);
    expect(back.map((w) => w.speed)).toEqual([8, 3, 3, 8, 8]);
    expect(back.every((w) => (w.actions ?? []).length === 0)).toBe(true);
    const again = expandToItems(back, { defaultFrame: "relative", defaultSpeed: 8 });
    expect(again).toEqual(items);
  });

  it("uploads a survey at the pattern speed and the rest at the planner default", () => {
    const survey = patternToMission(
      generateSurvey({
        polygon: [[12.970, 77.590], [12.970, 77.593], [12.973, 77.593], [12.973, 77.590]],
        gridAngle: 0, lineSpacing: 80, turnAroundDistance: 10, entryLocation: "topLeft",
        flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 3,
      }).waypoints,
      "relative",
    );
    const described = describeItems(missionUploadItems(survey));
    // Default for the takeoff, the pattern's 3 m/s for the survey legs, the
    // default again for the return.
    expect(described.filter((d) => d.startsWith("S"))).toEqual(["S7", "S3", "S7"]);
    expect(described[0]).toBe("S7");
    expect(described.indexOf("S3")).toBe(described.indexOf("TAKEOFF") + 1);
  });
});
