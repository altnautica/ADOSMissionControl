// The confined-place profile on a surface: the "Confined" chip, the route
// check report (its state line and where the tightest point is), the speed-cap
// line by its reason, and the launch sheet's place-class picker (labels, the
// explain line with the effective obstacle margin, the pilot action). Text from
// the spec's string table only. Pure: imports the spec through spec-text and
// the frame types.

import type { PilotState, PlaceClass, RouteCheck, SpeedCap } from "./cockpit-frames";
import { speedCapText } from "./pilot-fields";
import { hasSpecText, specText } from "./spec-text";

const NO_DATA = "—";

/** The pilot's default `pilot.obstacle_margin_m`. */
const DEFAULT_MARGIN_M = 1.5;
/** The margin floor in an open place. */
const OPEN_FLOOR_M = 0.5;
/** A confined place keeps the prop-tip radius plus this. */
const CONFINED_EXTRA_M = 0.1;

/** Clearances and required distances: two decimals ("0.58"). */
function metres2(v: number | null): string {
  return v === null ? NO_DATA : (Math.round(v * 100) / 100).toFixed(2);
}

/** A position component: one decimal, halves away from zero, never "-0.0". */
function metres1(v: number): string {
  const r = Math.sign(v) * Math.round(Math.abs(v) * 10);
  return r === 0 ? "0.0" : (r / 10).toFixed(1);
}

/** The "Confined" chip text while the place class is confined, else null. */
export function confinedChipText(p: Pick<PilotState, "placeClass">): string | null {
  return p.placeClass === "confined" ? specText("chip.confined") : null;
}

export interface RouteCheckReport {
  state: RouteCheck["state"];
  /** `ok` feasible, `warn` unverified (allowed, slowed), `critical` infeasible. */
  severity: "ok" | "warn" | "critical";
  title: string;
  /** The state line (`route_check.<state>`). */
  line: string;
  /** Where the tightest checked point is (`route_check.pinch_at`), or null
   *  while no sample was observed. */
  pinchAt: string | null;
}

const SEVERITY: Readonly<Record<RouteCheck["state"], RouteCheckReport["severity"]>> = {
  feasible: "ok",
  unverified: "warn",
  infeasible: "critical",
};

/** The route-check report, or null with no route check. The infeasible line
 *  names the pinch leg (`3→4`) with its clearance and the clearance it needs. */
export function routeCheckReport(rc: RouteCheck | null | undefined): RouteCheckReport | null {
  if (!rc) return null;
  const pinch = rc.pinch;
  const args =
    rc.state === "infeasible"
      ? {
          leg: pinch ? `${pinch.fromSeq}→${pinch.toSeq}` : NO_DATA,
          clearance_m: metres2(pinch?.clearanceM ?? null),
          required_m: metres2(pinch?.requiredM ?? rc.requiredM),
        }
      : { required_m: metres2(rc.requiredM) };
  // An unverified route that was not fully checked says why (a feed not in
  // step with the FC first), before the generic "not seen yet".
  const key =
    rc.state !== "unverified"
      ? rc.state
      : rc.stale
        ? "stale"
        : rc.unchecked.length > 0
          ? "unchecked"
          : rc.truncated
            ? "truncated"
            : "unverified";
  return {
    state: rc.state,
    severity: SEVERITY[rc.state],
    title: specText("route_check.title"),
    line: specText(`route_check.${key}`, { ...args, items: rc.unchecked.join(", ") }),
    pinchAt: pinch ? specText("route_check.pinch_at", { n: metres1(pinch.ned[0]), e: metres1(pinch.ned[1]), h: metres1(-pinch.ned[2]) }) : null,
  };
}

/** The speed-cap line by its reason (`pilot.speed_cap.<reason>`, dashes as
 *  underscores), or null with no cap or a reason the spec does not name. */
export function speedCapLine(cap: SpeedCap | null | undefined): string | null {
  if (!cap) return null;
  const key = `pilot.speed_cap.${cap.reason.replace(/-/g, "_")}`;
  return hasSpecText(key) ? specText(key, { v: speedCapText(cap.vHMps) }) : null;
}

/** The picker label of a place class. */
export function placeClassLabel(cls: PlaceClass): string {
  return specText(`flow.launch.place_class.${cls}`);
}

/** The pilot action that sets the place class. */
export function placeClassAction(cls: PlaceClass): string {
  return `place_class:${cls}`;
}

/** The obstacle margin the pilot flies with: in an open place the configured
 *  margin (`pilot.obstacle_margin_m`, null for the default), at least 0.5 m;
 *  in a confined one the prop-tip radius plus 0.1 m, whatever the configured
 *  open margin. Null for a confined place without a prop-tip radius, which
 *  the pilot refuses to launch. */
export function effectiveMarginM(cls: PlaceClass, configuredM: number | null, propTipRadiusM: number | null): number | null {
  if (cls === "open") return Math.max(configuredM ?? DEFAULT_MARGIN_M, OPEN_FLOOR_M);
  return propTipRadiusM === null ? null : propTipRadiusM + CONFINED_EXTRA_M;
}

/** The picker's explain line for a class with its effective margin (at most
 *  two decimals); an unknown margin reads "—". */
export function placeClassExplain(cls: PlaceClass, marginM: number | null): string {
  return specText(`flow.launch.place_class.explain_${cls}`, { margin_m: marginM === null ? NO_DATA : String(Math.round(marginM * 100) / 100) });
}
