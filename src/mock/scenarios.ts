/**
 * Demo mode flight scenario library + pure generators for path, events,
 * health, and synthetic telemetry frames. Used by `seedDemoHistory` to
 * produce a curated set of realistic flights so every History detail tab
 * has real content in demo mode.
 *
 * All functions in this file are pure: deterministic given the same PRNG.
 *
 * @module mock/scenarios
 * @license GPL-3.0-only
 */

import type {
  FlightEvent,
  FlightFlag,
  HealthSummary,
  SuiteType,
} from "@/lib/types";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

// ── PRNG ────────────────────────────────────────────────────

export type Prng = () => number;

export function makePrng(seed: number): Prng {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rand: Prng, min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;

const pick = <T>(rand: Prng, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)];

// ── Sites (Indian regions for demo realism) ─────────────────

export interface DemoSite {
  name: string;
  lat: number;
  lon: number;
}

export const DEMO_SITES: DemoSite[] = [
  { name: "Bangalore HAL", lat: 12.9501, lon: 77.6679 },
  { name: "Mysuru farmland", lat: 12.3052, lon: 76.6553 },
  { name: "Coorg forest", lat: 12.4244, lon: 75.7382 },
  { name: "Chennai port", lat: 13.0954, lon: 80.292 },
  { name: "Pune industrial", lat: 18.6298, lon: 73.7997 },
];

// ── Scenarios ───────────────────────────────────────────────

export type PatternKind =
  | "orbit"
  | "grid"
  | "expanding_box"
  | "spray_rows"
  | "waypoint_hop"
  | "facade_orbit";

export interface Scenario {
  suite: SuiteType;
  customNames: string[];
  tagPool: string[];
  pattern: PatternKind;
  /** Default mode reported to the events log. */
  flightMode: string;
  /** Mission radius / extent in metres for the pattern. */
  extentM: number;
  /** Default cruise altitude in metres AGL. */
  altitudeM: number;
  /** Default cruise speed in m/s. */
  speedMs: number;
  /** Markdown notes templates (one will be picked per flight). */
  notes: string[];
}

