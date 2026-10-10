/**
 * The shared Skill model. A Skill is a triggerable, bindable, stateful flight
 * capability with one shape for both built-in commands (Arm/RTH/Land/Mode) and
 * plugin-delivered behaviors (Follow-Me/Orbit). Every consumer — the registry,
 * the dispatcher, the Skill Bar, the action panel — imports from here.
 *
 * @module skills/types
 * @license GPL-3.0-only
 */

import type { CommandResult, ProtocolCapabilities } from "@/lib/protocol/types";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import type { FlightMode, ArmState } from "@/lib/types";
import type { SkillProtocol } from "./skill-protocol";

export type SkillCategory = "flight" | "behavior" | "camera" | "safety";
export type SkillSource = "builtin" | "plugin";
export type ArmRequirement = "any" | "armed" | "disarmed";

/**
 * Whether a node's firmware supports autonomous navigation (Return-to-Launch /
 * Land / Takeoff): known-supported, known-unsupported (e.g. an acro flight
 * controller), or not yet determinable. Drives whether those skills are offered
 * at all. Distinguishing "unsupported" from "unknown" is the whole point — a
 * blanket-false capability read on a node the GCS has not handshaken with must
 * not be mistaken for "the firmware cannot do it".
 */
export type AutonomousNavCapability = "supported" | "unsupported" | "unknown";

/**
 * The confirm gesture tier. `tap` opens no sheet (the press is the
 * confirmation); `hold` completes after a press-and-hold; `slide` needs a
 * slide-to-confirm on touch/pointer or a long hold on a key/gamepad button;
 * `guarded` is the kill tier: the first activation arms a guard and a hold
 * inside that window fires.
 */
export type ConfirmGesture = "tap" | "hold" | "slide" | "guarded";

/** Hold duration (ms) each tier asks for when the policy names none. */
export const CONFIRM_HOLD_DEFAULT_MS: Record<ConfirmGesture, number> = {
  tap: 0,
  hold: 800,
  slide: 1500,
  guarded: 1500,
};

/** How long the kill guard stays armed after the first activation (ms). */
export const GUARD_WINDOW_MS = 3000;

/** The take-off altitude stepper a confirm sheet carries. */
export interface ConfirmAltitude {
  defaultM: number;
  minM: number;
  maxM: number;
  stepM: number;
}

export interface ConfirmPolicy {
  title: string;
  message: string;
  confirmLabel: string;
  /** Visual weight of the sheet's confirm control. */
  variant: "primary" | "danger";
  /** The gesture the operator performs to confirm. */
  gesture: ConfirmGesture;
  /** Hold duration override (ms); defaults to {@link CONFIRM_HOLD_DEFAULT_MS}. */
  holdMs?: number;
  /**
   * When true and the pre-flight checklist is incomplete (Arm/Takeoff), the
   * sheet lists the failing items and keeps the gesture disabled until the
   * operator turns on an explicit "Override checklist" switch. The override is
   * recorded as a safety event.
   */
  checklistAware?: boolean;
  /** When set the sheet carries an altitude stepper whose value is sent. */
  altitude?: ConfirmAltitude;
  /**
   * The gamepad button whose press opened this request, set per request.
   * Holding it satisfies the gesture, so a pilot confirms without letting go.
   */
  gamepadButton?: number;
  /** Interpolation values for `title` and `message`, set per request. */
  values?: Record<string, string | number>;
}

/** What the operator chose on the sheet, beyond confirming it. */
export interface ConfirmChoice {
  altitudeM?: number;
}

/**
 * The confirm seam's answer: falsy = declined, `true` or a choice = confirmed.
 * A choice carries the values the operator set on the sheet.
 */
export type ConfirmResult = boolean | ConfirmChoice;

/** Effective hold duration for a policy. */
export function confirmHoldMs(policy: ConfirmPolicy): number {
  return policy.holdMs ?? CONFIRM_HOLD_DEFAULT_MS[policy.gesture];
}

export interface SkillState {
  kind: "idle" | "active" | "cooldown" | "disabled";
  /** Required when kind === "disabled". A reason string the slot surfaces. */
  reason?: string;
  /** 0..1, optional (a skill's own lock progress). */
  progress?: number;
  /**
   * The live cooldown window when kind === "cooldown": epoch ms it started and
   * its length. The slot animates the sweep from these in CSS, so the bar is
   * not recomputed per frame while a cooldown runs.
   */
  cooldown?: { startedAt: number; durationMs: number };
  /** <= ~4 chars overlay, optional (e.g. a locked target id). */
  badge?: string;
}

