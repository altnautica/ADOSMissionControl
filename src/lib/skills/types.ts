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
import type { ConfirmPolicy, ConfirmResult } from "./confirm-policy";
import type { MissionStateKind } from "@/lib/mission/mission-state";

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

export { SPEC_HOLD_MS, CONFIRM_HOLD_DEFAULT_MS, GUARD_WINDOW_MS, confirmHoldMs } from "./confirm-policy";
export type { ConfirmGesture, ConfirmAltitude, ConfirmPolicy, ConfirmChoice, ConfirmResult } from "./confirm-policy";

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
  /**
   * An i18n key for a warning the slot shows while the skill stays fireable,
   * for example a last-resort command offered over a stale link.
   */
  warning?: string;
  /** Epoch ms the plugin last reported this state (plugin skills only). */
  seenAt?: number;
  /** True when the link to the drone is down: the state is the last known. */
  linkLost?: boolean;
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
  /**
   * The live command path while the FC heartbeat is stale. Only last-resort
   * skills (kill, return home, land) send through it, and only when
   * `protocol` is null: the downlink may be lost while the uplink still
   * works. Absent or null when the transport itself is down.
   */
  blindProtocol?: SkillProtocol | null;
  /** True when a transport is open but the FC heartbeat is stale. */
  linkStale?: boolean;
  /**
   * Rebuild this context from the live stores. The dispatcher calls it after a
   * confirm sheet resolves to re-check the vehicle before sending.
   */
  refresh?: () => SkillContext;
  armState: ArmState;
  flightMode: FlightMode;
  /** HEARTBEAT system_status (MAV_STATE) of the targeted drone, when known. */
  systemStatus?: number | null;
  /**
   * Mode preset gating uses this — TRUE iff the connected firmware handler's
   * getAvailableModes() includes the target UnifiedFlightMode. Built by the
   * context builder from the selected drone's firmware handler. Empty array
   * when no FC handler is present.
   */
  availableModes: UnifiedFlightMode[];
  /**
   * The mission state (agent-computed, or the direct link's), null when
   * unknown. Pause and resume read it; no surface infers a mission from mode names.
   */
  missionState: MissionStateKind | null;
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
  /** A controller hold binding completed: its own hold is the confirmation. */
  confirmedByHold?: boolean;
  /** How long that hold ran, in ms. A guarded skill counts it as confirmed
   * only when it reaches the skill's own hold time. */
  heldMs?: number;
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
  /** Skill-picker tab (manifest category); built-ins have none. */
  pickerCategory?: "behavior" | "camera" | "navigation" | "utility";
  /** the skill commands the vehicle (one at a time, preempted by built-ins). */
  motion?: boolean;
  /** parameter keys the picker's Tweak panel shows. */
  params?: string[];
  /** vehicle classes the skill supports; absent = every class. */
  vehicleClasses?: ("multirotor" | "fixedwing" | "vtol")[];
  toggle: boolean;
  confirm?: ConfirmPolicy;
  /**
   * The confirm policy for one activation, when it depends on the arguments
   * (a mode change confirms differently for a recovery mode than for AUTO).
   * Wins over `confirm`; returning undefined means no confirmation.
   */
  confirmFor?: (
    args?: SkillActivateArgs,
    ctx?: SkillContext,
  ) => ConfirmPolicy | undefined;
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
