/**
 * @module mission-roundtrip.test
 * @description Round-trip property tests for every mission serialization path.
 *
 * One fixture mission exercises every navigation command, every action command,
 * a `DO_JUMP` addressed by stable id, a non-zero `param4`, and mixed altitude
 * frames. It must survive, identically in its model form:
 *   - `plan -> wire -> plan`          (MAVLink upload / download)
 *   - `plan -> .plan file -> plan`    (QGroundControl JSON)
 *   - `plan -> .waypoints -> plan`    (ArduPilot / Mission Planner WPL 110)
 *
 * Every defect this pins was a silent one: the frame was dropped on collapse so
 * a download-then-reupload sent MSL altitudes as relative-to-home; action
 * `param4` was written as a hardcoded `0`; the flat exporters used a different
 * parameter-slot mapping than the wire encoder, so the same mission serialized
 * differently depending on which path wrote it; and `parseFloat(x) || undefined`
 * swallowed every legitimate zero.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseWaypointsFile,
  parseQGCPlan,
  exportWaypointsFormat,
  exportQGCPlan,
} from "@/lib/mission-io-formats";
import { expandToItems, collapseFromItems } from "@/lib/mission/mission-expand";
import type { AltitudeFrame, NavCommand, Waypoint } from "@/lib/types/mission";

const DEFAULT_FRAME: AltitudeFrame = "relative";

/** The subset of the exported `.plan` JSON these tests read back. */
interface ExportedPlan {
  mission: {
    items: Array<{ command: number; frame: number; params: number[] }>;
  };
}

const OPTS = { defaultFrame: DEFAULT_FRAME };

/**
 * Capture the text an exporter writes into its Blob without touching the DOM
 * download mechanics.
 */
function captureExport(run: () => void): string {
  let captured = "";
  class MockBlob {
    readonly size: number;
    readonly type = "";
    constructor(parts?: BlobPart[]) {
      captured = (parts ?? []).map((p) => String(p)).join("");
      this.size = captured.length;
    }
  }
  const RealBlob = globalThis.Blob;
  globalThis.Blob = MockBlob as unknown as typeof Blob;
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    run();
  } finally {
    globalThis.Blob = RealBlob;
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    clickSpy.mockRestore();
  }
  return captured;
}

/**
 * The model treats an absent parameter and a `0` as the same value (the wire has
 * only the number), so comparison canonicalises `undefined -> 0`. `DO_JUMP`
 * targets compare as an index, because ids are regenerated on every import.
 */
function canonical(wps: readonly Waypoint[]) {
  const indexById = new Map(wps.map((w, i) => [w.id, i]));
  const round7 = (v: number | undefined) =>
    v === undefined ? 0 : Math.round(v * 1e7) / 1e7;
  return wps.map((w) => ({
    command: w.command ?? "WAYPOINT",
    lat: round7(w.lat),
    lon: round7(w.lon),
    alt: w.alt,
    frame: w.frame ?? DEFAULT_FRAME,
    holdTime: w.holdTime ?? 0,
    p1: w.param1 ?? 0,
    p2: w.param2 ?? 0,
    p3: w.param3 ?? 0,
    actions: (w.actions ?? []).map((a) => ({
      command: a.command,
      p1: a.param1 ?? 0,
      p2: a.param2 ?? 0,
      p3: a.param3 ?? 0,
      p4: a.param4 ?? 0,
      lat: round7(a.lat),
      lon: round7(a.lon),
      alt: a.alt ?? 0,
      target:
        a.jumpTargetId === undefined ? undefined : indexById.get(a.jumpTargetId),
    })),
  }));
}

/** Every navigation command a `Waypoint` can carry. */
const NAV_COMMANDS: NavCommand[] = [
  "WAYPOINT", "SPLINE_WAYPOINT", "LOITER", "LOITER_TIME", "LOITER_TURNS",
  "TAKEOFF", "LAND", "RTL", "NAV_PAYLOAD_PLACE", "VTOL_TAKEOFF",
  "VTOL_LAND", "DO_LAND_START",
];

const FRAME_CYCLE: AltitudeFrame[] = ["relative", "absolute", "terrain"];

/**
 * One nav waypoint per navigation command, cycling through all three altitude
 * frames and carrying non-zero values in every parameter slot, plus one
 * waypoint holding every action command — the last of which is a `DO_JUMP`
 * addressed by the stable id of a waypoint in the middle of the mission.
 */
