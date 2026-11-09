/**
 * @module cockpit/flight-state
 * @description The flight-state chip, evaluated from the shared spec
 * (`spec/flight-state.json`): its rules run in order on the drone's `pilot`
 * kind and mission state, first match wins. The chip text, colour, dim
 * flag, button and secondary line all come from the spec so every surface
 * shows the same words.
 * @license GPL-3.0-only
 */

import flightStateSpec from "./spec/flight-state.json";
import tokens from "./spec/tokens.json";
import type { ArFrame, PilotState } from "@/lib/cockpit/layers/cockpit-frames";
import type { MissionStatus } from "@/lib/mission/mission-state";

interface Rule {
  id: string;
  match: Record<string, string | boolean | number>;
  text: string;
  color: string;
  dim?: boolean;
  button: string | null;
  suffix_if_landing_seq?: string;
}

const RULES = flightStateSpec.rules as unknown as Rule[];
const STATE_COLORS = tokens.state as Record<string, string>;
const SECONDARY = flightStateSpec.secondary;
const HOLD_LABELS = flightStateSpec.hold_reason_labels as Record<string, string>;
const FC_CLASSES = flightStateSpec.fc_mode_classes as unknown as Record<
  "rtl" | "land",
  { copter: number[]; plane: number[] }
>;

/** Pilot state older than this shows the dimmed LINK chip. */
export const PILOT_CHIP_STALE_MS = flightStateSpec.stale_after_ms;

export interface ChipInput {
  pilot: PilotState | null;
  /** Milliseconds since the pilot kind last arrived (Infinity when never). */
  pilotAgeMs: number;
  mission: MissionStatus | null;
  /** When `complete` was first seen, for the 10 s MISSION COMPLETE chip. */
  completeSinceMs: number | null;
  /** True while EXTENDED_SYS_STATE reports a VTOL transition. */
  vtolTransitioning?: boolean;
  /** Current setup step label while owner is `tuning`. */
  setupStep?: string | null;
  /** Vehicle position in the pilot's local NED frame (LOCAL_POSITION_NED). */
  vehicleNe?: [number, number] | null;
  /** Vehicle distance from the FC's home position, metres. */
  homeDistM?: number | null;
  /** Seconds to the next mission waypoint (the `ar` frame's next gate), or null. */
  etaS?: number | null;
  now: number;
}

/** `m:ss` for the chip's `{eta}`, empty when unknown (the rule's trailing
 * separator is then dropped). */
export function formatEta(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** The next waypoint's ETA in seconds from an `ar` frame (any camera that
 * carries the next gate), or null. */
export function nextWaypointEtaS(frame: ArFrame | null | undefined): number | null {
  if (!frame) return null;
  for (const id in frame.cameras) {
    for (const it of frame.cameras[id].items) {
      if (it.t === "wp" && it.role === "next" && it.etaS !== null) return it.etaS;
    }
  }
  return null;
}

export interface ChipSecondary {
  text: string;
  color: string;
}

export interface ChipView {
  id: string;
  text: string;
  color: string;
  dim: boolean;
  /** `take_control`, `resume` or `setup_link_when_setup_needed`, else null. */
  button: string | null;
  secondary: ChipSecondary[];
}

function fcModeClass(p: PilotState): "rtl" | "land" | null {
  if (p.fcMode === null) return null;
  const family = p.vehicleClass === "fixedwing" || p.vehicleClass === "vtol" ? "plane" : "copter";
  for (const cls of ["rtl", "land"] as const) {
    if (FC_CLASSES[cls][family].includes(p.fcMode)) return cls;
  }
  return null;
}

function ready(p: PilotState): boolean {
  return !p.readiness.some((r) => !r.ok && r.severity === "block");
}

function facts(i: ChipInput): Record<string, string | boolean | number | null> {
  const p = i.pilot;
  return {
    pilot_stale: p === null || i.pilotAgeMs > PILOT_CHIP_STALE_MS,
    owner: p?.owner ?? null,
    ready: p ? ready(p) : false,
    mission_state: i.mission?.state ?? null,
    complete_age_lt_ms:
      i.completeSinceMs === null ? Number.POSITIVE_INFINITY : i.now - i.completeSinceMs,
    vtol_transitioning: i.vtolTransitioning === true,
    fc_mode_class: p ? fcModeClass(p) : null,
    control_mode: p?.controlMode ?? null,
  };
}

function matches(rule: Rule, f: ReturnType<typeof facts>): boolean {
  for (const [k, want] of Object.entries(rule.match)) {
    if (k === "complete_age_lt_ms") {
      if (!((f.complete_age_lt_ms as number) < (want as number))) return false;
    } else if (f[k] !== want) {
      return false;
    }
  }
  return true;
}

function placeholders(i: ChipInput): Record<string, string> {
  const p = i.pilot;
  const m = i.mission;
  // Distance still to fly: the vehicle against the goal, never the setpoint
  // (on a clear path the planner's setpoint is the goal itself).
  const goal = p?.goalNed;
  const at = i.vehicleNe;
  const dist = goal && at ? Math.round(Math.hypot(goal[0] - at[0], goal[1] - at[1])).toString() : "—";
  const homeDist = i.homeDistM != null && Number.isFinite(i.homeDistM) ? Math.round(i.homeDistM).toString() : "—";
  return {
    first_block_msg: p?.readiness.find((r) => !r.ok && r.severity === "block")?.msg ?? "",
    profile_upper: (p?.profile ?? "normal").toUpperCase(),
    skill_label_upper: (p?.skill?.label ?? p?.ownerLabel ?? "SKILL").toUpperCase(),
    mode_detail: (p?.ownerLabel ?? "").toUpperCase(),
    dist_m: dist,
    setup_step: (i.setupStep ?? "").toUpperCase(),
    seq: String(m?.seq ?? 0),
    total: String(m?.total ?? 0),
    eta: formatEta(i.etaS),
    fc_mode_name_upper: (p?.fcModeName ?? "").toUpperCase(),
    home_dist_m: homeDist,
  };
}

function fill(text: string, values: Record<string, string>): string {
  return text
    .replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "")
    .replace(/ · $/, "")
    .trim();
}

/** Evaluate the chip for one drone. */
export function evaluateChip(i: ChipInput): ChipView {
  const f = facts(i);
  const rule = RULES.find((r) => matches(r, f)) ?? RULES[0];
  const values = placeholders(i);
  let text = fill(rule.text, values);
  if (rule.suffix_if_landing_seq && i.mission?.landingSeq) text += rule.suffix_if_landing_seq;

  const secondary: ChipSecondary[] = [];
  const p = i.pilot;
  if (p && !f.pilot_stale) {
    if (p.holdReason) {
      secondary.push({
        text: HOLD_LABELS[p.holdReason] ?? p.holdReason.replace(/[-_]/g, " ").toUpperCase(),
        color: STATE_COLORS[SECONDARY.hold_reason.color] ?? STATE_COLORS.avoiding,
      });
    }
    const avoid = p.avoidState
      ? (SECONDARY.avoid_state as Record<string, { text: string; color: string } | null>)[p.avoidState]
      : null;
    if (avoid) secondary.push({ text: avoid.text, color: STATE_COLORS[avoid.color] });
    if (p.controlMode) {
      secondary.push({
        text: (SECONDARY.control_mode as Record<string, string>)[p.controlMode],
        color: STATE_COLORS.fc,
      });
    }
  }

  return {
    id: rule.id,
    text,
    color: STATE_COLORS[rule.color] ?? STATE_COLORS.fc,
    dim: rule.dim === true,
    button: rule.button,
    secondary,
  };
}
