/**
 * @module mission/altitude-frame
 * @description Single source of truth for what a waypoint altitude MEANS.
 *
 * FLIGHT-SAFETY-CRITICAL. The planner's three altitude frames map 1:1 onto the
 * MAV_FRAME values the flight controller acts on, and each one names a
 * DIFFERENT vertical datum:
 *
 * | model frame | MAV_FRAME                       | num | datum                     |
 * |-------------|---------------------------------|-----|---------------------------|
 * | `absolute`  | `MAV_FRAME_GLOBAL`              | 0   | mean sea level (AMSL)     |
 * | `relative`  | `MAV_FRAME_GLOBAL_RELATIVE_ALT` | 3   | the HOME point            |
 * | `terrain`   | `MAV_FRAME_GLOBAL_TERRAIN_ALT`  | 10  | the ground below the point |
 *
 * The defect this module exists to kill: `relative` was repeatedly treated as
 * "above ground level". It is not — it is above HOME. Over terrain that rises
 * between home and a waypoint, a `relative` altitude that reads as a healthy
 * 50 m AGL is actually 50 m above the launch pad and can be BELOW the ridge in
 * front of it. Conflating the two makes an unsafe mission validate and render
 * as safe, which is exactly the failure mode a GCS must never have.
 *
 * Two datums resolve every frame, both in metres MSL:
 *  - `homeGroundElevation` — terrain elevation at the launch point.
 *  - the per-waypoint ground elevation (`Waypoint.groundElevation`, or an
 *    interpolated terrain sample supplied by the caller).
 *
 * Every function returns `null` — never a fabricated 0 — when the datum it
 * needs is unavailable, so a caller must decide explicitly what "elevation
 * unknown" means rather than silently validating against sea level.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame } from "@/lib/types/mission";

/** `MAV_FRAME_GLOBAL` — altitude is AMSL (mean sea level). */
export const MAV_FRAME_GLOBAL = 0;
/** `MAV_FRAME_GLOBAL_RELATIVE_ALT` — altitude is above the HOME point. */
export const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
/** `MAV_FRAME_GLOBAL_TERRAIN_ALT` — altitude is above the terrain below the point. */
export const MAV_FRAME_GLOBAL_TERRAIN_ALT = 10;

/** Mission default frame applied when a waypoint carries no explicit frame. */
export const DEFAULT_ALTITUDE_FRAME: AltitudeFrame = "relative";

/** Map an altitude reference frame to its MAV_FRAME number. */
export function frameToMav(frame: AltitudeFrame | undefined): number {
  switch (frame ?? DEFAULT_ALTITUDE_FRAME) {
    case "absolute":
      return MAV_FRAME_GLOBAL;
    case "terrain":
      return MAV_FRAME_GLOBAL_TERRAIN_ALT;
    case "relative":
    default:
      return MAV_FRAME_GLOBAL_RELATIVE_ALT;
  }
}

/** Map a MAV_FRAME number back to an altitude reference frame. */
export function mavToFrame(mav: number | undefined): AltitudeFrame {
  switch (mav) {
    case MAV_FRAME_GLOBAL:
      return "absolute";
    case MAV_FRAME_GLOBAL_TERRAIN_ALT:
      return "terrain";
    case MAV_FRAME_GLOBAL_RELATIVE_ALT:
    default:
      return "relative";
  }
}

/**
 * Which datum a frame's altitude is measured from. The arithmetic that turns a
 * frame-relative altitude into an absolute height is "datum + alt" for the two
 * offset frames and identity for `absolute`; the only thing that varies between
 * call sites is which vertical datum they work in (MSL for validation and
 * charting, ellipsoidal for Cesium). Sharing the frame -> datum DECISION is
 * what keeps those call sites from disagreeing, which is the bug class here.
 */
export type AltitudeDatumKind =
  /** The altitude is already an absolute height (AMSL). */
  | "absolute"
  /** The altitude is an offset above the home point. */
  | "home"
  /** The altitude is an offset above the ground below the waypoint. */
  | "waypointGround";

/** The datum a frame's altitude is measured from. */
export function altitudeDatumFor(frame: AltitudeFrame | undefined): AltitudeDatumKind {
  switch (frame ?? DEFAULT_ALTITUDE_FRAME) {
    case "absolute":
      return "absolute";
    case "terrain":
      return "waypointGround";
    case "relative":
    default:
      return "home";
  }
}

/** The minimum a waypoint must carry for its altitude to be interpreted. */
export interface FrameAwareWaypoint {
  alt: number;
  frame?: AltitudeFrame;
  /** Terrain elevation (metres MSL) directly below this waypoint, when sampled. */
  groundElevation?: number;
}

/** The vertical datums a mission is resolved against. All metres MSL. */
export interface AltitudeDatums {
  /** Terrain elevation at the launch / home point. */
  homeGroundElevation?: number;
  /** Mission default frame for waypoints that carry none. Defaults to `relative`. */
  defaultFrame?: AltitudeFrame;
}

