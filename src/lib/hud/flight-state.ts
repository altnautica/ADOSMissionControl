// The flight-state chip: who flies the aircraft now, as one line of text and
// a colour, plus the secondary line (hold reason, avoidance state, control
// mode). The rules are the cockpit spec's `flight-state.json`, evaluated in
// order on facts drawn from the pilot kind; the first match wins. Pure: the
// chip component builds the facts and renders the result.

import flightStateJson from "../cockpit-spec/flight-state.json";
import tokensJson from "../cockpit-spec/tokens.json";
import type { PilotState } from "./cockpit-frames";
import { speedCapText } from "./pilot-fields";
import { specText } from "./spec-text";
import { fmtEta } from "./format";

export interface ChipRule {
  id: string;
  match: Record<string, string | number | boolean>;
  text: string;
  color: string;
  dim?: boolean;
  button: string | null;
  /** A different button while a further condition holds (the `pilot` chip
   *  offers Resume while it holds a paused mission). */
  button_if?: { match: Record<string, string | number | boolean>; button: string };
  suffix_if_landing_seq?: string;
}

const CHIP_RULES: readonly ChipRule[] = flightStateJson.rules as unknown as ChipRule[];
export const CHIP_STALE_AFTER_MS: number = flightStateJson.stale_after_ms;
const FC_MODE_CLASSES = flightStateJson.fc_mode_classes as unknown as Record<"rtl" | "land", Record<"copter" | "plane", number[]>>;
const HOLD_REASON_LABELS: Readonly<Record<string, string>> = flightStateJson.hold_reason_labels;
const CHIP_SECONDARY = flightStateJson.secondary as {
  order: string[];
  fc_failsafe: { text: string; color: string };
  speed_cap: { text: string; color: string };
  mission_paused_line: { match: Record<string, string | number | boolean>; text: string; color: string };
  avoid_state: Record<string, { text: string; color: string } | null>;
  hold_reason: { text: string; color: string };
  control_mode: Record<string, string>;
};
const PROFILE_SHEET: { values: string[]; labels: string[] } = flightStateJson.mode_sheet.profile;
const STATE_COLORS: Readonly<Record<string, string>> = tokensJson.state as Record<string, string>;

/** The values a rule can match on and fill its placeholders from. */
export interface ChipFacts {
  owner: string;
  ready: boolean;
  firstBlockMsg: string | null;
  setupNeeded: boolean;
  profile: string | null;
  skillLabel: string | null;
  modeDetail: string | null;
  distM: number | null;
  homeDistM: number | null;
  setupStep: string | null;
  missionState: string | null;
  seq: number | null;
  total: number | null;
  etaS: number | null;
  landingSeq: boolean;
  /** Ms since the mission state turned `complete`, or null. */
  completeAgeMs: number | null;
  vtolTransitioning: boolean;
  fcMode: number | null;
  fcModeName: string | null;
  /** `copter` or `plane` (Q modes count as plane). */
  family: "copter" | "plane";
  controlMode: string | null;
  holdReason: string | null;
  avoidState: string | null;
  /** The step of a running launch sequence (not `done`, no error), or null. */
  launchStep: string | null;
  /** The FC flies a failsafe RTL or land of its own. */
  fcFailsafe: boolean;
  /** The pilot's horizontal speed cap in m/s, or null with none. */
  speedCapMps: number | null;
  /** Age of the pilot state in ms. */
  ageMs: number;
}

export interface ChipLine {
  text: string;
  color: string;
}

export interface ChipView {
  ruleId: string;
  text: string;
  /** CSS colour from `tokens.json` `state.*`. */
  color: string;
  dim: boolean;
  /** `take_control`, `resume`, `abort` (a running launch) or `setup` (the
   *  "Set up aircraft" link). */
  button: "take_control" | "resume" | "abort" | "setup" | null;
  secondary: ChipLine[];
}

function fcModeClass(f: ChipFacts): string | null {
  if (f.fcMode === null) return null;
  for (const cls of ["rtl", "land"] as const) {
    if (FC_MODE_CLASSES[cls][f.family].includes(f.fcMode)) return cls;
  }
  return null;
}

