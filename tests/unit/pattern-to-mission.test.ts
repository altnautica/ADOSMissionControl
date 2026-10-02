/**
 * Pattern generators through the shared pattern converter, the upload expander
 * and the validator: an applied pattern must validate, and every action must
 * reach the vehicle right after the navigation point it belongs to.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type { PatternWaypoint } from "@/lib/patterns/types";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import { expandToItems } from "@/lib/mission/mission-expand";
import { isNavCommand } from "@/lib/mission/command-classes";
import { validateMission } from "@/lib/validation/mission-validator";
import { cmdMap, reverseCmd } from "@/lib/mission/command-map";

const CENTER: [number, number] = [12.9716, 77.5946];

const isNavItem = (it: MissionItem) => {
  const cmd = reverseCmd[it.command];
  return cmd !== undefined && isNavCommand(cmd);
};

/** The uploaded items, without the speed items the expander interleaves. */
function uploaded(rows: readonly PatternWaypoint[]): MissionItem[] {
  const waypoints = patternToMission(rows);
  return expandToItems(waypoints, { defaultFrame: "relative", defaultSpeed: 5 })
    .filter((it) => it.command !== cmdMap.DO_SET_SPEED);
}

/** Camera-trigger state on each leg flown between consecutive navigation items. */
function cameraOnPerLeg(items: readonly MissionItem[]): boolean[] {
  const legs: boolean[] = [];
  let on = false;
  let seenNav = false;
  for (const it of items) {
    if (isNavItem(it)) {
      if (seenNav) legs.push(on);
      seenNav = true;
    } else if (it.command === cmdMap.DO_SET_CAM_TRIGG) {
      on = it.param1 > 0;
    }
  }
  return legs;
}

function blockingCodes(rows: readonly PatternWaypoint[]): string[] {
  const waypoints = patternToMission(rows);
  return validateMission(waypoints, { defaultFrame: "relative" }).errors.map((e) => e.code);
}

