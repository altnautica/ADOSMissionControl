import { describe, it, expect } from "vitest";
import { expandToItems, collapseFromItems } from "@/lib/mission/mission-expand";
import { flattenForSerialization, foldLegacyWaypoints } from "@/lib/mission/flat-rows";
import { cmdMap, frameToMav } from "@/lib/mission-io-formats";
import { encodeMissionItemInt } from "@/lib/protocol/encoders/mission";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type {
  AltitudeFrame, CommandMissionAction, MissionAction, Waypoint,
} from "@/lib/types/mission";

/** A modelled action (never a raw passthrough), for reading its typed fields. */
function known(a: MissionAction | undefined): CommandMissionAction | undefined {
  if (a?.command === "RAW") throw new Error("unexpected raw passthrough action");
  return a;
}

const OPTS = { defaultFrame: "relative" as AltitudeFrame };

// ── Structural normalizers (ignore fresh ids; 0 ≡ undefined; []≡undefined) ──

function z(v: number | undefined): number | undefined {
  return v === undefined || v === 0 ? undefined : v;
}
function r7(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.round(v * 1e7) / 1e7;
}

/** Normalize a waypoint list to compare structure, resolving jumps by target index. */
function normWaypoints(wps: readonly Waypoint[]) {
  const idToIndex = new Map(wps.map((w, i) => [w.id, i]));
  return wps.map((w) => ({
    command: w.command ?? "WAYPOINT",
    lat: r7(w.lat),
    lon: r7(w.lon),
    alt: w.alt,
    holdTime: z(w.holdTime),
    p1: z(w.param1),
    p2: z(w.param2),
    p3: z(w.param3),
    actions: (w.actions ?? []).map((raw) => known(raw)!).map((a) => ({
      command: a.command,
      p1: z(a.param1),
      p2: z(a.param2),
      p3: z(a.param3),
      p4: z(a.param4),
      lat: r7(a.lat),
      lon: r7(a.lon),
      alt: a.alt,
      target: a.jumpTargetId === undefined ? undefined : idToIndex.get(a.jumpTargetId),
    })),
  }));
}

// ── Golden fixture: TAKEOFF, WAYPOINT+[speed,yaw], WAYPOINT, WAYPOINT+[jump→wp1] ──

function goldenWaypoints(): Waypoint[] {
  return [
    { id: "wp-0", lat: 12.9716, lon: 77.5946, alt: 0, command: "TAKEOFF" },
    {
      id: "wp-1",
      lat: 12.972,
      lon: 77.595,
      alt: 50,
      command: "WAYPOINT",
      actions: [
        { id: "act-speed", command: "DO_SET_SPEED", param1: 1, param2: 12 },
        { id: "act-yaw", command: "CONDITION_YAW", param1: 90, param2: 20, param3: 1 },
      ],
    },
    { id: "wp-2", lat: 12.973, lon: 77.596, alt: 50, command: "WAYPOINT" },
    {
      id: "wp-3",
      lat: 12.974,
      lon: 77.597,
      alt: 50,
      command: "WAYPOINT",
      actions: [{ id: "act-jump", command: "DO_JUMP", jumpTargetId: "wp-1", param2: 3 }],
    },
  ];
}

describe("flattenForSerialization ↔ foldLegacyWaypoints", () => {
  it("flatten then fold restores the nested mission (incl DO_JUMP target)", () => {
    const nested = goldenWaypoints();
    const flat = flattenForSerialization(nested);
    // Flat form is a pure NAV+action row list: no nested actions remain.
    expect(flat.every((w) => (w.actions ?? []).length === 0)).toBe(true);
    // The DO_JUMP row carries the target's 1-based flat index in param1.
    const jumpRow = flat.find((w) => w.command === "DO_JUMP");
    const wp1Index = flat.findIndex((w) => w.id === "wp-1");
    expect(jumpRow?.param1).toBe(wp1Index + 1);
    // Folding the flat rows reproduces the original nested structure.
    expect(normWaypoints(foldLegacyWaypoints(flat))).toEqual(normWaypoints(nested));
  });

  it("flatten emits one row per navigation waypoint plus one per action", () => {
    const flat = flattenForSerialization(goldenWaypoints());
    // 4 NAV waypoints + 3 attached actions = 7 rows.
    expect(flat).toHaveLength(7);
  });
});

