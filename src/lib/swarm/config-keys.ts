/**
 * @module lib/swarm/config-keys
 * @description The closed value sets and unit conventions behind the agent's
 * `swarm.*` config keys. The per-node Swarm settings page and the fleet-wide
 * config fan-out both read from here, so a formation the operator can pick on
 * one node is exactly the set they can push across a selection — and exactly
 * the set the agent's Pydantic model accepts.
 *
 * Gains are stored as INTEGER PERCENTAGES of the float weight the runtime
 * uses (`cohesion = 40` means 0.40). The config field primitives carry no
 * float input, so keeping the wire value an integer means one bounds-checking
 * path on both sides instead of a second parser that only the swarm page uses.
 * @license GPL-3.0-only
 */

/** The built-in formation generators, in menu order. Anything outside this
 * set is rejected by the agent's config model, so the UI offers exactly it. */
export const SWARM_FORMATIONS = [
  "line",
  "column",
  "wedge",
  "grid",
  "circle",
] as const;

export type SwarmFormation = (typeof SWARM_FORMATIONS)[number];

/**
 * The behaviour modes an operator can command, in escalating autonomy.
 *
 * Hard separation and operator-direct are precedence LEVELS the onboard
 * arbiter resolves into — a drone enters hard separation because a neighbour
 * got too close, never because someone selected it — so neither is a value
 * here. What the drone is actually doing is read off the beacon, not off this
 * key.
 */
export const SWARM_COMMAND_MODES = ["hold", "flocking", "formation"] as const;

export type SwarmCommandMode = (typeof SWARM_COMMAND_MODES)[number];

/** Every `swarm.*` dot-path the GCS reads or writes, named once. */
export const SWARM_CONFIG_KEYS = {
  enabled: "swarm.enabled",
  role: "swarm.role",
  mode: "swarm.mode",
  formation: "swarm.default_formation",
  spacing: "swarm.default_spacing",
  flockCohesion: "swarm.flock.cohesion",
  flockAlignment: "swarm.flock.alignment",
  flockSeparationGain: "swarm.flock.separation_gain",
  flockRadiusM: "swarm.flock.radius_m",
  flockNeighbors: "swarm.flock.neighbors",
  separationRadiusM: "swarm.separation.radius_m",
  separationHardM: "swarm.separation.hard_m",
  tasksEnabled: "swarm.tasks.enabled",
  tasksAssignedTaskId: "swarm.tasks.assigned_task_id",
  tasksBundlePosition: "swarm.tasks.bundle_position",
} as const;

/** Gain bounds, in stored percent. 200% (gain 2.0) is the ceiling any of the
 * three flocking weights is useful at; 0 disables that term outright. */
export const SWARM_GAIN_MIN_PERCENT = 0;
export const SWARM_GAIN_MAX_PERCENT = 200;

/**
 * The float weight the runtime applies for a stored integer percent, or null
 * when the config key carries no usable number — a surface reading a missing
 * key must say "not set", never render a fabricated 0.00.
 *
 * The `/ 100` is snapped back to two decimals because IEEE division leaves
 * 45 / 100 as 0.45000000000000001, which round-trips wrong and renders long.
 */
export function gainPercentToFloat(percent: unknown): number | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null;
  return Math.round(percent) / 100;
}

/** The stored integer percent for a float weight — the inverse, on the same
 * 1% grid the config field enforces, so a value that came out of
 * `gainPercentToFloat` goes back in unchanged. */
export function gainFloatToPercent(gain: number): number {
  return Math.round(gain * 100);
}