function matches(match: ChipRule["match"], f: ChipFacts): boolean {
  for (const [key, want] of Object.entries(match)) {
    switch (key) {
      case "pilot_stale":
        if ((f.ageMs >= CHIP_STALE_AFTER_MS) !== want) return false;
        break;
      case "owner":
        if (f.owner !== want) return false;
        break;
      case "ready":
        if (f.ready !== want) return false;
        break;
      case "mission_state":
        if (f.missionState !== want) return false;
        break;
      case "complete_age_lt_ms":
        if (f.completeAgeMs === null || f.completeAgeMs >= Number(want)) return false;
        break;
      case "vtol_transitioning":
        if (f.vtolTransitioning !== want) return false;
        break;
      case "fc_mode_class":
        if (fcModeClass(f) !== want) return false;
        break;
      case "control_mode":
        if (f.controlMode !== want) return false;
        break;
      case "sequence_running":
        if ((f.launchStep !== null) !== want) return false;
        break;
      case "fc_failsafe":
        if (f.fcFailsafe !== want) return false;
        break;
      default:
        // A condition this cockpit does not know never matches.
        return false;
    }
  }
  return true;
}

/** A launch step's name as the spec words it (`flow.launch.step.*`, `after`
 *  as its label). The take-off step reads as its action
 *  (`chip.launch_step.takeoff`, "Climb"), so the chip never says
 *  "Taking off · Take off". */
function launchStepName(step: string | null): string {
  if (step === null) return "";
  const key = step === "after" ? "flow.launch.step.after_label" : step === "takeoff" ? "chip.launch_step.takeoff" : `flow.launch.step.${step}`;
  return specText(key);
}

/** A word that starts a chip part, with a capital first letter. */
function capitalFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A wire identifier (`autotune_roll`) as a sentence-case word ("Autotune roll"). */
function wordLabel(s: string): string {
  return capitalFirst(s.replace(/[-_]+/g, " ").toLowerCase());
}

/** A profile as the mode sheet labels it (`mode_sheet.profile`), "Normal"
 *  when none is reported; an unknown value reads with a capital first letter. */
function profileLabel(profile: string | null): string {
  const value = profile ?? "normal";
  const i = PROFILE_SHEET.values.indexOf(value);
  return i >= 0 ? PROFILE_SHEET.labels[i] : capitalFirst(value);
}

function num(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : String(Math.round(v));
}

function fill(template: string, f: ChipFacts): string {
  const values: Record<string, string> = {
    first_block_msg: f.firstBlockMsg ?? "",
    profile: profileLabel(f.profile),
    skill_label: capitalFirst(f.skillLabel ?? "Skill"),
    mode_detail: f.modeDetail ?? "Active",
    dist_m: num(f.distM),
    home_dist_m: num(f.homeDistM),
    setup_step: wordLabel(f.setupStep ?? ""),
    seq: num(f.seq),
    total: num(f.total),
    eta: fmtEta(f.etaS),
    fc_mode_name_upper: (f.fcModeName ?? "—").toUpperCase(),
    step: launchStepName(f.launchStep),
  };
  return template.replace(/\{([a-z_]+)\}/g, (_, k: string) => values[k] ?? "").replace(/ · $/, "");
}

function colorOf(name: string): string {
  return STATE_COLORS[name] ?? STATE_COLORS.fc ?? "#909090";
}

function holdReasonLabel(reason: string): string {
  return HOLD_REASON_LABELS[reason] ?? reason.replace(/[-_]/g, " ");
}

/** The secondary line, in the spec's order: FC failsafe, the pilot's speed
 *  cap, a mission the pilot holds paused, hold reason, avoidance state,
 *  control mode. */