function fullMission(): Waypoint[] {
  const waypoints: Waypoint[] = NAV_COMMANDS.map((command, i) => ({
    id: `nav-${i}`,
    lat: 12.9 + i * 0.001,
    lon: 77.5 + i * 0.001,
    alt: 20 + i,
    command,
    frame: FRAME_CYCLE[i % FRAME_CYCLE.length],
    // Non-zero in every slot so a shifted mapping cannot pass by accident.
    holdTime: 1 + i,
    param1: 2 + i,
    param2: 3 + i,
    param3: 4 + i,
  }));

  waypoints.push({
    id: "nav-actions",
    lat: 13.0,
    lon: 77.6,
    alt: 55,
    command: "WAYPOINT",
    frame: "absolute",
    holdTime: 9,
    param1: 8,
    param2: 7,
    param3: 6,
    actions: [
      // Every action command, each with a NON-ZERO param4 — the slot the flat
      // exporters used to hardcode to 0.
      { id: "a-roi", command: "ROI", param1: 11, param2: 12, param3: 13, param4: 14, lat: 13.05, lon: 77.65, alt: 33 },
      { id: "a-speed", command: "DO_SET_SPEED", param1: 1, param2: 12, param3: 3, param4: 4 },
      { id: "a-trigg", command: "DO_SET_CAM_TRIGG", param1: 5, param2: 6, param3: 7, param4: 8 },
      { id: "a-digicam", command: "DO_DIGICAM", param1: 1, param2: 2, param3: 3, param4: 4 },
      { id: "a-delay", command: "DELAY", param1: 15, param2: 16, param3: 17, param4: 18 },
      { id: "a-yaw", command: "CONDITION_YAW", param1: 90, param2: 20, param3: 1, param4: 2 },
      { id: "a-servo", command: "DO_SET_SERVO", param1: 9, param2: 1500, param3: 1, param4: 2 },
      { id: "a-fence", command: "DO_FENCE_ENABLE", param1: 1, param2: 2, param3: 3, param4: 4 },
      { id: "a-mount", command: "DO_MOUNT_CONTROL", param1: 10, param2: 20, param3: 30, param4: 2 },
      { id: "a-gripper", command: "DO_GRIPPER", param1: 1, param2: 1, param3: 2, param4: 3 },
      { id: "a-winch", command: "DO_WINCH", param1: 1, param2: 2, param3: 3, param4: 4 },
      { id: "a-dist", command: "CONDITION_DISTANCE", param1: 25, param2: 1, param3: 2, param4: 3 },
      { id: "a-home", command: "DO_SET_HOME", param1: 1, param2: 2, param3: 3, param4: 4, lat: 12.95, lon: 77.55, alt: 12 },
      { id: "a-aux", command: "DO_AUX_FUNCTION", param1: 41, param2: 2, param3: 3, param4: 4 },
      { id: "a-roinone", command: "DO_SET_ROI_NONE", param1: 1, param2: 2, param3: 3, param4: 4 },
      // DO_JUMP by stable id, targeting a mid-mission waypoint. `param1` is the
      // resolved target sequence on the wire, so it is not a user parameter.
      { id: "a-jump", command: "DO_JUMP", jumpTargetId: "nav-4", param2: 3 },
    ],
  });

  return waypoints;
}

describe("mission round-trip — plan -> wire -> plan", () => {
  it("preserves every nav command, action, param4, frame and DO_JUMP target", () => {
    const original = fullMission();
    const back = collapseFromItems(expandToItems(original, OPTS));
    expect(canonical(back)).toEqual(canonical(original));
  });

  it("re-expands to byte-identical wire items", () => {
    const items = expandToItems(fullMission(), OPTS);
    expect(expandToItems(collapseFromItems(items), OPTS)).toEqual(items);
  });

  it("restores the altitude frame per item, not the mission default", () => {
    const back = collapseFromItems(expandToItems(fullMission(), OPTS));
    // Frame cycles relative/absolute/terrain across the nav waypoints; dropping
    // it re-labelled every MSL altitude as relative-to-home on re-upload.
    expect(back.slice(0, 3).map((w) => w.frame)).toEqual([
      "relative",
      "absolute",
      "terrain",
    ]);
  });
});

