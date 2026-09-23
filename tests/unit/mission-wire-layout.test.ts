/**
 * Mission wire layout: command ids, the ArduPilot home slot, unmodelled-command
 * passthrough, per-command parameter slots and MAV_FRAME decoding.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  expandToItems,
  collapseFromItems,
} from "@/lib/mission/mission-expand";
import { mavToFrame } from "@/lib/mission/altitude-frame";
import { migrateWaypointSlots } from "@/lib/mission/waypoint-slot-migration";
import {
  cmdMap,
  exportWaypointsFormat,
  parseWaypointsFile,
} from "@/lib/mission-io-formats";
import { defaultActionParams } from "@/components/planner/waypoint-constants";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type { AltitudeFrame, Waypoint } from "@/lib/types/mission";

const OPTS = { defaultFrame: "relative" as AltitudeFrame };
const HOME = { lat: 12.9716, lon: 77.5946, alt: 912 };

/**
 * MAV_CMD values from the MAVLink message definitions (common.xml; DO_AUX_FUNCTION
 * from ardupilotmega.xml), keyed by the planner's command name.
 */
const MAV_CMD: Record<keyof typeof cmdMap, number> = {
  WAYPOINT: 16, // MAV_CMD_NAV_WAYPOINT
  LOITER: 17, // MAV_CMD_NAV_LOITER_UNLIM
  LOITER_TURNS: 18, // MAV_CMD_NAV_LOITER_TURNS
  LOITER_TIME: 19, // MAV_CMD_NAV_LOITER_TIME
  RTL: 20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
  LAND: 21, // MAV_CMD_NAV_LAND
  TAKEOFF: 22, // MAV_CMD_NAV_TAKEOFF
  SPLINE_WAYPOINT: 82, // MAV_CMD_NAV_SPLINE_WAYPOINT
  VTOL_TAKEOFF: 84, // MAV_CMD_NAV_VTOL_TAKEOFF
  VTOL_LAND: 85, // MAV_CMD_NAV_VTOL_LAND
  NAV_PAYLOAD_PLACE: 94, // MAV_CMD_NAV_PAYLOAD_PLACE
  DELAY: 112, // MAV_CMD_CONDITION_DELAY
  CONDITION_DISTANCE: 114, // MAV_CMD_CONDITION_DISTANCE
  CONDITION_YAW: 115, // MAV_CMD_CONDITION_YAW
  DO_JUMP: 177, // MAV_CMD_DO_JUMP
  DO_SET_SPEED: 178, // MAV_CMD_DO_CHANGE_SPEED
  DO_SET_HOME: 179, // MAV_CMD_DO_SET_HOME
  DO_SET_SERVO: 183, // MAV_CMD_DO_SET_SERVO
  DO_LAND_START: 189, // MAV_CMD_DO_LAND_START
  DO_SET_ROI_NONE: 197, // MAV_CMD_DO_SET_ROI_NONE
  ROI: 201, // MAV_CMD_DO_SET_ROI
  DO_DIGICAM: 203, // MAV_CMD_DO_DIGICAM_CONTROL
  DO_MOUNT_CONTROL: 205, // MAV_CMD_DO_MOUNT_CONTROL
  DO_SET_CAM_TRIGG: 206, // MAV_CMD_DO_SET_CAM_TRIGG_DIST
  DO_FENCE_ENABLE: 207, // MAV_CMD_DO_FENCE_ENABLE
  DO_GRIPPER: 211, // MAV_CMD_DO_GRIPPER
  DO_AUX_FUNCTION: 218, // MAV_CMD_DO_AUX_FUNCTION
  DO_WINCH: 42600, // MAV_CMD_DO_WINCH
};

function item(seq: number, command: number, over: Partial<MissionItem> = {}): MissionItem {
  return {
    seq, frame: 3, command, current: 0, autocontinue: 1,
    param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 0,
    ...over,
  };
}

/** TAKEOFF 30 m, WP A, WP B carrying DO_JUMP → A ×2, RTL. */
function jumpMission(): Waypoint[] {
  return [
    { id: "t", lat: 12.97, lon: 77.59, alt: 30, command: "TAKEOFF" },
    { id: "a", lat: 12.98, lon: 77.6, alt: 50, command: "WAYPOINT" },
    {
      id: "b", lat: 12.99, lon: 77.61, alt: 50, command: "WAYPOINT",
      actions: [{ id: "j", command: "DO_JUMP", jumpTargetId: "a", param2: 2 }],
    },
    { id: "r", lat: 0, lon: 0, alt: 0, command: "RTL" },
  ];
}

