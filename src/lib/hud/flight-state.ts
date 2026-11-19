// The flight-state chip: who flies the aircraft now, as one line of text and
// a colour, plus the secondary line (hold reason, avoidance state, control
// mode). The rules are the cockpit spec's `flight-state.json`, evaluated in
// order on facts drawn from the pilot kind; the first match wins. Pure: the
// chip component builds the facts and renders the result.

import flightStateJson from "../cockpit-spec/flight-state.json";
import tokensJson from "../cockpit-spec/tokens.json";
import type { PilotState } from "./cockpit-frames";
import { speedCapText } from "./pilot-fields";
import { speedCapLine } from "./route-check";
import { specText } from "./spec-text";
import { fmtEta, fmtSigned1 } from "./format";

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
const POSITION_UNVERIFIED_LABELS: Readonly<Record<string, string>> = flightStateJson.position_unverified_labels;
interface ChipTextPart {
  text_key: string;
  color: string;
}

const CHIP_SECONDARY = flightStateJson.secondary as {
  order: string[];
  fc_failsafe: { text: string; color: string };
  speed_cap: { text: string; color: string };
  mission_paused_line: { match: Record<string, string | number | boolean>; text: string; color: string };
  avoid_state: Record<string, { text: string; color: string } | null>;
  hold_reason: { text: string; color: string };
  control_mode: Record<string, string>;
  profile_limit: { text_key: string };
  clearance: { text_key: string; near_factor: number; near_color: string; inside_margin_color: string };
  input_age: ChipTextPart & { over_ms: number };
  h_speed: ChipTextPart & { owner: string };
  v_speed: ChipTextPart & { owner: string };
  command_limit: { owners: string[]; skip: string[]; suppress_while_blocked: string[]; color: string; colors: Record<string, string> };
};
const COMMAND_LIMIT_LABELS: Readonly<Record<string, string>> = flightStateJson.command_limit_labels;
const PROFILE_SHEET: { values: string[]; labels: string[] } = flightStateJson.mode_sheet.profile;

/** The `command.limits` code the chip shows: the first one the spec does not
 *  skip, while a skill, goto or the sticks fly; a code hidden while avoidance
 *  reports blocked (that part says it) or with no label is not shown. */
export function commandLimitCode(f: Pick<ChipFacts, "owner" | "commandLimits" | "avoidState">): string | null {
  const c = CHIP_SECONDARY.command_limit;
  if (!c.owners.includes(f.owner)) return null;
  const code = f.commandLimits.find((l) => !c.skip.includes(l));
  if (code === undefined || !(code in COMMAND_LIMIT_LABELS)) return null;
  if (f.avoidState === "blocked" && c.suppress_while_blocked.includes(code)) return null;
  return code;
}
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
  /** The pilot's `command.limits` codes, first bound first; empty with none. */
  commandLimits: string[];
  /** The pilot's position-unverified label key (its `detail` when the spec
   *  labels it, else its `reason`), or null while the position is trusted. */
  positionUnverified: string | null;
  /** Why the cap (`gnss-denied`, `confined-near`), or null with none. */
  speedCapReason: string | null;
  /** The horizontal limit the sticks fly at (m/s), or null without limits. */
  profileLimitMps: number | null;
  /** The vehicle's horizontal and vertical (+ up) speed in m/s, or null
   *  when the surface passes none. */
  hSpeedMps: number | null;
  vSpeedMps: number | null;
  /** Age of the stick frame the pilot flew last (ms), null while the
   *  sticks do not fly. */
  stickInputAgeMs: number | null;
  /** The nearest obstacle (m) and the margin the pilot keeps (m), or null. */
  minClearanceM: number | null;
  marginM: number | null;
  /** Age of the pilot state in ms. */
  ageMs: number;
}

export interface ChipLine {
  /** The spec part this line comes from (`secondary.order`), e.g.
   *  `clearance`, `input_age`, `h_speed`. */
  id: string;
  text: string;
  color: string;
}

/** The secondary parts a compact chip face keeps: what the sticks need while
 *  they fly from the screen. */
export const CHIP_COMPACT_PARTS: Readonly<Record<string, true>> = { clearance: true, input_age: true, h_speed: true, v_speed: true };

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
      case "position_unverified":
        if ((f.positionUnverified !== null) !== want) return false;
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
    profile_limit: f.profileLimitMps === null ? "" : specText(CHIP_SECONDARY.profile_limit.text_key, { v: speedCapText(f.profileLimitMps) }),
    position_unverified_label:
      f.positionUnverified === null
        ? ""
        : (POSITION_UNVERIFIED_LABELS[f.positionUnverified] ?? wordLabel(f.positionUnverified)),
  };
  return template.replace(/\{([a-z_]+)\}/g, (_, k: string) => values[k] ?? "").replace(/ · $/, "");
}

function colorOf(name: string): string {
  return STATE_COLORS[name] ?? STATE_COLORS.fc ?? "#909090";
}