describe("patternToMission", () => {
  it("attaches an action that precedes every navigation row to the first one", () => {
    const rows: PatternWaypoint[] = [
      { lat: CENTER[0], lon: CENTER[1], alt: 40, speed: 5, command: "ROI" },
      { lat: CENTER[0] + 0.001, lon: CENTER[1], alt: 40, speed: 5, command: "WAYPOINT" },
      { lat: CENTER[0] + 0.002, lon: CENTER[1], alt: 40, speed: 5, command: "WAYPOINT" },
    ];
    const waypoints = patternToMission(rows);
    expect(waypoints.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT", "WAYPOINT", "RTL"]);
    expect(waypoints[1].actions?.map((a) => a.command)).toEqual(["ROI"]);
    expect(blockingCodes(rows)).toEqual([]);
  });

  it("stamps every waypoint above home, with the closing RTL at 0 m above home", () => {
    const rows = generateOrbit({
      center: CENTER, radius: 60, direction: "cw", turns: 1, startAngle: 0, altitude: 40, speed: 5,
    }).waypoints;
    const waypoints = patternToMission(rows);
    expect(waypoints.every((w) => w.frame === "relative")).toBe(true);
    const rtl = waypoints[waypoints.length - 1];
    expect(rtl).toMatchObject({ command: "RTL", alt: 0, frame: "relative" });
  });
});

describe("applied patterns validate and sequence their actions after their waypoint", () => {
  it("orbit: points the camera at the centre right after the first orbit point", () => {
    const rows = generateOrbit({
      center: CENTER, radius: 60, direction: "cw", turns: 1, startAngle: 0, altitude: 40, speed: 5,
    }).waypoints;
    expect(blockingCodes(rows)).toEqual([]);

    const items = uploaded(rows);
    expect(items.slice(0, 3).map((it) => it.command)).toEqual([cmdMap.TAKEOFF, cmdMap.WAYPOINT, cmdMap.ROI]);
    expect(items[2].x).toBe(Math.round(CENTER[0] * 1e7));
    expect(items[2].y).toBe(Math.round(CENTER[1] * 1e7));
  });

  it("structure scan: ROI and camera start ride the first orbit point, camera stops at the end", () => {
    const rows = generateStructureScan({
      structurePolygon: [
        [CENTER[0], CENTER[1]], [CENTER[0], CENTER[1] + 0.0002],
        [CENTER[0] + 0.0002, CENTER[1] + 0.0002], [CENTER[0] + 0.0002, CENTER[1]],
      ],
      bottomAlt: 15, topAlt: 45, layerSpacing: 15, scanDistance: 30, gimbalPitch: -15,
      pointsPerLayer: 8, cameraTriggerDistance: 10, speed: 3, direction: "bottom-up",
    }).waypoints;
    expect(blockingCodes(rows)).toEqual([]);

    const items = uploaded(rows);
    expect(items.slice(0, 4).map((it) => it.command)).toEqual([
      cmdMap.TAKEOFF, cmdMap.WAYPOINT, cmdMap.ROI, cmdMap.DO_SET_CAM_TRIGG,
    ]);
    const legs = cameraOnPerLeg(items);
    // Off on the climb-out, on around every layer, off on the way home.
    expect(legs[0]).toBe(false);
    expect(legs.slice(1, -1).every(Boolean)).toBe(true);
    expect(legs[legs.length - 1]).toBe(false);
  });

  it("structure scan: each layer commands the gimbal pitch with DO_MOUNT_CONTROL, not a waypoint param", () => {
    const rows = generateStructureScan({
      structurePolygon: [
        [CENTER[0], CENTER[1]], [CENTER[0], CENTER[1] + 0.0002],
        [CENTER[0] + 0.0002, CENTER[1] + 0.0002], [CENTER[0] + 0.0002, CENTER[1]],
      ],
      bottomAlt: 15, topAlt: 45, layerSpacing: 15, scanDistance: 30, gimbalPitch: -20,
      pointsPerLayer: 8, cameraTriggerDistance: 0, speed: 3, direction: "bottom-up",
    }).waypoints;
    expect(blockingCodes(rows)).toEqual([]);

    const items = uploaded(rows);
    const mounts = items.filter((it) => it.command === cmdMap.DO_MOUNT_CONTROL);
    expect(mounts).toHaveLength(3); // 15, 30, 45 m layers
    for (const m of mounts) expect(m.param1).toBe(-20);
    // The first layer's gimbal command follows its ROI, so the ROI cannot override it.
    const firstMount = items.indexOf(mounts[0]);
    expect(items.findIndex((it) => it.command === cmdMap.ROI)).toBeLessThan(firstMount);
    // No orbit waypoint carries the pitch in its pass-radius slot.
    for (const wp of items.filter((it) => it.command === cmdMap.WAYPOINT)) expect(wp.param3).toBe(0);
  });

  it("camera survey: the camera runs along every transect and never across a turnaround", () => {
    const rows = generateSurvey({
      polygon: [[12.970, 77.590], [12.970, 77.594], [12.974, 77.594], [12.974, 77.590]],
      gridAngle: 0, lineSpacing: 80, turnAroundDistance: 10, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 20, altitude: 50, speed: 5,
    }).waypoints;
    expect(blockingCodes(rows)).toEqual([]);

    // Each leg between consecutive navigation items, with its camera state.
    const legs: { on: boolean; from: MissionItem; to: MissionItem }[] = [];
    let on = false;
    let prev: MissionItem | null = null;
    for (const it of uploaded(rows)) {
      if (isNavItem(it)) {
        if (prev) legs.push({ on, from: prev, to: it });
        prev = it;
      } else if (it.command === cmdMap.DO_SET_CAM_TRIGG) {
        on = it.param1 > 0;
      }
    }
    // Transects run east-west here: a turnaround changes latitude.
    const turnarounds = legs.filter((l) => l.from.x !== l.to.x);
    expect(turnarounds.length).toBeGreaterThanOrEqual(4);
    expect(turnarounds.every((l) => !l.on)).toBe(true);
    // The camera is on for one leg per transect, and only inside the boundary.
    const shooting = legs.filter((l) => l.on);
    expect(shooting).toHaveLength(turnarounds.length + 1);
    const inside = (it: MissionItem) => it.y >= 775_900_000 && it.y <= 775_940_000;
    expect(shooting.every((l) => l.from.x === l.to.x && inside(l.from) && inside(l.to))).toBe(true);
  });
});