describe("cmdMap matches the MAVLink MAV_CMD enum", () => {
  it("pins every planner command to its MAV_CMD id", () => {
    expect(cmdMap).toEqual(MAV_CMD);
  });

  it("DO_WINCH is 42600, not DO_AUTOTUNE_ENABLE (212)", () => {
    expect(cmdMap.DO_WINCH).toBe(42600);
  });
});

describe("ArduPilot home slot", () => {
  it("reserveHomeSlot writes home at seq 0 and shifts every seq and DO_JUMP target by one", () => {
    const items = expandToItems(jumpMission(), { ...OPTS, reserveHomeSlot: HOME });
    expect(items[0]).toEqual({
      seq: 0, frame: 0, command: 16, current: 0, autocontinue: 1,
      param1: 0, param2: 0, param3: 0, param4: 0,
      x: Math.round(HOME.lat * 1e7), y: Math.round(HOME.lon * 1e7), z: HOME.alt,
    });
    expect(items[1]).toMatchObject({ seq: 1, command: 22, current: 1, z: 30 });
    expect(items[2]).toMatchObject({ seq: 2, command: 16 }); // WP A
    const jump = items.find((it) => it.command === 177);
    expect(jump?.param1).toBe(2);
    expect(jump?.param2).toBe(2);
    expect(items.every((it, i) => it.seq === i)).toBe(true);
  });

  it("without a home slot the mission starts at seq 0 (PX4, iNav)", () => {
    const items = expandToItems(jumpMission(), OPTS);
    expect(items[0]).toMatchObject({ seq: 0, command: 22, current: 1 });
    expect(items.find((it) => it.command === 177)?.param1).toBe(1);
  });

  it("an ArduPilot download with the home slot removed collapses to the planned waypoints", () => {
    const onVehicle = expandToItems(jumpMission(), { ...OPTS, reserveHomeSlot: HOME });
    const back = collapseFromItems(onVehicle.filter((it) => it.seq !== 0));
    expect(back.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT", "WAYPOINT", "RTL"]);
    const jump = back[2].actions?.[0];
    expect(jump?.command === "DO_JUMP" ? jump.jumpTargetId : undefined).toBe(back[1].id);
  });

  it(".waypoints export numbers DO_JUMP targets in file rows (home = row 0)", () => {
    let text = "";
    class MockBlob { constructor(parts: string[]) { text = parts.join(""); } }
    const realBlob = globalThis.Blob;
    globalThis.Blob = MockBlob as unknown as typeof Blob;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      exportWaypointsFormat(jumpMission(), "x", { home: HOME });
    } finally {
      globalThis.Blob = realBlob;
      vi.restoreAllMocks();
    }
    const rows = text.trim().split("\n").slice(1).map((r) => r.split("\t"));
    expect(rows[0].slice(0, 4)).toEqual(["0", "0", "0", "16"]);
    expect(rows[0][10]).toBe(String(HOME.alt));
    const jumpRow = rows.find((r) => r[3] === "177");
    expect(jumpRow?.[4]).toBe("2");
    expect(parseWaypointsFile(text).waypoints.map((w) => w.command)).toEqual([
      "TAKEOFF", "WAYPOINT", "WAYPOINT", "RTL",
    ]);
  });
});