export function chipSecondary(f: ChipFacts): ChipLine[] {
  const out: ChipLine[] = [];
  for (const part of CHIP_SECONDARY.order) {
    if (part === "fc_failsafe" && f.fcFailsafe) {
      out.push({ text: CHIP_SECONDARY.fc_failsafe.text, color: colorOf(CHIP_SECONDARY.fc_failsafe.color) });
    } else if (part === "speed_cap" && f.speedCapMps !== null) {
      const line = CHIP_SECONDARY.speed_cap;
      out.push({ text: line.text.replace("{v}", speedCapText(f.speedCapMps)), color: colorOf(line.color) });
    } else if (part === "mission_paused_line" && matches(CHIP_SECONDARY.mission_paused_line.match, f)) {
      const line = CHIP_SECONDARY.mission_paused_line;
      out.push({ text: fill(line.text, f), color: colorOf(line.color) });
    } else if (part === "hold_reason" && f.holdReason) {
      out.push({ text: holdReasonLabel(f.holdReason), color: colorOf(CHIP_SECONDARY.hold_reason.color) });
    } else if (part === "avoid_state" && f.avoidState) {
      const s = CHIP_SECONDARY.avoid_state[f.avoidState];
      if (s) out.push({ text: s.text, color: colorOf(s.color) });
    } else if (part === "control_mode" && f.controlMode) {
      out.push({ text: CHIP_SECONDARY.control_mode[f.controlMode] ?? wordLabel(f.controlMode), color: colorOf("fc") });
    }
  }
  return out;
}

function buttonOf(rule: ChipRule, f: ChipFacts): ChipView["button"] {
  const name = rule.button_if && matches(rule.button_if.match, f) ? rule.button_if.button : rule.button;
  switch (name) {
    case "take_control":
      return "take_control";
    case "resume":
      return "resume";
    case "abort":
      return "abort";
    case "setup_link_when_setup_needed":
      return f.setupNeeded ? "setup" : null;
    default:
      return null;
  }
}

/** The chip for a set of facts. */
export function flightStateChip(f: ChipFacts): ChipView {
  const rule = CHIP_RULES.find((r) => matches(r.match, f));
  if (!rule) {
    return {
      ruleId: "none",
      text: wordLabel(f.owner),
      color: colorOf("fc"),
      dim: false,
      button: null,
      secondary: chipSecondary(f),
    };
  }
  let text = fill(rule.text, f);
  if (rule.suffix_if_landing_seq && f.landingSeq) text += rule.suffix_if_landing_seq;
  return {
    ruleId: rule.id,
    text,
    color: colorOf(rule.color),
    dim: rule.dim === true,
    button: buttonOf(rule, f),
    secondary: rule.id === "link_stale" ? [] : chipSecondary(f),
  };
}

/** The first blocking readiness message, or null. */
export function firstBlock(p: PilotState | null): string | null {
  return p?.readiness.find((r) => !r.ok && r.severity === "block")?.msg ?? null;
}

/** Facts for the chip rules from one pilot state. Exported for tests. */
export function chipFacts(
  p: PilotState,
  ageMs: number,
  extra: {
    homeDistM: number | null;
    modeDetail: string | null;
    completeAgeMs: number | null;
    distM?: number | null;
    etaS?: number | null;
  },
): ChipFacts {
  const block = firstBlock(p);
  return {
    owner: p.owner,
    ready: block === null,
    firstBlockMsg: block,
    setupNeeded: p.readiness.some((r) => r.id === "setup_needed" && !r.ok),
    profile: p.profile,
    skillLabel: p.skill?.label ?? null,
    modeDetail: extra.modeDetail,
    distM: extra.distM ?? null,
    homeDistM: extra.homeDistM,
    setupStep: p.setupStep,
    missionState: p.mission?.state ?? null,
    seq: p.mission?.seq ?? null,
    total: p.mission?.total ?? null,
    etaS: extra.etaS ?? null,
    landingSeq: p.mission?.landingSeq ?? false,
    completeAgeMs: extra.completeAgeMs,
    vtolTransitioning: p.vtolTransitioning,
    fcMode: p.fcMode,
    fcModeName: p.fcModeName,
    family: p.vehicleClass === "fixedwing" || p.vehicleClass === "vtol" ? "plane" : "copter",
    controlMode: p.controlMode,
    holdReason: p.holdReason,
    avoidState: p.avoidState,
    launchStep: p.sequence && p.sequence.step !== "done" && p.sequence.error === null ? p.sequence.step : null,
    fcFailsafe: p.fcFailsafe,
    speedCapMps: p.speedCap?.vHMps ?? null,
    ageMs,
  };
}