/** The label key of a pilot's `position_unverified`: Navigation's detail when
 *  the spec labels it, else the pilot's reason. */
export function positionUnverifiedKey(p: PilotState["positionUnverified"]): string | null {
  if (!p) return null;
  return p.detail !== null && p.detail in POSITION_UNVERIFIED_LABELS ? p.detail : p.reason;
}

function holdReasonLabel(reason: string): string {
  return HOLD_REASON_LABELS[reason] ?? reason.replace(/[-_]/g, " ");
}

/** The secondary line, in the spec's order: FC failsafe, the obstacle
 *  clearance, a late stick input, the pilot's speed cap, the limit that cut
 *  the commanded speed, a mission the pilot holds paused, hold reason,
 *  avoidance state, control mode, then the
 *  horizontal and vertical speed while the sticks fly. */
export function chipSecondary(f: ChipFacts): ChipLine[] {
  const out: ChipLine[] = [];
  for (const part of CHIP_SECONDARY.order) {
    if (part === "fc_failsafe" && f.fcFailsafe) {
      out.push({ id: part, text: CHIP_SECONDARY.fc_failsafe.text, color: colorOf(CHIP_SECONDARY.fc_failsafe.color) });
    } else if (part === "clearance" && f.minClearanceM !== null && f.marginM !== null && f.marginM > 0) {
      const c = CHIP_SECONDARY.clearance;
      if (f.minClearanceM < c.near_factor * f.marginM) {
        out.push({
          id: part,
          text: specText(c.text_key, { m: (Math.round(f.minClearanceM * 10) / 10).toFixed(1) }),
          color: colorOf(f.minClearanceM <= f.marginM ? c.inside_margin_color : c.near_color),
        });
      }
    } else if (part === "input_age" && f.stickInputAgeMs !== null && f.stickInputAgeMs > CHIP_SECONDARY.input_age.over_ms) {
      const a = CHIP_SECONDARY.input_age;
      out.push({ id: part, text: specText(a.text_key, { ms: Math.round(f.stickInputAgeMs) }), color: colorOf(a.color) });
    } else if ((part === "h_speed" || part === "v_speed") && f.owner === CHIP_SECONDARY[part].owner) {
      const v = part === "h_speed" ? f.hSpeedMps : f.vSpeedMps;
      if (v !== null) out.push({ id: part, text: specText(CHIP_SECONDARY[part].text_key, { v: fmtSigned1(v) }), color: colorOf(CHIP_SECONDARY[part].color) });
    } else if (part === "speed_cap" && f.speedCapMps !== null) {
      // The reason's own spec line; the spec's default line for a reason it
      // does not name.
      const line = CHIP_SECONDARY.speed_cap;
      const own = f.speedCapReason === null ? null : speedCapLine({ reason: f.speedCapReason, vHMps: f.speedCapMps });
      out.push({ id: part, text: own ?? line.text.replace("{v}", speedCapText(f.speedCapMps)), color: colorOf(line.color) });
    } else if (part === "command_limit") {
      const code = commandLimitCode(f);
      if (code !== null) {
        const c = CHIP_SECONDARY.command_limit;
        out.push({ id: part, text: COMMAND_LIMIT_LABELS[code], color: colorOf(c.colors[code] ?? c.color) });
      }
    } else if (part === "mission_paused_line" && matches(CHIP_SECONDARY.mission_paused_line.match, f)) {
      const line = CHIP_SECONDARY.mission_paused_line;
      out.push({ id: part, text: fill(line.text, f), color: colorOf(line.color) });
    } else if (part === "hold_reason" && f.holdReason) {
      out.push({ id: part, text: holdReasonLabel(f.holdReason), color: colorOf(CHIP_SECONDARY.hold_reason.color) });
    } else if (part === "avoid_state" && f.avoidState) {
      const s = CHIP_SECONDARY.avoid_state[f.avoidState];
      if (s) out.push({ id: part, text: s.text, color: colorOf(s.color) });
    } else if (part === "control_mode" && f.controlMode) {
      out.push({ id: part, text: CHIP_SECONDARY.control_mode[f.controlMode] ?? wordLabel(f.controlMode), color: colorOf("fc") });
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
    speed?: { hMps: number | null; vMps: number | null } | null;
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
    positionUnverified: positionUnverifiedKey(p.positionUnverified),
    speedCapReason: p.speedCap?.reason ?? null,
    profileLimitMps: p.profileLimits?.vHMps ?? null,
    hSpeedMps: extra.speed?.hMps ?? null,
    vSpeedMps: extra.speed?.vMps ?? null,
    stickInputAgeMs: p.stick?.inputAgeMs ?? null,
    minClearanceM: p.minClearanceM,
    marginM: p.profileLimits && p.profileLimits.marginM > 0 ? p.profileLimits.marginM : (p.routeCheck?.marginM ?? null),
    commandLimits: p.commandLimits,
    ageMs,
  };
}