export const SCENARIOS: Record<SuiteType, Scenario> = {
  sentry: {
    suite: "sentry",
    customNames: [
      "Perimeter sweep — North fence",
      "Night patrol — Sector 3",
      "Gate watch — Main entry",
      "Tower handoff loop",
      "Boundary check after storm",
      "Routine compound orbit",
    ],
    tagPool: ["patrol", "perimeter", "night", "thermal", "shift-A", "shift-B"],
    pattern: "orbit",
    flightMode: "AUTO",
    extentM: 220,
    altitudeM: 60,
    speedMs: 8,
    notes: [
      "Clean perimeter run. No intrusions, fence line intact, lights operational on the east tower.",
      "Pilot noted a stray dog near the rear gate at the 6 minute mark. Forwarded to ground patrol, no further action needed.",
      "Wind picked up halfway through. Held altitude well, completed all waypoints, RTL on schedule.",
    ],
  },
  survey: {
    suite: "survey",
    customNames: [
      "Cadastral survey — Plot 47",
      "Roof inspection grid — Block C",
      "Gravel pit volume scan",
      "Highway corridor overlap",
      "Pre-monsoon site capture",
      "Quarterly stockpile sweep",
    ],
    tagPool: ["mapping", "rtk", "ortho", "photogrammetry", "client-A", "client-B"],
    pattern: "grid",
    flightMode: "AUTO",
    extentM: 180,
    altitudeM: 80,
    speedMs: 7,
    notes: [
      "Captured 412 frames at 80% front overlap. RTK fix held throughout. Dataset queued for WebODM processing.",
      "Slight haze reduced contrast on the east edge but coverage is complete. Re-fly not needed.",
      "Wind from the southwest pushed the lawnmower lines off by half a metre. Still inside spec, exported for processing.",
    ],
  },
  sar: {
    suite: "sar",
    customNames: [
      "Hiker search — Ridge trail",
      "River bank sweep",
      "Lost child callout",
      "Vehicle locate — North forest",
      "Night search with thermal",
      "Expanding box around last known point",
    ],
    tagPool: ["sar", "thermal", "callout", "night", "team-bravo"],
    pattern: "expanding_box",
    flightMode: "GUIDED",
    extentM: 320,
    altitudeM: 70,
    speedMs: 9,
    notes: [
      "Subject located on the second pass. Hovered overhead and held position until ground team arrived.",
      "No subject found in this sector. Pattern completed cleanly. Moving search box 500 m east on next sortie.",
      "Thermal contact at 14 minutes turned out to be a warm rock. Marked and continued the box.",
    ],
  },
  agriculture: {
    suite: "agriculture",
    customNames: [
      "Spray pass — North paddock",
      "NDVI scan — Field 12",
      "Pest hot-spot follow-up",
      "Pre-harvest scout",
      "Irrigation health check",
      "Weed targeting — Plot 7",
    ],
    tagPool: ["spray", "ndvi", "scout", "field-12", "field-7", "morning"],
    pattern: "spray_rows",
    flightMode: "AUTO",
    extentM: 160,
    altitudeM: 12,
    speedMs: 5,
    notes: [
      "Sprayed all 14 rows. Tank ran low on the last pass, returned and resumed with a fresh load.",
      "NDVI map shows stress on the southern third of the plot. Sent to the agronomist with the export.",
      "Found two pest hotspots near the irrigation line. Marked for follow-up with targeted spray tomorrow.",
    ],
  },
  cargo: {
    suite: "cargo",
    customNames: [
      "Medicine drop — Village PHC",
      "Spare part to compressor station",
      "Sample pickup — North site",
      "Fuel delivery to ridge camp",
      "Document hop — branch office",
      "Tool run between rigs",
    ],
    tagPool: ["delivery", "phc", "supplies", "vip", "urgent"],
    pattern: "waypoint_hop",
    flightMode: "AUTO",
    extentM: 1200,
    altitudeM: 110,
    speedMs: 14,
    notes: [
      "Delivered 1.8 kg payload to the village PHC. Receiver confirmed handoff over radio. Returned with empty bay.",
      "Slight headwind on the outbound leg added two minutes to the trip. Battery margin still healthy.",
      "Drop went clean, winch behaved well, no swing on release. Bay sensors all green on return.",
    ],
  },
  inspection: {
    suite: "inspection",
    customNames: [
      "Facade scan — Tower 2",
      "Power line span check",
      "Solar farm thermal sweep",
      "Bridge underdeck inspection",
      "Wind turbine blade orbit",
      "Cooling tower visual",
    ],
    tagPool: ["inspection", "thermal", "asset", "tower", "client-utility"],
    pattern: "facade_orbit",
    flightMode: "GUIDED",
    extentM: 60,
    altitudeM: 45,
    speedMs: 4,
    notes: [
      "Completed three orbit passes at 30, 45, and 60 metres. Visual and thermal both clean. Frames synced to the asset folder.",
      "Picked up a hotspot on the northeast face at the 45 m pass. Flagged for the maintenance crew. Otherwise nominal.",
      "Wind near the tower made the top pass jittery. Reduced speed and re-flew the affected section. Final dataset is usable.",
    ],
  },
};

// ── Path generators ─────────────────────────────────────────

const EARTH_R = 6378137;
const M_PER_DEG_LAT = 111_320;
function mPerDegLon(lat: number) {
  return Math.cos((lat * Math.PI) / 180) * 111_320;
}

function offset(
  lat: number,
  lon: number,
  dx: number,
  dy: number,
): [number, number] {
  return [lat + dy / M_PER_DEG_LAT, lon + dx / mPerDegLon(lat)];
}

/**
 * Produce a downsampled flight path for a given pattern, anchored at
 * (centerLat, centerLon). Returns 60–200 points. First point is the
 * takeoff, last point is the landing — both placed near the centre.
 */
export function generatePath(
  pattern: PatternKind,
  centerLat: number,
  centerLon: number,
  extentM: number,
  rand: Prng,
): [number, number][] {
  switch (pattern) {
    case "orbit":
      return orbitPath(centerLat, centerLon, extentM, rand);
    case "grid":
      return gridPath(centerLat, centerLon, extentM, rand);
    case "expanding_box":
      return expandingBoxPath(centerLat, centerLon, extentM, rand);
    case "spray_rows":
      return sprayRowsPath(centerLat, centerLon, extentM, rand);
    case "waypoint_hop":
      return waypointHopPath(centerLat, centerLon, extentM, rand);
    case "facade_orbit":
      return facadeOrbitPath(centerLat, centerLon, extentM, rand);
  }
}

