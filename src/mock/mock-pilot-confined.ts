/**
 * @module mock/mock-pilot-confined
 * @description The demo pilot's confined-place profile. The class itself is
 * the pilot's (`place_class:open|confined` sets it, refused while armed); the
 * route check and the speed cap near the clearance limit are states the demo
 * vehicle does not fly, so a scenario pins them, as the agent sends them:
 *
 *   const d = window.__adosDemoPilot;
 *   d.pin(d.confinedPins("infeasible"));   // or "feasible", "unverified"
 *
 * `confinedPins` gives the confined class, the route check in that state over
 * a loaded six-waypoint mission and, unless the route is clear, the 0.5 m/s
 * `confined-near` speed cap. A confined launch into the mission is refused
 * `route_infeasible` while the route is too tight, and `route_unchecked`
 * while it leaves a waypoint unchecked, as the pilot refuses it; switching
 * to open drops the route check and the cap.
 * @license GPL-3.0-only
 */

import type { Json } from "./mock-pilot-wire";

export type DemoRouteCheckState = "feasible" | "unverified" | "infeasible";

/** The pilot's margin over a 0.377 m prop-tip radius, and the clearance
 *  required with a 2 cm pose sigma (margin + max(0.1, 3 sigma)). */
const MARGIN_M = 0.477;
const REQUIRED_M = 0.577;

/** The route check in `state`, as the pilot reports it. */
export function demoRouteCheck(state: DemoRouteCheckState): Json {
  const pinch =
    state === "infeasible"
      ? { from_seq: 3, to_seq: 4, ned: [41.25, -17.5, -2.0], clearance_m: 0.52, required_m: REQUIRED_M }
      : { from_seq: 2, to_seq: 3, ned: [20.0, -8.5, -2.0], clearance_m: 0.94, required_m: REQUIRED_M };
  return {
    state,
    required_m: REQUIRED_M,
    margin_m: MARGIN_M,
    sigma_m: state === "unverified" ? null : 0.02,
    pinch,
    unverified_legs: state === "feasible" ? [] : [5, 6],
  };
}

/** Pins for a confined flight with the route check in `state`. */
export function demoConfinedPins(state: DemoRouteCheckState): Json {
  return {
    place_class: "confined",
    mission: { state: "loaded", seq: 1, total: 6 },
    route_check: demoRouteCheck(state),
    ...(state === "feasible" ? {} : { speed_cap: { reason: "confined-near", v_h_mps: 0.5 } }),
  };
}

/** The pilot's answer to `place_class:<value>`: null when it takes it. */
export function placeClassRefusal(value: string | undefined, armed: boolean): string | null {
  if (value !== "open" && value !== "confined") return "bad_args";
  return armed ? "armed" : null;
}

/** A launch the confined pilot refuses, checked as the pilot checks it: only a
 *  launch into the mission, refused while its route check found the route too
 *  tight, or left a waypoint unchecked (no position, or a mission longer than
 *  the check holds). */
export function confinedLaunchRefusal(seen: Json, args: Json): string | null {
  const rc = seen.route_check;
  if (seen.place_class !== "confined" || args.after !== "mission") return null;
  if (typeof rc !== "object" || rc === null) return null;
  const check = rc as Json;
  if (check.state === "infeasible") return "route_infeasible";
  const unchecked = Array.isArray(check.unchecked) && check.unchecked.length > 0;
  return unchecked || check.truncated === true ? "route_unchecked" : null;
}
