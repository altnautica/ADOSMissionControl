// Exempt from 300 LOC soft rule: static demo mission data fixtures.
/**
 * @module mock/demo-missions
 * @description Five pre-built demo missions at iconic global locations, seeded
 * into the plan library in demo mode. Each hero-s a different pattern and,
 * together, they exercise the whole planning + simulation feature set (every
 * altitude frame, inclusion + exclusion fences, rally, terrain-follow, camera
 * triggers, loiter, VTOL, spline, DO_JUMP). Waypoints are computed from the real
 * pattern generators so they match what the pattern tools produce.
 *
 * Action commands (DO_/CONDITION_) are authored inline in each mission's flat
 * row list for readability, then folded into the per-waypoint `actions[]` model
 * at build time — so a demo plan carries the same nested shape the planner does,
 * with its DO_JUMP referencing a stable target waypoint id.
 * @license GPL-3.0-only
 */

import type { SavedPlan, Waypoint, WaypointCommand, AltitudeFrame, PlanFolder } from "@/lib/types";
import { foldLegacyWaypoints, type FlatWaypointRow } from "@/lib/mission/flat-rows";
import type { GeofenceSnapshot, FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { PatternResult } from "@/lib/patterns/types";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { generateOrbit } from "@/lib/patterns/orbit-generator";
import { generateCorridor } from "@/lib/patterns/corridor-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { generateExpandingSquare, generateSectorSearch, generateParallelTrack } from "@/lib/patterns/sar-generators";
import { generateVtolLanding } from "@/lib/patterns/vtol-landing-generator";

export const DEMO_MISSION_FOLDER_ID = "demo-missions-folder";
/** Fixed timestamp so seeded plans are byte-stable across sessions. */
const DEMO_TS = 1_717_200_000_000;

export const DEMO_MISSION_FOLDER: PlanFolder = {
  id: DEMO_MISSION_FOLDER_ID,
  name: "Demo Missions",
  parentId: null,
  createdAt: DEMO_TS,
  order: 0,
};

/** A waypoint (or inline action row) before the plan assigns it a stable id + default frame. */
type RawWp = Omit<FlatWaypointRow, "id"> & { frame?: AltitudeFrame };

/** Map a generator's PatternWaypoint output into raw waypoints. */
function fromPattern(result: PatternResult): RawWp[] {
  return result.waypoints.map((pw) => ({
    lat: pw.lat, lon: pw.lon, alt: pw.alt, speed: pw.speed,
    command: (pw.command || "WAYPOINT") as WaypointCommand,
    param1: pw.param1, param2: pw.param2,
  }));
}

interface DemoSpec {
  id: string;
  name: string;
  frame: AltitudeFrame;
  raw: RawWp[];
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
}

function buildPlan(spec: DemoSpec): SavedPlan {
  const flat: FlatWaypointRow[] = spec.raw.map((w, i) => ({
    ...w,
    id: `${spec.id}-wp-${i}`,
    frame: w.frame ?? spec.frame,
  }));
  // Nest the inline action rows (DO_/CONDITION_) under the navigation waypoint
  // they fire at, resolving any legacy DO_JUMP index to a stable target id.
  const waypoints = foldLegacyWaypoints(flat);
  return {
    id: spec.id,
    name: spec.name,
    folderId: DEMO_MISSION_FOLDER_ID,
    waypoints,
    metadata: {
      geofence: spec.geofence
        ? { enabled: spec.geofence.enabled, type: spec.geofence.fenceType, maxAlt: spec.geofence.maxAltitude, action: spec.geofence.breachAction }
        : undefined,
    },
    geofence: spec.geofence,
    rally: spec.rally,
    createdAt: DEMO_TS,
    updatedAt: DEMO_TS,
  };
}

function inclusionFence(part: Partial<GeofenceSnapshot>): GeofenceSnapshot {
  return {
    enabled: true, fenceType: "polygon", maxAltitude: 120, minAltitude: 0, breachAction: "RTL",
    circleCenter: null, circleRadius: 200, polygonPoints: [], zones: [], ...part,
  };
}

// ── Mission 1 — Grand Canyon Rim Terrain Corridor (USA) ──────
const canyonCorridor = generateCorridor({
  pathPoints: [[36.0616, -112.1150], [36.0616, -112.1010]],
  corridorWidth: 240, lineSpacing: 80, altitude: 60, speed: 7,
});
const grandCanyon = buildPlan({
  id: "demo-grand-canyon-corridor",
  name: "Grand Canyon Rim Terrain Corridor",
  frame: "terrain",
  raw: [
    { lat: 36.0602, lon: -112.1155, alt: 30, command: "TAKEOFF" },
    { lat: 36.0602, lon: -112.1155, alt: 30, command: "DO_SET_SPEED", param1: 1, param2: 7, param3: -1 },
    { lat: 36.0602, lon: -112.1155, alt: 60, command: "CONDITION_YAW", param1: 0, param2: 15, param3: 1 },
    ...fromPattern(canyonCorridor),
    { lat: 36.0625, lon: -112.1010, alt: 45, speed: 7, holdTime: 20, command: "LOITER_TIME" },
    { lat: 36.0625, lon: -112.1010, alt: 45, command: "DELAY", param1: 10, holdTime: 10 },
    { lat: 36.0602, lon: -112.1155, alt: 60, command: "RTL" },
  ],
});

// ── Mission 2 — Statue of Liberty Structure Scan (USA) ───────
const libertyScan = generateStructureScan({
  structurePolygon: [[40.68930, -74.04460], [40.68930, -74.04440], [40.68910, -74.04440], [40.68910, -74.04460]],
  bottomAlt: 15, topAlt: 100, layerSpacing: 25, scanDistance: 35, gimbalPitch: -15,
  pointsPerLayer: 8, cameraTriggerDistance: 15, speed: 4, direction: "bottom-up",
});
const liberty = buildPlan({
  id: "demo-liberty-structure-scan",
  name: "Statue of Liberty Structure Scan",
  frame: "absolute",
  raw: [
    { lat: 40.68840, lon: -74.04470, alt: 20, command: "TAKEOFF" },
    { lat: 40.68840, lon: -74.04470, alt: 20, command: "DO_MOUNT_CONTROL", param1: -15, param2: 0, param3: 0 },
    ...fromPattern(libertyScan),
    { lat: 40.68935, lon: -74.04405, alt: 95, command: "DO_DIGICAM", param5: 1 },
    { lat: 40.68935, lon: -74.04450, alt: 100, speed: 4, holdTime: 2, command: "LOITER_TURNS", param2: 30 },
    { lat: 40.68935, lon: -74.04450, alt: 100, command: "DO_SET_ROI_NONE" },
    { lat: 40.68870, lon: -74.04465, alt: 25, command: "DO_LAND_START" },
    { lat: 40.68840, lon: -74.04470, alt: 0, command: "LAND" },
  ],
  geofence: {
    enabled: true, fenceType: "circle", maxAltitude: 120, minAltitude: 0, breachAction: "RTL",
    circleCenter: [40.6892, -74.0445], circleRadius: 150, polygonPoints: [], zones: [],
  },
});

// ── Mission 3 — Matterhorn SAR (Switzerland) ─────────────────
const sarDatum: [number, number] = [45.9800, 7.6600];
const matterhorn = buildPlan({
  id: "demo-matterhorn-sar",
  name: "Matterhorn SAR — Three-Pattern Search",
  frame: "terrain",
  raw: [
    { lat: 45.9788, lon: 7.6595, alt: 30, command: "TAKEOFF" },
    { lat: 45.9788, lon: 7.6595, alt: 50, command: "CONDITION_YAW", param1: 45, param2: 20, param3: 1 },
    ...fromPattern(generateExpandingSquare({ center: sarDatum, legSpacing: 60, maxLegs: 8, altitude: 50, speed: 9, startBearing: 45 })),
    { lat: sarDatum[0], lon: sarDatum[1], alt: 50, speed: 9, holdTime: 25, command: "LOITER_TIME", param1: 25 },
    ...fromPattern(generateSectorSearch({ center: sarDatum, radius: 150, sweeps: 3, altitude: 50, speed: 9, startBearing: 0 })),
    ...fromPattern(generateParallelTrack({ startPoint: [45.9782, 7.6585], trackLength: 250, trackSpacing: 60, trackCount: 4, bearing: 90, altitude: 50, speed: 9 })),
    { lat: 45.9788, lon: 7.6595, alt: 50, command: "RTL" },
  ],
  geofence: inclusionFence({
    polygonPoints: [[45.9760, 7.6560], [45.9760, 7.6650], [45.9840, 7.6650], [45.9840, 7.6560]],
  }),
  rally: [
    { id: "demo-matterhorn-rally-0", lat: 45.9785, lon: 7.6590, alt: 40 },
    { id: "demo-matterhorn-rally-1", lat: 45.9805, lon: 7.6610, alt: 40 },
  ],
});

// ── Mission 4 — Keukenhof Tulip-Fields Mapping Survey (NL) ───
const tulipSurvey = generateSurvey({
  polygon: [[52.2725, 4.5445], [52.2725, 4.5490], [52.2700, 4.5490], [52.2700, 4.5445]],
  gridAngle: 0, lineSpacing: 40, turnAroundDistance: 15, entryLocation: "topLeft",
  flyAlternateTransects: false, cameraTriggerDistance: 20, crosshatch: true, altitude: 50, speed: 6,
});
const keukenhof = buildPlan({
  id: "demo-keukenhof-survey",
  name: "Keukenhof Tulip-Fields Mapping Survey",
  frame: "relative",
  raw: [
    { lat: 52.2727, lon: 4.5443, alt: 25, command: "TAKEOFF" },
    { lat: 52.2727, lon: 4.5443, alt: 25, command: "DO_SET_SPEED", param1: 1, param2: 6, param3: -1 },
    ...fromPattern(tulipSurvey),
    // Re-fly an early transect. param1 targets a valid 1-based waypoint index
    // (the first survey nav waypoint sits just after the two framing items).
    { lat: 52.2727, lon: 4.5443, alt: 50, command: "DO_JUMP", param1: 3, param2: 1 },
    { lat: 52.2726, lon: 4.5446, alt: 25, command: "DO_LAND_START" },
    { lat: 52.2727, lon: 4.5443, alt: 0, command: "LAND" },
  ],
  geofence: inclusionFence({
    polygonPoints: [[52.2730, 4.5440], [52.2730, 4.5495], [52.2697, 4.5495], [52.2697, 4.5440]],
  }),
});

// ── Mission 5 — Sydney Harbour Cinematic VTOL (Australia) ────
const operaHouse: [number, number] = [-33.8568, 151.2153];
const sydneyNoFly: FenceZone[] = [
  { id: "demo-sydney-bridge-nofly", role: "exclusion", type: "polygon",
    polygonPoints: [[-33.8515, 151.2095], [-33.8515, 151.2122], [-33.8528, 151.2122], [-33.8528, 151.2095]],
    circleCenter: null, circleRadius: 0 },
  { id: "demo-sydney-helipad-nofly", role: "exclusion", type: "circle",
    polygonPoints: [], circleCenter: [-33.8600, 151.2130], circleRadius: 80 },
];
const sydney = buildPlan({
  id: "demo-sydney-cinematic",
  name: "Sydney Harbour Cinematic",
  frame: "absolute",
  raw: [
    { lat: -33.8575, lon: 151.2160, alt: 30, command: "VTOL_TAKEOFF" },
    { lat: operaHouse[0], lon: operaHouse[1], alt: 60, command: "ROI" },
    ...fromPattern(generateOrbit({ center: operaHouse, radius: 70, direction: "cw", turns: 1, startAngle: 0, altitude: 60, speed: 6 })),
    { lat: -33.8558, lon: 151.2140, alt: 65, speed: 7, command: "SPLINE_WAYPOINT" },
    { lat: -33.8558, lon: 151.2140, alt: 65, command: "DO_DIGICAM", param5: 1 },
    { lat: -33.8548, lon: 151.2125, alt: 70, speed: 7, command: "SPLINE_WAYPOINT" },
    { lat: -33.8540, lon: 151.2118, alt: 72, speed: 7, command: "SPLINE_WAYPOINT" },
    { lat: -33.8538, lon: 151.2112, alt: 80, speed: 7, holdTime: 2, command: "LOITER_TURNS", param2: 40 },
    { lat: -33.8538, lon: 151.2112, alt: 80, command: "DO_SET_ROI_NONE" },
    { lat: -33.8558, lon: 151.2135, alt: 60, speed: 8, command: "SPLINE_WAYPOINT" },
    ...fromPattern(generateVtolLanding({ landingPoint: [-33.8575, 151.2160], approachHeading: 130, transitionDistance: 150, approachAltitude: 60, descentSpeed: 2, speed: 8 })),
  ],
  geofence: {
    enabled: false, fenceType: "circle", maxAltitude: 120, minAltitude: 0, breachAction: "RTL",
    circleCenter: null, circleRadius: 200, polygonPoints: [], zones: sydneyNoFly,
  },
  rally: [{ id: "demo-sydney-rally-0", lat: -33.8578, lon: 151.2150, alt: 30 }],
});

export const DEMO_PLANS: SavedPlan[] = [grandCanyon, liberty, matterhorn, keukenhof, sydney];

/** Stable ids used to seed + tear down without touching the user's real plans. */
export const DEMO_PLAN_IDS: string[] = DEMO_PLANS.map((p) => p.id);

export function isDemoPlanId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("demo-");
}