describe("expandToItems — sequence math", () => {
  it("produces contiguous zero-based seq (items[i].seq === i)", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    expect(items.every((it, i) => it.seq === i)).toBe(true);
  });

  it("empty mission expands to no items", () => {
    expect(expandToItems([], OPTS)).toEqual([]);
  });
});

describe("expandToItems — golden fixture", () => {
  it("emits the exact seq list and command order", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    expect(items.map((it) => it.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(items.map((it) => it.command)).toEqual([
      cmdMap.TAKEOFF, // 0
      cmdMap.WAYPOINT, // 1
      cmdMap.DO_SET_SPEED, // 2  (action of wp-1)
      cmdMap.CONDITION_YAW, // 3  (action of wp-1)
      cmdMap.WAYPOINT, // 4
      cmdMap.WAYPOINT, // 5
      cmdMap.DO_JUMP, // 6  (action of wp-3)
    ]);
  });

  it("DO_JUMP item param1 == the target's flattened seq, param2 == repeat", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    const jump = items[6];
    expect(jump.command).toBe(cmdMap.DO_JUMP);
    // wp-1 is at flattened seq 1.
    expect(jump.param1).toBe(1);
    expect(jump.param2).toBe(3);
    // A jump item carries no position.
    expect([jump.x, jump.y, jump.z]).toEqual([0, 0, 0]);
  });

  it("only the seq-0 nav item is current; actions inherit the parent frame", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    expect(items.map((it) => it.current)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    const relFrame = frameToMav("relative");
    expect(items.every((it) => it.frame === relFrame)).toBe(true);
  });
});

describe("expand / collapse round-trips", () => {
  it("collapse(expand(x)) structurally equals x", () => {
    const x = goldenWaypoints();
    const back = collapseFromItems(expandToItems(x, OPTS));
    expect(normWaypoints(back)).toEqual(normWaypoints(x));
  });

  it("expand(collapse(items)) reproduces items byte-for-byte", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    const reproduced = expandToItems(collapseFromItems(items), OPTS);
    expect(reproduced).toEqual(items);
  });

  it("DO_JUMP round-trips id → seq → id both ways", () => {
    const x = goldenWaypoints();
    const collapsed = collapseFromItems(expandToItems(x, OPTS));
    const jumpWp = collapsed[3];
    const jumpAction = known(jumpWp.actions?.[0]);
    expect(jumpAction?.command).toBe("DO_JUMP");
    // The resolved target id is the collapsed waypoint that sits at index 1.
    expect(jumpAction?.jumpTargetId).toBe(collapsed[1].id);
    expect(jumpAction?.param2).toBe(3);
  });
});

describe("DO_JUMP — forward jump proves the two-pass resolution", () => {
  it("a jump targeting a later waypoint resolves to that waypoint's seq", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 1, lon: 1, alt: 10, command: "WAYPOINT",
        actions: [{ id: "j", command: "DO_JUMP", jumpTargetId: "c", param2: 1 }] },
      { id: "b", lat: 2, lon: 2, alt: 10, command: "WAYPOINT" },
      { id: "c", lat: 3, lon: 3, alt: 10, command: "WAYPOINT" },
    ];
    const items = expandToItems(wps, OPTS);
    // seq: a=0, jump=1, b=2, c=3 → jump.param1 must be 3.
    const jump = items.find((it) => it.command === cmdMap.DO_JUMP);
    expect(jump?.seq).toBe(1);
    expect(jump?.param1).toBe(3);
    expect(items.every((it, i) => it.seq === i)).toBe(true);
  });
});

describe("DO_JUMP — collapse clamps a target inside an action block to the owning NAV", () => {
  it("param1 pointing at an action seq resolves to the containing NAV id", () => {
    // Hand-built wire: nav(0), action(1)=set_speed, nav(2), jump(3) targeting seq 1.
    const items: MissionItem[] = [
      wireNav(0, 10, 10, 30),
      wireAction(1, cmdMap.DO_SET_SPEED, 1, 5),
      wireNav(2, 20, 20, 30),
      { ...wireAction(3, cmdMap.DO_JUMP, 1 /* target seq (an action) */, 2 /* repeat */) },
    ];
    const wps = collapseFromItems(items);
    // seq 1 is owned by the NAV at seq 0 → first collapsed waypoint.
    const jumpAction = known(wps[1].actions?.[0]);
    expect(jumpAction?.command).toBe("DO_JUMP");
    expect(jumpAction?.jumpTargetId).toBe(wps[0].id);
  });
});

