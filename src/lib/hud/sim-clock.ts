// The pilot frame's `clock`: which clock the pilot runs on. A node following
// a simulator's clock (`source: "sim"`) shows a "SIM ×N" badge on every
// surface, so nobody reads an accelerated or unpaced run as real time.

/** The simulator's clock as the pilot follows it. */
export interface SimClock {
  /** The simulator's pacing speed; 0 while it runs as fast as it can; null
   *  when the frame did not say. */
  speed: number | null;
  /** Wall ms since the pilot's latest tick from the simulator, or null. */
  lagMs: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The frame's `clock` when the pilot runs on a simulator's clock; null on
 *  wall time and from an agent that sends none. */
export function parseSimClock(v: unknown): SimClock | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (c.source !== "sim") return null;
  return { speed: num(c.speed), lagMs: num(c.lag_ms) };
}

/** The badge: "SIM ×3", "SIM ×0.5", "SIM ×max" (as fast as it can), or
 *  "SIM" when the speed is unknown. */
export function simClockLabel(c: SimClock): string {
  if (c.speed === null) return "SIM";
  if (c.speed <= 0) return "SIM ×max";
  const n = Math.round(c.speed * 10) / 10;
  return `SIM ×${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}`;
}