function orbitPath(
  lat: number,
  lon: number,
  radius: number,
  rand: Prng,
): [number, number][] {
  const points: [number, number][] = [offset(lat, lon, 0, 0)];
  const turns = 1 + Math.floor(rand() * 2); // 1–2 laps
  const steps = 80 * turns;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2 * turns;
    const wobble = 1 + (rand() - 0.5) * 0.06;
    const r = radius * wobble;
    points.push(offset(lat, lon, Math.cos(angle) * r, Math.sin(angle) * r));
  }
  points.push(offset(lat, lon, 0, 0));
  return points;
}

function gridPath(
  lat: number,
  lon: number,
  extent: number,
  rand: Prng,
): [number, number][] {
  const rows = 6 + Math.floor(rand() * 3);
  const half = extent;
  const spacing = (half * 2) / rows;
  const points: [number, number][] = [offset(lat, lon, -half, -half)];
  for (let r = 0; r <= rows; r++) {
    const y = -half + r * spacing;
    const xStart = r % 2 === 0 ? -half : half;
    const xEnd = r % 2 === 0 ? half : -half;
    const segments = 14;
    for (let s = 0; s <= segments; s++) {
      const x = xStart + (xEnd - xStart) * (s / segments);
      points.push(offset(lat, lon, x, y));
    }
  }
  points.push(offset(lat, lon, 0, 0));
  return points;
}

function expandingBoxPath(
  lat: number,
  lon: number,
  step: number,
  _rand: Prng,
): [number, number][] {
  const points: [number, number][] = [offset(lat, lon, 0, 0)];
  let x = 0;
  let y = 0;
  let leg = step / 4;
  // 4 legs per loop, growing each loop. 4 loops total.
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (let loop = 0; loop < 4; loop++) {
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = dirs[d];
      const segments = 8;
      for (let s = 1; s <= segments; s++) {
        const nx = x + dx * leg * (s / segments);
        const ny = y + dy * leg * (s / segments);
        points.push(offset(lat, lon, nx, ny));
      }
      x += dx * leg;
      y += dy * leg;
      if (d === 1 || d === 3) leg += step / 4;
    }
  }
  points.push(offset(lat, lon, 0, 0));
  return points;
}

function sprayRowsPath(
  lat: number,
  lon: number,
  extent: number,
  rand: Prng,
): [number, number][] {
  const rows = 10 + Math.floor(rand() * 5);
  const half = extent;
  const spacing = (half * 2) / rows;
  const points: [number, number][] = [offset(lat, lon, -half, -half - 10)];
  for (let r = 0; r <= rows; r++) {
    const y = -half + r * spacing;
    const xStart = r % 2 === 0 ? -half : half;
    const xEnd = r % 2 === 0 ? half : -half;
    const segments = 18;
    for (let s = 0; s <= segments; s++) {
      const x = xStart + (xEnd - xStart) * (s / segments);
      points.push(offset(lat, lon, x, y));
    }
  }
  points.push(offset(lat, lon, 0, 0));
  return points;
}

function waypointHopPath(
  lat: number,
  lon: number,
  legM: number,
  rand: Prng,
): [number, number][] {
  const legs = 4 + Math.floor(rand() * 3);
  const points: [number, number][] = [offset(lat, lon, 0, 0)];
  let x = 0;
  let y = 0;
  for (let l = 0; l < legs; l++) {
    const angle = rand() * Math.PI * 2;
    const dist = legM * (0.6 + rand() * 0.6);
    const tx = x + Math.cos(angle) * dist;
    const ty = y + Math.sin(angle) * dist;
    const segments = 14;
    for (let s = 1; s <= segments; s++) {
      const f = s / segments;
      points.push(offset(lat, lon, x + (tx - x) * f, y + (ty - y) * f));
    }
    x = tx;
    y = ty;
  }
  // Return-to-home
  const rtSegments = 16;
  for (let s = 1; s <= rtSegments; s++) {
    const f = s / rtSegments;
    points.push(offset(lat, lon, x * (1 - f), y * (1 - f)));
  }
  return points;
}

function facadeOrbitPath(
  lat: number,
  lon: number,
  radius: number,
  rand: Prng,
): [number, number][] {
  const points: [number, number][] = [offset(lat, lon, 0, 0)];
  const passes = 3;
  for (let p = 0; p < passes; p++) {
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2 + p * 0.1;
      const r = radius * (1 + p * 0.05);
      const wobble = 1 + (rand() - 0.5) * 0.04;
      points.push(
        offset(lat, lon, Math.cos(angle) * r * wobble, Math.sin(angle) * r * wobble),
      );
    }
  }
  points.push(offset(lat, lon, 0, 0));
  return points;
}

