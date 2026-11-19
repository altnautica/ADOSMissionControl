/**
 * @module mock/mock-pilot-liftoff
 * @description The demo pilot's steady take-off: on `launch` or `takeoff`
 * the wire's `sequence` walks the supervised lift-off phases (spin up, find,
 * bracket, settle, commit, climb) on a timer, as the agent reports them, then ends.
 * The first flight probes the airframe's trim; later flights fly it
 * `learned` and the balance readiness row turns OK. `airframe_reset`
 * forgets the learned trim on the ground. A pinned `supervised_liftoff`
 * readiness row that is not OK (`DEMO_STANDARD_TAKEOFF_PIN`) flies the
 * standard take-off: no lift-off phases.
 * @license GPL-3.0-only
 */

import { DEMO_BALANCE_LEARNED, DEMO_BALANCE_LEARNING, type Json } from "./mock-pilot-wire";

/** The lift-off phases the demo walks, in order, with their status line and
 * how long each lasts (ms; `null`: until the climb ends). One table, so a
 * renamed phase set is a change here only. */
export const DEMO_LIFTOFF_PHASES: readonly { phase: string; text: string; ms: number | null }[] = [
  { phase: "spool", text: "Spinning up", ms: 800 },
  { phase: "find", text: "Lifting off", ms: 500 },
  { phase: "bracket", text: "Checking balance", ms: 800 },
  { phase: "settle", text: "Checking balance", ms: 300 },
  { phase: "commit", text: "Lifting off", ms: 300 },
  { phase: "climb", text: "Climbing to {alt} m", ms: null },
  { phase: "done", text: "Lifted off", ms: 500 },
];

/** Climb rate the demo lift-off's climb phase lasts by, m/s. */
const CLIMB_MPS = 2.5;

export class DemoLiftoff {
  private startedAt: number | null = null;
  private altM = 0;
  private trim: "probe" | "learned" = "probe";
  private learned = false;

  /** A new drone session: nothing learned yet. */
  reset(): void {
    this.startedAt = null;
    this.learned = false;
  }

  /** A launch or takeoff was accepted at `now`, climbing to `altM`; `seen`
   * is the operator's view (a standard take-off pin runs no lift-off). */
  begin(seen: Json, altM: number, now: number): void {
    const rows = (seen.readiness as Json[] | undefined) ?? [];
    if (rows.some((r) => r.id === "supervised_liftoff" && r.ok === false)) return;
    this.startedAt = now;
    this.altM = altM;
    this.trim = this.learned ? "learned" : "probe";
  }

  /** Forget the learned trim (`airframe_reset`). */
  forget(): void {
    this.learned = false;
  }

  /** The wire's `sequence` at `now`, or undefined while no lift-off runs
   * (the wire keeps its own). */
  sequence(now: number): Json | null | undefined {
    if (this.startedAt === null) return undefined;
    let t = now - this.startedAt;
    for (const p of DEMO_LIFTOFF_PHASES) {
      const ms = p.ms ?? (this.altM / CLIMB_MPS) * 1000;
      if (t < ms) {
        const liftoff = {
          phase: p.phase,
          text: p.text.replace("{alt}", String(this.altM)),
          detail: "",
          trim: this.trim,
          tilt_deg: 0,
        };
        return { step: "takeoff", after: "hold", error: null, liftoff };
      }
      t -= ms;
    }
    this.startedAt = null;
    this.learned = true;
    return null;
  }

  /** The airframe balance readiness row. */
  balanceRow(): Json {
    return this.learned ? DEMO_BALANCE_LEARNED : DEMO_BALANCE_LEARNING;
  }
}