describe("unmodelled commands pass through untouched", () => {
  it("a command-181 item survives download → upload byte-identical", () => {
    const relay = item(2, 181, { frame: 2, param1: 1, param2: 1, x: 7, y: -3, z: 0.5 });
    const downloaded = [
      item(0, 16, { frame: 0, x: 129716000, y: 775946000, z: 912 }), // ArduPilot home
      item(1, 22, { current: 1, x: 129700000, y: 775900000, z: 30 }),
      relay,
      item(3, 16, { x: 129800000, y: 776000000, z: 50 }),
      item(4, 2000, { param3: 1 }),
    ];
    const home = downloaded[0];
    const waypoints = collapseFromItems(downloaded.filter((it) => it.seq !== 0));
    expect(waypoints.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT"]);
    expect(waypoints[0].actions?.[0]).toMatchObject({ command: "RAW", rawCommand: 181 });

    const reuploaded = expandToItems(waypoints, {
      ...OPTS,
      reserveHomeSlot: { lat: home.x / 1e7, lon: home.y / 1e7, alt: home.z },
    });
    expect(reuploaded).toEqual(downloaded);
  });

  it("drops a leading unmodelled item and reports it", () => {
    const dropped: MissionItem[] = [];
    const waypoints = collapseFromItems(
      [item(0, 181), item(1, 16, { x: 1, y: 1, z: 10 })],
      (it) => dropped.push(it),
    );
    expect(waypoints).toHaveLength(1);
    expect(dropped.map((it) => it.command)).toEqual([181]);
  });
});

describe("per-command parameter slots", () => {
  it("LOITER_TURNS turns reach MAVLink param1 and radius param3", () => {
    const [loiter] = expandToItems(
      [{ id: "l", lat: 1, lon: 1, alt: 40, command: "LOITER_TURNS", holdTime: 3, param2: 40 }],
      OPTS,
    );
    expect(loiter).toMatchObject({ command: 18, param1: 3, param3: 40 });
  });

  it("PAYLOAD_PLACE max descent reaches MAVLink param1", () => {
    const [place] = expandToItems(
      [{ id: "p", lat: 1, lon: 1, alt: 20, command: "NAV_PAYLOAD_PLACE", holdTime: 10 }],
      OPTS,
    );
    expect(place).toMatchObject({ command: 94, param1: 10 });
  });

  it("a new DO_DIGICAM action shoots: param5 (item x) = 1, and a downloaded shot survives", () => {
    const wps: Waypoint[] = [{
      id: "w", lat: 1, lon: 1, alt: 20, command: "WAYPOINT",
      actions: [{ id: "d", command: "DO_DIGICAM", ...defaultActionParams("DO_DIGICAM") }],
    }];
    const items = expandToItems(wps, OPTS);
    expect(items[1]).toMatchObject({ command: 203, x: 1, y: 0, z: 0 });
    expect(expandToItems(collapseFromItems(items), OPTS)).toEqual(items);
  });

  it("DO_DIGICAM's shoot command keeps its value through a .waypoints file", () => {
    const text = [
      "QGC WPL 110",
      "0\t0\t0\t16\t0\t0\t0\t0\t12.9\t77.5\t0\t1",
      "1\t1\t3\t16\t0\t0\t0\t0\t12.91\t77.51\t50\t1",
      "2\t0\t3\t203\t0\t0\t0\t0\t1\t0\t0\t1",
    ].join("\n");
    const { waypoints } = parseWaypointsFile(text);
    const items = expandToItems(waypoints, OPTS);
    expect(items[1]).toMatchObject({ command: 203, x: 1 });
  });

  it("a new DO_WINCH action defaults to winch 1 with length control", () => {
    expect(defaultActionParams("DO_WINCH")).toEqual({ param1: 1, param2: 1 });
  });
});

describe("MAV_FRAME decoding", () => {
  it("maps the MISSION_ITEM_INT frames to their datum", () => {
    expect(mavToFrame(5)).toBe("absolute");
    expect(mavToFrame(6)).toBe("relative");
    expect(mavToFrame(11)).toBe("terrain");
  });

  it("a PX4 download in MAV_FRAME_GLOBAL_INT stays sea-level on re-upload", () => {
    const [wp] = collapseFromItems([item(0, 16, { frame: 5, x: 1, y: 1, z: 540 })]);
    expect(wp.frame).toBe("absolute");
    expect(expandToItems([wp], OPTS)[0].frame).toBe(0);
  });
});

describe("stored waypoint slot migration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a legacy iNav action code onto command and moves the LAND elevation", () => {
    const legacy = [
      { id: "r", lat: 1, lon: 1, alt: 30, inavAction: 4 },
      { id: "l", lat: 1, lon: 1, alt: 0, inavAction: 8, param2: 12, param3: 1 },
      { id: "j", lat: 1, lon: 1, alt: 30, inavAction: 6, param1: 1, param2: 2 },
    ] as unknown as Waypoint[];
    const out = migrateWaypointSlots(legacy);
    expect(out.map((w) => w.command)).toEqual(["RTL", "LAND", "WAYPOINT"]);
    expect(out[1]).toMatchObject({ param1: 12, param2: undefined, param3: undefined });
    expect(out[2]).toMatchObject({ param1: undefined, param2: undefined });
    expect(out.every((w) => !("inavAction" in w))).toBe(true);
  });

  it("moves editor-written LOITER_TURNS / PAYLOAD_PLACE values into the encoded slots", () => {
    const out = migrateWaypointSlots([
      { id: "t", lat: 1, lon: 1, alt: 40, command: "LOITER_TURNS", param1: 3, param3: 40 },
      { id: "p", lat: 1, lon: 1, alt: 20, command: "NAV_PAYLOAD_PLACE", param1: 10 },
    ]);
    expect(out[0]).toMatchObject({ holdTime: 3, param1: undefined, param2: 40, param3: undefined });
    expect(out[1]).toMatchObject({ holdTime: 10, param1: undefined });
  });

  it("leaves a downloaded LOITER_TURNS (turns already in holdTime) alone", () => {
    const downloaded: Waypoint = { id: "t", lat: 1, lon: 1, alt: 40, command: "LOITER_TURNS", holdTime: 3, param2: 40 };
    expect(migrateWaypointSlots([downloaded])[0]).toEqual(downloaded);
  });
});