/** A waypoint altitude expressed in every datum that could be resolved. */
export interface ResolvedAltitude {
  /** The frame actually applied (the waypoint's own, else the mission default). */
  frame: AltitudeFrame;
  /** Absolute altitude in metres MSL, or `null` when the datum is unavailable. */
  msl: number | null;
  /** Height above the ground below the waypoint, or `null` when unresolvable. */
  agl: number | null;
  /** Height above the home point, or `null` when unresolvable. */
  aboveHome: number | null;
  /** True when the home ground elevation datum was available. */
  homeGroundKnown: boolean;
  /** True when a ground elevation sample below this waypoint was available. */
  waypointGroundKnown: boolean;
}

/** A finite datum, or undefined — a NaN datum is no datum. */
function finite(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/**
 * Resolve one waypoint's altitude into every datum, frame-correctly.
 *
 * @param wp             the waypoint (needs `alt`, optionally `frame` / `groundElevation`)
 * @param datums         home ground elevation (MSL) and the mission default frame
 * @param groundElevation optional ground sample (MSL) overriding `wp.groundElevation`,
 *                        for callers that interpolate terrain along the path
 */
export function resolveWaypointAltitude(
  wp: FrameAwareWaypoint,
  datums: AltitudeDatums = {},
  groundElevation?: number,
): ResolvedAltitude {
  const frame: AltitudeFrame = wp.frame ?? datums.defaultFrame ?? DEFAULT_ALTITUDE_FRAME;
  const homeGround = finite(datums.homeGroundElevation);
  const wpGround = finite(groundElevation ?? wp.groundElevation);
  const alt = Number.isFinite(wp.alt) ? wp.alt : NaN;

  let msl: number | null = null;
  if (Number.isFinite(alt)) {
    switch (altitudeDatumFor(frame)) {
      case "absolute":
        msl = alt;
        break;
      case "home":
        msl = homeGround !== undefined ? homeGround + alt : null;
        break;
      case "waypointGround":
        msl = wpGround !== undefined ? wpGround + alt : null;
        break;
    }
  }

  // AGL: for a terrain-frame waypoint the altitude IS the AGL, with no sample
  // needed. Otherwise it is the absolute height minus the ground below it.
  const agl =
    frame === "terrain" && Number.isFinite(alt)
      ? alt
      : msl !== null && wpGround !== undefined
        ? msl - wpGround
        : null;

  // Above-home: for a relative-frame waypoint the altitude IS the above-home
  // height. Otherwise it is the absolute height minus the home ground.
  const aboveHome =
    frame === "relative" && Number.isFinite(alt)
      ? alt
      : msl !== null && homeGround !== undefined
        ? msl - homeGround
        : null;

  return { frame, msl, agl, aboveHome, homeGroundKnown: homeGround !== undefined, waypointGroundKnown: wpGround !== undefined };
}

/**
 * Absolute altitude in metres MSL, or `null` when the datum needed to resolve
 * the waypoint's frame is unavailable. This is the function every surface that
 * compares a waypoint against terrain must go through.
 */
export function waypointAbsoluteAltitude(
  wp: FrameAwareWaypoint,
  datums: AltitudeDatums = {},
  groundElevation?: number,
): number | null {
  return resolveWaypointAltitude(wp, datums, groundElevation).msl;
}

/**
 * Height above the ground directly below the waypoint, or `null` when
 * unresolvable. This — not `wp.alt` — is the terrain clearance.
 */
export function waypointAltitudeAgl(
  wp: FrameAwareWaypoint,
  datums: AltitudeDatums = {},
  groundElevation?: number,
): number | null {
  return resolveWaypointAltitude(wp, datums, groundElevation).agl;
}

/**
 * Height above the home point, or `null` when unresolvable. This is the datum
 * an ArduPilot / PX4 fence ceiling and floor (`FENCE_ALT_MAX` / `FENCE_ALT_MIN`)
 * are expressed in, so it is what a fence band must be compared against.
 */
export function waypointAltitudeAboveHome(
  wp: FrameAwareWaypoint,
  datums: AltitudeDatums = {},
  groundElevation?: number,
): number | null {
  return resolveWaypointAltitude(wp, datums, groundElevation).aboveHome;
}

/**
 * Home ground elevation (metres MSL) inferred from a mission: the terrain
 * sample at the launch point, i.e. the first waypoint that carries one. Returns
 * `undefined` rather than 0 when no waypoint has an elevation sample.
 */
export function inferHomeGroundElevation(
  waypoints: readonly FrameAwareWaypoint[],
): number | undefined {
  for (const wp of waypoints) {
    const g = finite(wp.groundElevation);
    if (g !== undefined) return g;
  }
  return undefined;
}