describe("mission round-trip — plan -> .plan file -> plan", () => {
  it("preserves every nav command, action, param4, frame and DO_JUMP target", () => {
    const original = fullMission();
    const text = captureExport(() => exportQGCPlan(original, "roundtrip"));
    const { waypoints: back } = parseQGCPlan(text);
    expect(canonical(back)).toEqual(canonical(original));
  });

  it("writes MAVLink param1..param4 into params[0..3], including a non-zero param4", () => {
    const text = captureExport(() => exportQGCPlan(fullMission(), "roundtrip"));
    const plan = JSON.parse(text) as {
      mission: { items: Array<{ command: number; params: number[] }> };
    };
    // ROI (201) is the first action item; its params[3] is the action's param4.
    const roi = plan.mission.items.find((it) => it.command === 201);
    expect(roi?.params[3]).toBe(14);
  });
});

describe("mission round-trip — plan -> .waypoints -> plan", () => {
  it("preserves every nav command, action, param4, frame and DO_JUMP target", () => {
    const original = fullMission();
    const text = captureExport(() => exportWaypointsFormat(original, "roundtrip"));
    const back = parseWaypointsFile(text);
    expect(canonical(back)).toEqual(canonical(original));
  });

  it("writes a home row plus one row per wire item, in wire parameter slots", () => {
    const original = fullMission();
    const text = captureExport(() => exportWaypointsFormat(original, "roundtrip"));
    const rows = text.trim().split("\n").slice(1); // drop the QGC WPL header
    const items = expandToItems(original, OPTS);
    expect(rows).toHaveLength(items.length + 1); // + the mandated home row
    expect(rows[0].split("\t")[0]).toBe("0"); // home row is sequence 0

    // First mission row: nav-0 is WAYPOINT(16), holdTime 1 -> wire param1.
    const first = rows[1].split("\t");
    expect(first[3]).toBe("16");
    expect(first[4]).toBe("1"); // param1 == holdTime
    expect(first[5]).toBe("2"); // param2 == model param1
    expect(first[6]).toBe("3"); // param3 == model param2
    expect(first[7]).toBe("4"); // param4 == model param3
  });

  it("keeps a legitimate 0 rather than swallowing it as absent", () => {
    // `parseFloat(x) || undefined` turned every real zero into "absent", so a
    // waypoint whose accept radius is deliberately 0 came back changed.
    const zeros: Waypoint[] = [
      { id: "a", lat: 12.9, lon: 77.5, alt: 30, command: "TAKEOFF", frame: "relative", holdTime: 0, param1: 0, param2: 0, param3: 0 },
      { id: "b", lat: 12.91, lon: 77.51, alt: 30, command: "WAYPOINT", frame: "relative", holdTime: 5, param1: 0, param2: 7, param3: 0 },
    ];
    const text = captureExport(() => exportWaypointsFormat(zeros, "zeros"));
    const back = parseWaypointsFile(text);
    expect(canonical(back)).toEqual(canonical(zeros));
    expect(back[1].holdTime).toBe(5);
    expect(back[1].param2).toBe(7);
  });
});

describe("flat formats agree with the wire on every parameter slot", () => {
  it(".waypoints and .plan write the same slots as expandToItems", () => {
    const original = fullMission();
    const items = expandToItems(original, OPTS);

    const wpText = captureExport(() => exportWaypointsFormat(original, "x"));
    const wpRows = wpText.trim().split("\n").slice(2); // header + home row
    const planText = captureExport(() => exportQGCPlan(original, "x"));
    // Named const rather than an inline cast: the shape is asserted once, at
    // the JSON boundary, and read from a typed value.
    const parsedPlan: ExportedPlan = JSON.parse(planText);
    const planItems = parsedPlan.mission.items;

    expect(wpRows).toHaveLength(items.length);
    expect(planItems).toHaveLength(items.length);

    for (let i = 0; i < items.length; i++) {
      const cols = wpRows[i].split("\t");
      const wire = items[i];
      // DO_JUMP's param1 is a sequence number and is shifted into the file's
      // 1-based numbering by both exporters; every other slot is verbatim.
      const expectedP1 = wire.command === 177 ? wire.param1 + 1 : wire.param1;
      expect(Number(cols[2])).toBe(wire.frame);
      expect(Number(cols[3])).toBe(wire.command);
      expect(Number(cols[4])).toBe(expectedP1);
      expect(Number(cols[5])).toBe(wire.param2);
      expect(Number(cols[6])).toBe(wire.param3);
      expect(Number(cols[7])).toBe(wire.param4);

      expect(planItems[i].frame).toBe(wire.frame);
      expect(planItems[i].command).toBe(wire.command);
      expect(planItems[i].params.slice(0, 4)).toEqual([
        expectedP1, wire.param2, wire.param3, wire.param4,
      ]);
    }
  });
});