// ── Path metrics ────────────────────────────────────────────

export function pathDistanceM(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [lat1, lon1] = path[i - 1];
    const [lat2, lon2] = path[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    total += 2 * EARTH_R * Math.asin(Math.sqrt(a));
  }
  return total;
}

// ── Events generator ────────────────────────────────────────

export function generateEvents(
  scenario: Scenario,
  durationS: number,
  waypointCount: number,
  status: "completed" | "aborted" | "emergency",
  rand: Prng,
): FlightEvent[] {
  const events: FlightEvent[] = [];
  const dur = durationS * 1000;
  events.push({ t: 0, type: "armed", severity: "info", label: "Armed" });
  events.push({ t: 2_000, type: "takeoff", severity: "info", label: "Takeoff" });
  events.push({
    t: 8_000,
    type: "mode_change",
    severity: "info",
    label: `Mode → ${scenario.flightMode}`,
    data: { mode: scenario.flightMode },
  });
  events.push({
    t: 12_000,
    type: "mission_start",
    severity: "info",
    label: "Mission started",
  });

  // Spread waypoint reaches across the cruise window.
  const cruiseStart = 15_000;
  const cruiseEnd = dur - 25_000;
  const wpCount = Math.min(waypointCount, 20);
  for (let i = 0; i < wpCount; i++) {
    const t = cruiseStart + ((cruiseEnd - cruiseStart) * (i + 1)) / (wpCount + 1);
    events.push({
      t: Math.round(t),
      type: "waypoint_reached",
      severity: "info",
      label: `Waypoint ${i + 1} reached`,
      data: { index: i + 1 },
    });
  }

  // Inject one warning ~15% of the time on completed flights.
  if (status === "completed" && rand() < 0.15) {
    const t = Math.round(cruiseStart + rand() * (cruiseEnd - cruiseStart));
    const choices = [
      { type: "battery_low_warn", label: "Battery 25% — RTL margin OK" },
      { type: "gps_glitch", label: "GPS glitch (1.2 s)" },
      { type: "wind_gust", label: "Wind gust 9 m/s" },
      { type: "vibration_warn", label: "Vibration X spike" },
    ];
    const w = pick(rand, choices);
    events.push({ t, type: w.type, severity: "warning", label: w.label });
  }

  if (status === "aborted") {
    const t = Math.round(cruiseStart + rand() * (cruiseEnd - cruiseStart));
    events.push({
      t,
      type: "pilot_abort",
      severity: "warning",
      label: "Mission aborted by pilot",
    });
  }

  if (status === "emergency") {
    const t = Math.round(cruiseStart + rand() * (cruiseEnd - cruiseStart));
    events.push({
      t,
      type: "failsafe_battery",
      severity: "error",
      label: "Failsafe — battery critical",
    });
    events.push({
      t: t + 500,
      type: "mode_change",
      severity: "warning",
      label: "Mode → RTL",
      data: { mode: "RTL" },
    });
  } else {
    events.push({
      t: dur - 22_000,
      type: "mission_complete",
      severity: "info",
      label: "Mission complete",
    });
    events.push({
      t: dur - 18_000,
      type: "mode_change",
      severity: "info",
      label: "Mode → RTL",
      data: { mode: "RTL" },
    });
  }

  events.push({
    t: dur - 6_000,
    type: "landing",
    severity: "info",
    label: "Landing",
  });
  events.push({
    t: dur - 1_000,
    type: "disarmed",
    severity: "info",
    label: "Disarmed",
  });

  return events.sort((a, b) => a.t - b.t);
}

// ── Flags + health ──────────────────────────────────────────

export function generateFlags(
  status: "completed" | "aborted" | "emergency",
  rand: Prng,
): FlightFlag[] {
  if (status === "completed" && rand() > 0.08) return [];
  if (status === "completed") {
    return [
      {
        type: "vibration_high",
        severity: "warning",
        message: "Vibration X exceeded 25 m/s² for 4 seconds.",
        suggestion: "Inspect motor mounts and prop balance before next flight.",
      },
    ];
  }
  if (status === "aborted") {
    return [
      {
        type: "manual_abort",
        severity: "warning",
        message: "Pilot aborted the mission mid-flight.",
      },
    ];
  }
  return [
    {
      type: "battery_failsafe",
      severity: "error",
      message: "Battery dropped below the failsafe threshold.",
      suggestion: "Replace cells or reduce mission duration.",
    },
  ];
}