describe("DO_JUMP — unresolved target drops the item and re-tightens seq", () => {
  it("a missing jumpTargetId omits the DO_JUMP and keeps seq contiguous", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 1, lon: 1, alt: 10, command: "WAYPOINT" },
      { id: "b", lat: 2, lon: 2, alt: 10, command: "WAYPOINT",
        actions: [
          { id: "dangling", command: "DO_JUMP", jumpTargetId: "does-not-exist", param2: 1 },
          { id: "keep", command: "DO_SET_SPEED", param1: 1, param2: 8 },
        ] },
    ];
    const items = expandToItems(wps, OPTS);
    expect(items.map((it) => it.command)).toEqual([
      cmdMap.WAYPOINT,
      cmdMap.WAYPOINT,
      cmdMap.DO_SET_SPEED,
    ]);
    expect(items.every((it, i) => it.seq === i)).toBe(true);
  });

  it("a DO_JUMP with no jumpTargetId at all is dropped", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 1, lon: 1, alt: 10, command: "WAYPOINT",
        actions: [{ id: "j", command: "DO_JUMP", param2: 1 }] },
    ];
    const items = expandToItems(wps, OPTS);
    expect(items.map((it) => it.command)).toEqual([cmdMap.WAYPOINT]);
  });
});

describe("NAV byte-identity vs the legacy one-slot-shift mapping", () => {
  it("action-free waypoints expand byte-identically to the legacy mapping", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 12.34, lon: 56.78, alt: 25, command: "TAKEOFF",
        holdTime: 2, param1: 3, param2: 4, param3: 5, frame: "absolute" },
      { id: "b", lat: 12.35, lon: 56.79, alt: 40, command: "LOITER_TURNS",
        holdTime: 7, param1: 8 },
      { id: "c", lat: 12.36, lon: 56.8, alt: 40, command: "WAYPOINT" },
    ];
    const items = expandToItems(wps, OPTS);
    const legacy: MissionItem[] = wps.map((wp, i) => ({
      seq: i,
      frame: frameToMav(wp.frame ?? OPTS.defaultFrame),
      command: cmdMap[wp.command ?? "WAYPOINT"] ?? cmdMap.WAYPOINT,
      current: i === 0 ? 1 : 0,
      autocontinue: 1,
      param1: wp.holdTime ?? 0,
      param2: wp.param1 ?? 0,
      param3: wp.param2 ?? 0,
      param4: wp.param3 ?? 0,
      x: Math.round(wp.lat * 1e7),
      y: Math.round(wp.lon * 1e7),
      z: wp.alt,
    }));
    expect(items).toEqual(legacy);
  });
});

describe("positional actions carry lat/lon/alt", () => {
  it("ROI encodes x/y/z from the action position and restores on collapse", () => {
    const wps: Waypoint[] = [
      { id: "a", lat: 10, lon: 20, alt: 30, command: "WAYPOINT",
        actions: [{ id: "roi", command: "ROI", lat: 11.5, lon: 21.5, alt: 5 }] },
    ];
    const items = expandToItems(wps, OPTS);
    const roi = items[1];
    expect(roi.command).toBe(cmdMap.ROI);
    expect(roi.x).toBe(Math.round(11.5 * 1e7));
    expect(roi.y).toBe(Math.round(21.5 * 1e7));
    expect(roi.z).toBe(5);
    const back = collapseFromItems(items);
    const roiAct = known(back[0].actions?.[0]);
    expect(roiAct?.command).toBe("ROI");
    expect(roiAct?.lat).toBeCloseTo(11.5, 6);
    expect(roiAct?.lon).toBeCloseTo(21.5, 6);
    expect(roiAct?.alt).toBe(5);
  });
});

