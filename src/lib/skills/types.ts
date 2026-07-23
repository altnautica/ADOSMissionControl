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

export interface ConfirmPolicy {
  title: string;
  message: string;
  confirmLabel: string;
  /** Maps 1:1 to ConfirmDialog `variant`. */
  variant: "primary" | "danger";
  /** Maps 1:1 to ConfirmDialog `typedPhrase`. */
  typedPhrase?: string;
  /**
   * Two-stage host with a countdown before the typedPhrase enables (Kill).
   * When set, the host runs the first confirm, then a second dialog whose
   * confirm stays disabled until `twoStageCountdownSeconds` elapses. Built-ins
   * set this only on `kill`. Omit for the standard single-dialog flow.
   */
  twoStageCountdownSeconds?: number;
  /**
   * When true, the confirm dialog escalates to the OVERRIDE typed-phrase when
   * the pre-flight checklist is incomplete (Arm/Takeoff), recording a safety
   * override exactly like the action-dialogs flow. The host resolves the live
   * checklist + override recording; the policy only opts in.
   */
  checklistAware?: boolean;
}

export interface SkillState {
  kind: "idle" | "active" | "cooldown" | "disabled";
  /** Required when kind === "disabled". A reason string the slot surfaces. */
  reason?: string;
  /** 0..1, optional (cooldown sweep / lock progress). */
  progress?: number;
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
  confirm: (policy: ConfirmPolicy) => Promise<boolean>;
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