export function generateHealth(rand: Prng): HealthSummary {
  return {
    avgSatellites: 12 + Math.round(rand() * 6),
    avgHdop: Math.round((0.6 + rand() * 0.5) * 100) / 100,
    maxVibrationRms: Math.round((6 + rand() * 8) * 10) / 10,
    batteryHealthPct: Math.round((92 + rand() * 7) * 10) / 10,
  };
}

// ── Telemetry frame generator ───────────────────────────────

export interface FrameGenInput {
  durationS: number;
  path: [number, number][];
  maxAltM: number;
  cruiseSpeedMs: number;
  batteryStartV: number;
  batteryEndV: number;
}

/**
 * Build synthetic telemetry frames for one flight. Channels emitted match
 * what `series-builder.ts` consumes (attitude, globalPosition, vfr,
 * battery, gps, vibration).
 */
export function generateTelemetryFrames(
  input: FrameGenInput,
  rand: Prng,
): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  const dur = input.durationS;
  const path = input.path;
  const pLen = path.length;

  const climbS = 6;
  const descentS = 8;
  const cruiseS = Math.max(1, dur - climbS - descentS);

  const altAt = (tS: number) => {
    if (tS < climbS) return (tS / climbS) * input.maxAltM;
    if (tS > dur - descentS) {
      return (Math.max(0, dur - tS) / descentS) * input.maxAltM;
    }
    // gentle saw on cruise
    const phase = (tS - climbS) / cruiseS;
    return input.maxAltM * (0.92 + 0.08 * Math.sin(phase * Math.PI * 4));
  };

  const posAt = (tS: number): [number, number] => {
    const cruiseFrac = Math.min(1, Math.max(0, (tS - climbS) / cruiseS));
    const idx = Math.min(pLen - 1, Math.floor(cruiseFrac * (pLen - 1)));
    return path[idx];
  };

  const speedAt = (tS: number) => {
    if (tS < climbS) return (tS / climbS) * input.cruiseSpeedMs;
    if (tS > dur - descentS) return (Math.max(0, dur - tS) / descentS) * input.cruiseSpeedMs;
    return input.cruiseSpeedMs * (0.9 + 0.1 * Math.sin(tS / 7));
  };

  // attitude @ 2 Hz
  for (let t = 0; t < dur; t += 0.5) {
    const yaw = ((t * 6 + rand() * 2) % 360) * (Math.PI / 180);
    const roll = Math.sin(t / 4) * 0.1;
    const pitch = Math.cos(t / 5) * 0.08;
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "attitude",
      data: { roll, pitch, yaw },
    });
  }

  // globalPosition @ 1 Hz
  for (let t = 0; t < dur; t += 1) {
    const [lat, lon] = posAt(t);
    const alt = altAt(t);
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "globalPosition",
      data: {
        lat,
        lon,
        alt,
        relativeAlt: alt,
        groundSpeed: speedAt(t),
      },
    });
  }

  // vfr @ 1 Hz (separate channel that ChartsTab also consumes)
  for (let t = 0; t < dur; t += 1) {
    const gs = speedAt(t);
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "vfr",
      data: {
        groundspeed: gs,
        airspeed: gs * 1.05,
        alt: altAt(t),
      },
    });
  }

  // battery @ 0.5 Hz monotonic decay
  for (let t = 0; t < dur; t += 2) {
    const f = t / dur;
    const v = input.batteryStartV - (input.batteryStartV - input.batteryEndV) * f;
    const remaining = Math.round((1 - f) * 100);
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "battery",
      data: { voltage: v, remaining },
    });
  }

  // gps @ 0.5 Hz
  for (let t = 0; t < dur; t += 2) {
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "gps",
      data: {
        satellites: 14 + Math.round(rand() * 3),
        hdop: 0.7 + rand() * 0.3,
      },
    });
  }

  // vibration @ 0.5 Hz
  for (let t = 0; t < dur; t += 2) {
    frames.push({
      offsetMs: Math.round(t * 1000),
      channel: "vibration",
      data: {
        vibrationX: 8 + rand() * 4,
        vibrationY: 8 + rand() * 4,
        vibrationZ: 10 + rand() * 4,
      },
    });
  }

  frames.sort((a, b) => a.offsetMs - b.offsetMs);
  return frames;
}

// ── Helpers exposed for the seeder ──────────────────────────

export { randInt, pick };
