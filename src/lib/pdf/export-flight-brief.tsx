/**
 * @module pdf/export-flight-brief
 * @description One-click flight-brief PDF export for the current mission plan.
 * Computes plan statistics (distance + duration via `computeFlightPlan`, which
 * does not unroll DO_JUMP repeats, so the brief says so; the altitude range
 * only within one altitude frame), renders
 * the `FlightBriefDocument` to a Blob, and triggers a browser download. No
 * network I/O — the brief is built entirely from in-memory plan data, so there
 * is nothing to skip in demo mode. The heavy `@react-pdf/renderer` and document
 * modules are imported lazily inside `exportFlightBrief` so this module's pure
 * helpers (stats + slug + rows) load without pulling in the renderer.
 * @license GPL-3.0-only
 */

import { computeFlightPlan } from "@/lib/simulation-utils";
import type { AltitudeFrame, Waypoint } from "@/lib/types";
import type { BriefWaypointRow, BriefStats } from "./flight-brief-document";

/** Default cruise speed (m/s) — mirrors the planner store default. */
export const DEFAULT_CRUISE_SPEED_MPS = 5;

export interface FlightBriefInput {
  /** Ordered plan waypoints. */
  waypoints: Waypoint[];
  /** Mission name (used for the header and the file name). */
  name: string;
  /** Selected drone display name, when one is assigned. */
  droneName?: string;
  /** Cruise speed fallback for segments without a per-waypoint speed. */
  defaultSpeed?: number;
  /** The planner's default altitude frame, for waypoints without their own. */
  defaultFrame: AltitudeFrame;
}

/** Real plan statistics shown in the brief (no fabricated fields). */
export interface FlightBriefStats extends BriefStats {
  waypointCount: number;
}

/**
 * Derive the brief statistics from the plan. Distance and duration reuse the
 * simulation flight-plan computation, which flies each item once, so a mission
 * with a DO_JUMP is flagged rather than under-reported silently. The altitude
 * range is given only when every waypoint shares one frame. An empty plan
 * yields honest zeros.
 */
export function computeBriefStats(
  waypoints: Waypoint[],
  defaultFrame: AltitudeFrame,
  defaultSpeed: number = DEFAULT_CRUISE_SPEED_MPS,
): FlightBriefStats {
  const plan = computeFlightPlan(waypoints, defaultSpeed);
  const alts = waypoints.map((w) => w.alt);
  const frames = new Set(waypoints.map((w) => w.frame ?? defaultFrame));
  return {
    waypointCount: waypoints.length,
    distanceM: plan.totalDistance,
    durationS: plan.totalDuration,
    altMin: alts.length > 0 ? Math.min(...alts) : 0,
    altMax: alts.length > 0 ? Math.max(...alts) : 0,
    altFrame:
      frames.size === 0 ? null : frames.size === 1 ? [...frames][0] : "mixed",
    excludesJumpRepeats: waypoints.some((w) => w.command === "DO_JUMP"),
  };
}

/**
 * Turn a mission name into a filesystem-safe slug for the `.pdf` file name.
 * Lower-cased, non-alphanumeric runs collapsed to single hyphens, edges
 * trimmed, capped, and never empty.
 */
export function slugifyMissionName(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "flight-brief";
}

/** Build the display-ready waypoint rows for the document table. */
export function buildBriefRows(
  waypoints: Waypoint[],
  defaultFrame: AltitudeFrame,
): BriefWaypointRow[] {
  return waypoints.map((wp, i) => ({
    seq: i + 1,
    lat: wp.lat,
    lon: wp.lon,
    alt: wp.alt,
    frame: wp.frame ?? defaultFrame,
    command: wp.command ?? "WAYPOINT",
  }));
}

/** Trigger a browser download of a generated Blob, then revoke the URL. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Render the current mission plan to a PDF flight brief and download it. Safe to
 * call with an empty plan (produces an honest brief with zeroed stats), though
 * callers typically gate this on `waypoints.length > 0`.
 */
export async function exportFlightBrief(input: FlightBriefInput): Promise<void> {
  const {
    waypoints,
    name,
    droneName,
    defaultSpeed = DEFAULT_CRUISE_SPEED_MPS,
    defaultFrame,
  } = input;

  const stats = computeBriefStats(waypoints, defaultFrame, defaultSpeed);
  const rows = buildBriefRows(waypoints, defaultFrame);

  const [{ pdf }, { FlightBriefDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./flight-brief-document"),
  ]);

  const blob = await pdf(
    <FlightBriefDocument
      name={name?.trim() || "Untitled mission"}
      droneName={droneName?.trim() || undefined}
      generatedAt={Date.now()}
      waypoints={rows}
      stats={stats}
    />,
  ).toBlob();

  triggerDownload(blob, `${slugifyMissionName(name)}.pdf`);
}
