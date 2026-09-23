/**
 * @module mission-io-formats.test
 * @description Round-trip + robustness tests for .waypoints / .plan parsing.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cmdMap,
  reverseCmd,
  parseWaypointsFile,
  parseQGCPlan,
  exportWaypointsFormat,
  exportQGCPlan,
} from "@/lib/mission-io-formats";
import type { Waypoint } from "@/lib/types";
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import { withImportedFenceZones } from "@/lib/mission/qgc-plan-extras";
import type { RallyPoint } from "@/stores/rally-store";

/**
 * Capture the text a download exporter writes into its Blob without touching
 * the DOM download mechanics. The exporters build a Blob from a single string
 * part, then trigger an anchor click; we record that string and stub the
 * browser-only side effects so the test asserts file CONTENT, not plumbing.
 */
function captureExport(run: () => void): string {
  let captured = "";
  // The exporter calls `new Blob(...)`, so the stub must be a real constructor
  // (an arrow/mock function is not constructable). Swap the global Blob for a
  // minimal class that records the joined string parts, and restore it after.
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
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock");
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

describe("mission-io-formats command maps", () => {
  it("reverseCmd is the exact inverse of cmdMap (no command decodes wrong)", () => {
    for (const [name, num] of Object.entries(cmdMap)) {
      expect(reverseCmd[num]).toBe(name);
    }
  });

  it("decodes DO_SET_ROI_NONE (197) and DO_LAND_START (189) rather than falling back to WAYPOINT", () => {
    expect(reverseCmd[197]).toBe("DO_SET_ROI_NONE");
    expect(reverseCmd[189]).toBe("DO_LAND_START");
  });
});

describe("parseWaypointsFile", () => {
  const header = "QGC WPL 110";
  const row = (seq: number, cmd: number, lat: string, lon: string, alt = "50") =>
    `${seq}\t0\t3\t${cmd}\t0\t0\t0\t0\t${lat}\t${lon}\t${alt}\t1`;

  it("parses a valid mission and skips the home row (seq 0)", () => {
    const text = [header, row(0, 16, "12.9", "77.5"), row(1, 16, "12.91", "77.51"), row(2, 21, "12.92", "77.52")].join("\n");
    const wps = parseWaypointsFile(text).waypoints;
    expect(wps).toHaveLength(2);
    expect(wps[0].command).toBe("WAYPOINT");
    expect(wps[1].command).toBe("LAND");
  });

  it("skips a malformed row instead of emitting a NaN waypoint", () => {
    const text = [header, row(1, 16, "not-a-number", "77.5"), row(2, 16, "12.91", "77.51")].join("\n");
    const wps = parseWaypointsFile(text).waypoints;
    expect(wps).toHaveLength(1);
    expect(Number.isFinite(wps[0].lat)).toBe(true);
    expect(Number.isFinite(wps[0].lon)).toBe(true);
  });

  it("defaults a non-numeric altitude to 0 rather than NaN", () => {
    const text = [header, row(1, 16, "12.9", "77.5", "bad-alt")].join("\n");
    const wps = parseWaypointsFile(text).waypoints;
    expect(wps).toHaveLength(1);
    expect(wps[0].alt).toBe(0);
  });

  it("throws on a file without the QGC WPL header", () => {
    expect(() => parseWaypointsFile("garbage\n1\t2\t3")).toThrow();
  });
});

describe("parseQGCPlan", () => {
  it("parses SimpleItems and decodes commands", () => {
    const plan = {
      fileType: "Plan",
      mission: {
        items: [
          { type: "SimpleItem", command: 22, params: [0, 0, 0, 0, 12.9, 77.5, 30] },
          { type: "SimpleItem", command: 16, params: [0, 0, 0, 0, 12.91, 77.51, 50] },
        ],
      },
    };
    const { waypoints: wps } = parseQGCPlan(JSON.stringify(plan));
    expect(wps).toHaveLength(2);
    expect(wps[0].command).toBe("TAKEOFF");
    expect(wps[1].command).toBe("WAYPOINT");
  });

  it("throws on a non-Plan file", () => {
    expect(() => parseQGCPlan(JSON.stringify({ fileType: "Nope" }))).toThrow();
  });
});

describe("altitude frame round-trip", () => {
  beforeEach(() => {
    // Deterministic IDs are irrelevant here; we assert on frame, not id.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A home waypoint (index 0) plus one absolute and one relative waypoint.
  const mission: Waypoint[] = [
    { id: "home", lat: 12.9, lon: 77.5, alt: 0, command: "WAYPOINT", frame: "relative" },
    { id: "abs", lat: 12.91, lon: 77.51, alt: 120, command: "WAYPOINT", frame: "absolute" },
    { id: "rel", lat: 12.92, lon: 77.52, alt: 60, command: "WAYPOINT", frame: "relative" },
  ];

  it(".waypoints export writes per-waypoint frames (absolute=0, relative=3) instead of hard-coding 3", () => {
    const text = captureExport(() => exportWaypointsFormat(mission, "frame-test"));
    // Layout: [header, synthetic-home(seq0), wp0(home), wp1(abs), wp2(rel)].
    // Frame is column index 2 (tab-separated). After dropping the header and
    // the synthetic seq-0 home row, the real waypoint rows start at index 1.
    const rows = text.trim().split("\n").slice(1);
    expect(rows[1].split("\t")[2]).toBe("3"); // home (relative)
    expect(rows[2].split("\t")[2]).toBe("0"); // absolute -> MAV_FRAME_GLOBAL
    expect(rows[3].split("\t")[2]).toBe("3"); // relative -> MAV_FRAME_GLOBAL_RELATIVE_ALT
  });

  it(".waypoints round-trip keeps an absolute waypoint absolute and a relative one relative", () => {
    const text = captureExport(() => exportWaypointsFormat(mission, "frame-test"));
    const reimported = parseWaypointsFile(text).waypoints;
    // parse skips only the synthetic seq-0 home row, so all three survive.
    expect(reimported).toHaveLength(3);
    expect(reimported[0].frame).toBe("relative"); // home
    expect(reimported[1].frame).toBe("absolute");
    expect(reimported[2].frame).toBe("relative");
  });

  it(".plan export writes per-waypoint frames instead of hard-coding 3", () => {
    const text = captureExport(() => exportQGCPlan(mission, "frame-test"));
    const plan = JSON.parse(text);
    const items = plan.mission.items as Array<{ frame: number }>;
    expect(items[0].frame).toBe(3); // home (relative)
    expect(items[1].frame).toBe(0); // absolute -> MAV_FRAME_GLOBAL
    expect(items[2].frame).toBe(3); // relative
  });

  it(".plan round-trip keeps an absolute waypoint absolute and a relative one relative", () => {
    const text = captureExport(() => exportQGCPlan(mission, "frame-test"));
    const { waypoints: reimported } = parseQGCPlan(text);
    expect(reimported).toHaveLength(3);
    expect(reimported[0].frame).toBe("relative");
    expect(reimported[1].frame).toBe("absolute");
    expect(reimported[2].frame).toBe("relative");
  });

  it("a waypoint with no explicit frame exports as relative (mission default), preserving prior behavior", () => {
    const noFrame: Waypoint[] = [
      { id: "home", lat: 12.9, lon: 77.5, alt: 0, command: "WAYPOINT" },
      { id: "wp", lat: 12.91, lon: 77.51, alt: 50, command: "WAYPOINT" },
    ];
    const text = captureExport(() => exportWaypointsFormat(noFrame, "no-frame"));
    const rows = text.trim().split("\n").slice(1);
    expect(rows[1].split("\t")[2]).toBe("3"); // defaults to relative
    const reimported = parseWaypointsFile(text).waypoints;
    expect(reimported[0].frame).toBe("relative");
  });
});

describe(".plan geofence + rally round-trip", () => {
  const mission: Waypoint[] = [
    { id: "home", lat: 12.9, lon: 77.5, alt: 0, command: "WAYPOINT", frame: "relative" },
    { id: "wp", lat: 12.91, lon: 77.51, alt: 50, command: "WAYPOINT", frame: "relative" },
  ];

  const geofence: GeofenceSnapshot = {
    enabled: true,
    fenceType: "polygon",
    maxAltitude: 120,
    minAltitude: 0,
    breachAction: "RTL",
    circleCenter: null,
    circleRadius: 200,
    polygonPoints: [],
    zones: [
      {
        id: "z1",
        role: "inclusion",
        type: "polygon",
        polygonPoints: [
          [12.90, 77.50],
          [12.92, 77.50],
          [12.92, 77.52],
        ],
        circleCenter: null,
        circleRadius: 0,
      },
      {
        id: "z2",
        role: "exclusion",
        type: "circle",
        polygonPoints: [],
        circleCenter: [12.905, 77.505],
        circleRadius: 50,
      },
    ],
  };

  const rally: RallyPoint[] = [
    { id: "r1", lat: 12.9, lon: 77.5, alt: 30 },
    { id: "r2", lat: 12.92, lon: 77.52, alt: 45 },
  ];

  it("serializes the geoFence and rallyPoints blocks instead of hard-coding them empty", () => {
    const text = captureExport(() => exportQGCPlan(mission, "extras", undefined, { geofence, rally }));
    const plan = JSON.parse(text);
    expect(plan.geoFence.polygons).toHaveLength(1);
    expect(plan.geoFence.circles).toHaveLength(1);
    expect(plan.rallyPoints.points).toHaveLength(2);
  });

  it("round-trips inclusion / exclusion fence zones and rally points through export → import", () => {
    const text = captureExport(() => exportQGCPlan(mission, "extras", undefined, { geofence, rally }));
    const parsed = parseQGCPlan(text);

    // Waypoints survive alongside the extras.
    expect(parsed.waypoints).toHaveLength(2);

    // Geofence zones: one inclusion polygon, one exclusion circle.
    expect(parsed.fenceZones).toBeDefined();
    const zones = parsed.fenceZones!;
    expect(zones).toHaveLength(2);

    const poly = zones.find((z) => z.type === "polygon");
    expect(poly).toBeDefined();
    expect(poly!.role).toBe("inclusion");
    expect(poly!.polygonPoints).toHaveLength(3);
    expect(poly!.polygonPoints[0][0]).toBeCloseTo(12.90);
    expect(poly!.polygonPoints[0][1]).toBeCloseTo(77.50);

    const circle = zones.find((z) => z.type === "circle");
    expect(circle).toBeDefined();
    expect(circle!.role).toBe("exclusion");
    expect(circle!.circleCenter?.[0]).toBeCloseTo(12.905);
    expect(circle!.circleRadius).toBe(50);

    // Rally points survive with altitude.
    expect(parsed.rally).toBeDefined();
    expect(parsed.rally).toHaveLength(2);
    expect(parsed.rally![0].alt).toBe(30);
    expect(parsed.rally![1].lat).toBeCloseTo(12.92);
  });

  it("leaves geofence / rally undefined for a plan that carries neither", () => {
    const plan = {
      fileType: "Plan",
      mission: { items: [{ type: "SimpleItem", command: 16, params: [0, 0, 0, 0, 12.9, 77.5, 50] }] },
      geoFence: { circles: [], polygons: [], version: 2 },
      rallyPoints: { points: [], version: 2 },
    };
    const parsed = parseQGCPlan(JSON.stringify(plan));
    expect(parsed.waypoints).toHaveLength(1);
    expect(parsed.fenceZones).toBeUndefined();
    expect(parsed.rally).toBeUndefined();
  });
});

describe(".plan complex-item (survey grid) expansion", () => {
  it("expands a ComplexItem's embedded transect items into waypoints", () => {
    const plan = {
      fileType: "Plan",
      mission: {
        items: [
          { type: "SimpleItem", command: 22, params: [0, 0, 0, 0, 12.9, 77.5, 30] },
          {
            type: "ComplexItem",
            complexItemType: "survey",
            TransectStyleComplexItem: {
              Items: [
                { type: "SimpleItem", command: 16, params: [0, 0, 0, 0, 12.91, 77.51, 50] },
                { type: "SimpleItem", command: 16, params: [0, 0, 0, 0, 12.92, 77.52, 50] },
              ],
            },
          },
        ],
      },
    };
    const parsed = parseQGCPlan(JSON.stringify(plan));
    // 1 takeoff + 2 grid legs = 3 waypoints (grid is no longer silently dropped).
    expect(parsed.waypoints).toHaveLength(3);
    expect(parsed.waypoints[0].command).toBe("TAKEOFF");
    expect(parsed.waypoints[1].lat).toBeCloseTo(12.91);
    expect(parsed.waypoints[2].lat).toBeCloseTo(12.92);
  });

  it("throws on a complex item with no expandable geometry rather than dropping it", () => {
    const plan = {
      fileType: "Plan",
      mission: {
        items: [
          { type: "ComplexItem", complexItemType: "survey", TransectStyleComplexItem: {} },
        ],
      },
    };
    expect(() => parseQGCPlan(JSON.stringify(plan))).toThrow(/complex mission item/i);
  });

  function visualOnlySurvey(cameraCalc?: Record<string, unknown>) {
    return {
      fileType: "Plan",
      mission: {
        items: [{
          type: "ComplexItem",
          complexItemType: "survey",
          TransectStyleComplexItem: {
            VisualTransectPoints: [[12.91, 77.51], [12.92, 77.52]],
            ...(cameraCalc ? { CameraCalc: cameraCalc } : {}),
          },
        }],
      },
    };
  }

  it("flies a survey rebuilt from visual points at the file's survey height and frame", () => {
    const rel = parseQGCPlan(JSON.stringify(visualOnlySurvey({ DistanceToSurface: 55, DistanceMode: 1 }))).waypoints;
    expect(rel.map((w) => [w.alt, w.frame])).toEqual([[55, "relative"], [55, "relative"]]);

    const amsl = parseQGCPlan(JSON.stringify(visualOnlySurvey({ DistanceToSurface: 900, DistanceMode: 2 }))).waypoints;
    expect(amsl[0]).toMatchObject({ alt: 900, frame: "absolute" });

    // Files written before DistanceMode carry the relative flag instead.
    const legacy = parseQGCPlan(JSON.stringify(visualOnlySurvey({ DistanceToSurface: 40, DistanceToSurfaceRelative: false }))).waypoints;
    expect(legacy[0]).toMatchObject({ alt: 40, frame: "absolute" });
  });

  it("refuses visual points with no survey height instead of placing the grid at 0 m", () => {
    expect(() => parseQGCPlan(JSON.stringify(visualOnlySurvey()))).toThrow(/survey altitude/);
    // Heights computed per point from terrain the file does not carry.
    expect(() => parseQGCPlan(JSON.stringify(visualOnlySurvey({ DistanceToSurface: 50, DistanceMode: 3 })))).toThrow(/altitude mode/);
  });
});

describe(".plan fence import keeps the operator's fence settings", () => {
  it("carries geometry only and merges into the current settings", () => {
    const plan = {
      fileType: "Plan",
      mission: { items: [{ type: "SimpleItem", command: 16, params: [0, 0, 0, 0, 12.9, 77.5, 50] }] },
      geoFence: { circles: [{ inclusion: false, circle: { center: [12.9, 77.5], radius: 40 } }], polygons: [] },
    };
    const parsed = parseQGCPlan(JSON.stringify(plan));
    expect(parsed).not.toHaveProperty("geofence");
    const current: GeofenceSnapshot = {
      enabled: false, fenceType: "polygon", maxAltitude: 60, minAltitude: 5, breachAction: "LAND",
      circleCenter: null, circleRadius: 150, polygonPoints: [], zones: [],
    };
    const merged = withImportedFenceZones(current, parsed.fenceZones!);
    expect(merged).toMatchObject({ enabled: false, maxAltitude: 60, minAltitude: 5, breachAction: "LAND" });
    expect(merged.zones).toHaveLength(1);
    expect(merged.zones[0]).toMatchObject({ role: "exclusion", type: "circle", circleRadius: 40 });
  });
});

describe("nested actions round-trip through the flat formats", () => {
  // A mission whose middle waypoint carries two actions and whose last waypoint
  // carries a DO_JUMP back to the middle waypoint.
  function nestedMission(): Waypoint[] {
    return [
      { id: "wp-0", lat: 12.9716, lon: 77.5946, alt: 0, command: "TAKEOFF", frame: "relative" },
      {
        id: "wp-1", lat: 12.972, lon: 77.595, alt: 50, command: "WAYPOINT", frame: "relative",
        actions: [
          { id: "a-spd", command: "DO_SET_SPEED", param1: 1, param2: 8 },
          { id: "a-yaw", command: "CONDITION_YAW", param1: 90, param2: 20, param3: 1 },
        ],
      },
      {
        id: "wp-2", lat: 12.973, lon: 77.596, alt: 50, command: "LAND", frame: "relative",
        actions: [{ id: "a-jmp", command: "DO_JUMP", jumpTargetId: "wp-1", param2: 2 }],
      },
    ];
  }

  it(".waypoints export\u2192import keeps actions nested and DO_JUMP retargeted", () => {
    const text = captureExport(() => exportWaypointsFormat(nestedMission(), "actions"));
    const re = parseWaypointsFile(text).waypoints;
    expect(re.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT", "LAND"]);
    expect(re[1].actions?.map((a) => a.command)).toEqual(["DO_SET_SPEED", "CONDITION_YAW"]);
    const jump = re[2].actions?.[0];
    expect(jump?.command).toBe("DO_JUMP");
    expect(jump?.command === "DO_JUMP" ? jump.jumpTargetId : undefined).toBe(re[1].id);
  });

  it(".plan export\u2192import keeps actions nested and DO_JUMP retargeted", () => {
    const text = captureExport(() => exportQGCPlan(nestedMission(), "actions"));
    const { waypoints: re } = parseQGCPlan(text);
    expect(re.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT", "LAND"]);
    expect(re[1].actions?.map((a) => a.command)).toEqual(["DO_SET_SPEED", "CONDITION_YAW"]);
    const jump = re[2].actions?.[0];
    expect(jump?.command).toBe("DO_JUMP");
    expect(jump?.command === "DO_JUMP" ? jump.jumpTargetId : undefined).toBe(re[1].id);
  });
});