export interface SkillContext {
  droneId: string;
  /**
   * The command surface this context dispatches through. A live `DroneProtocol`
   * satisfies it directly; a node the GCS holds no connection to supplies a
   * command sink of the same nine methods. Null when the node has no reachable
   * command path at all, which every built-in reports as disabled-no-link.
   */
  protocol: SkillProtocol | null;
  armState: ArmState;
  flightMode: FlightMode;
  /**
   * Mode preset gating uses this — TRUE iff the connected firmware handler's
   * getAvailableModes() includes the target UnifiedFlightMode. Built by the
   * context builder from the selected drone's firmware handler. Empty array
   * when no FC handler is present.
   */
  availableModes: UnifiedFlightMode[];
  /** Previous flight mode, for pause/resume. */
  previousMode: FlightMode;
  supports: (cap: keyof ProtocolCapabilities) => boolean;
  /**
   * Whether this node's firmware supports autonomous navigation, gating the
   * visibility of RTL / Land / Takeoff. "supported" and "unknown" both keep
   * those skills — an unidentified firmware may well have them, so hiding would
   * be a guess — while a firmware known to lack it ("unsupported") hides them.
   * Optional: a context built without any firmware signal omits it, which reads
   * as not-"unsupported" and so keeps the skills rather than a blanket-false
   * `supports` capability wrongly hiding them.
   */
  autonomousNav?: AutonomousNavCapability;
  /** Live pre-flight checklist readiness (every item pass|skipped). */
  checklistReady: boolean;
  /**
   * Open a ConfirmDialog and resolve true on confirm, false on cancel.
   * Routes through the skill-confirm host.
   */
  confirm: (policy: ConfirmPolicy) => Promise<ConfirmResult>;
  /** Best-effort UI feedback for rejected/dispatched skills. */
  notify: (
    message: string,
    status?: "success" | "warning" | "error" | "info",
  ) => void;
}

export interface SkillActivateArgs {
  /** Mode-preset skills pass their target here. */
  targetMode?: UnifiedFlightMode;
  /** Takeoff meters (default 10). */
  altitudeM?: number;
  /** The gamepad button that triggered this activation, when one did. */
  gamepadButton?: number;
  [key: string]: unknown;
}

/**
 * Optional charge budget for a one-shot skill. A skill with charges fires only
 * while `current > 0`, decrements on each one-shot activation, and recharges
 * one charge every `rechargeMs` up to `max`. Surfaced as the slot badge. The
 * dispatcher owns the live count out-of-band (per drone); the skill only
 * declares the shape. Built-ins leave this undefined (unlimited).
 */
export interface SkillCharges {
  current: number;
  max: number;
  rechargeMs: number;
}

export interface Skill {
  id: string;
  /** i18n key under the "skills" namespace (e.g. "arm.label"). */
  label: string;
  /** lucide-react icon name for built-ins. */
  icon: string;
  category: SkillCategory;
  source: SkillSource;
  pluginId?: string;
  toggle: boolean;
  confirm?: ConfirmPolicy;
  /**
   * The confirm policy for one activation, when it depends on the arguments
   * (a mode change confirms differently for a recovery mode than for AUTO).
   * Wins over `confirm`; returning undefined means no confirmation.
   */
  confirmFor?: (args?: SkillActivateArgs) => ConfirmPolicy | undefined;
  /**
   * Interpolation values for the confirm title/message, computed from the
   * activation args so the dialog names what will actually be commanded (the
   * take-off altitude, for example).
   */
  confirmValues?: (args?: SkillActivateArgs) => Record<string, string | number>;
  /**
   * False for a skill that carries no meaning without an argument — the
   * parameterised mode change is the only one today. Such a skill is dispatched
   * from its own control and is deliberately absent from every bar, drawer,
   * palette and key-binding surface, because there is nothing to bind: a slot
   * labelled "set mode" with no mode chosen would do nothing when pressed.
   * Defaults to true when omitted.
   */
  bindable?: boolean;
  /** Default "any" when omitted. */
  armRequirement?: ArmRequirement;
  /**
   * A real lockout window (ms) after a successful one-shot activation. While it
   * runs the slot shows a `cooldown` state with a 1->0 sweep. Absent = use only
   * the invisible debounce that swallows a stuttered double-press.
   */
  cooldownMs?: number;
  /**
   * Optional charge budget. Declares the starting/max charges and the recharge
   * cadence; the dispatcher tracks the live per-drone count. Absent = unlimited.
   */
  charges?: SkillCharges;
  /**
   * When present-but-ungated this built-in shows disabled-with-reason; when the
   * firmware fundamentally cannot do it, resolveForDrone filters it out. TRUE
   * on rth/land/takeoff/pause/resume (the autonomous-nav gate). Arm/Disarm/
   * Kill/mode-presets do NOT set this (always present).
   */
  requiresAutonomousNav?: boolean;
  /** Pure, no side effects. */
  getState: (ctx: SkillContext) => SkillState;
  /**
   * Run the skill. A skill that dispatches a protocol command returns the
   * command's own result so the dispatcher can act on the answer: a rejected
   * result is surfaced to the operator and spends neither a charge nor the
   * cooldown, because the vehicle did not do the work. A void return means the
   * activation carries no single command result (behaviors) and reads as
   * accepted.
   */
  activate: (
    ctx: SkillContext,
    args?: SkillActivateArgs,
  ) => Promise<CommandResult | void>;
  /** Required iff toggle; must be protocol-optional. */
  deactivate?: (ctx: SkillContext) => Promise<void>;
}

export type { SkillProtocol } from "./skill-protocol";