describe("byte-exact encoder check — DO_JUMP over the wire", () => {
  it("encodeMissionItemInt writes param1=targetSeq, param2=repeat, seq=seq", () => {
    const items = expandToItems(goldenWaypoints(), OPTS);
    const jump = items[6];
    const targetSeq = jump.param1; // 1
    const repeat = jump.param2; // 3
    const frame = encodeMissionItemInt(
      1, 1, jump.seq, jump.frame, jump.command, jump.current, jump.autocontinue,
      jump.param1, jump.param2, jump.param3, jump.param4, jump.x, jump.y, jump.z,
    );
    // MISSION_ITEM_INT payload begins at frame byte 10 (MAVLink v2 header).
    // Payload offsets: param1 f32 @0, param2 f32 @4, seq u16 @28, command u16 @30.
    const PAYLOAD = 10;
    const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(dv.getFloat32(PAYLOAD + 0, true)).toBe(targetSeq);
    expect(dv.getFloat32(PAYLOAD + 4, true)).toBe(repeat);
    expect(dv.getUint16(PAYLOAD + 28, true)).toBe(jump.seq);
    expect(dv.getUint16(PAYLOAD + 30, true)).toBe(cmdMap.DO_JUMP);
  });
});

// ── Wire-item builders for the hand-built collapse tests ──

function wireNav(seq: number, latDeg: number, lonDeg: number, alt: number): MissionItem {
  return {
    seq, frame: frameToMav("relative"), command: cmdMap.WAYPOINT,
    current: seq === 0 ? 1 : 0, autocontinue: 1,
    param1: 0, param2: 0, param3: 0, param4: 0,
    x: Math.round(latDeg * 1e7), y: Math.round(lonDeg * 1e7), z: alt,
  };
}

function wireAction(seq: number, command: number, p1: number, p2: number): MissionItem {
  return {
    seq, frame: frameToMav("relative"), command,
    current: 0, autocontinue: 1,
    param1: p1, param2: p2, param3: 0, param4: 0,
    x: 0, y: 0, z: 0,
  };
}

describe("position-inheriting nav items (RTL, 0,0 TAKEOFF/LAND/LOITER)", () => {
  function nav(seq: number, command: number, lat: number, lon: number, alt = 30): MissionItem {
    return {
      seq, frame: frameToMav("relative"), command, current: 0, autocontinue: 1,
      param1: 0, param2: 0, param3: 0, param4: 0,
      x: Math.round(lat * 1e7), y: Math.round(lon * 1e7), z: alt,
    };
  }

  it("places an RTL and a 0,0 LAND at the previous waypoint, never at 0°N 0°E", () => {
    const wps = collapseFromItems([
      nav(1, cmdMap.WAYPOINT, 12.97, 77.59),
      nav(2, cmdMap.LAND, 0, 0, 0),
      nav(3, cmdMap.RTL, 0, 0, 0),
    ]);
    expect(wps.map((w) => [w.lat, w.lon, w.inheritsPosition])).toEqual([
      [12.97, 77.59, undefined],
      [12.97, 77.59, true],
      [12.97, 77.59, true],
    ]);
  });

  it("anchors a leading 0,0 TAKEOFF at home, or at the first real waypoint without one", () => {
    const items = [nav(1, cmdMap.TAKEOFF, 0, 0), nav(2, cmdMap.WAYPOINT, 12.97, 77.59)];
    expect(collapseFromItems(items, undefined, { lat: 12.9, lon: 77.5 })[0]).toMatchObject({ lat: 12.9, lon: 77.5, inheritsPosition: true });
    expect(collapseFromItems(items)[0]).toMatchObject({ lat: 12.97, lon: 77.59, inheritsPosition: true });
  });

  it("keeps a LAND with a real location as a positioned waypoint", () => {
    const [, land] = collapseFromItems([nav(1, cmdMap.WAYPOINT, 12.97, 77.59), nav(2, cmdMap.LAND, 12.98, 77.6, 0)]);
    expect(land).toMatchObject({ lat: 12.98, lon: 77.6 });
    expect(land.inheritsPosition).toBeUndefined();
  });

  it("re-emits 0,0 on the wire, so the vehicle still flies from its current position", () => {
    const items = [nav(1, cmdMap.TAKEOFF, 0, 0), nav(2, cmdMap.WAYPOINT, 12.97, 77.59), nav(3, cmdMap.RTL, 0, 0, 0)];
    const out = expandToItems(collapseFromItems(items), OPTS);
    expect(out.map((it) => [it.command, it.x, it.y])).toEqual([
      [cmdMap.TAKEOFF, 0, 0],
      [cmdMap.WAYPOINT, 129700000, 775900000],
      [cmdMap.RTL, 0, 0],
    ]);
  });
});
