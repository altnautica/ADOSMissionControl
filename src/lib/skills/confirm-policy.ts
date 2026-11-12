/**
 * The confirm policy a skill asks for: the gesture tiers, the shared spec
 * holds, the take-off altitude stepper and what the operator chose.
 * Re-exported from `./types`, the one import path for the Skill model.
 *
 * @module skills/confirm-policy
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit-spec/layout.json";

/**
 * The confirm gesture tier. `tap` opens no sheet (the press is the
 * confirmation); `hold` completes after a press-and-hold; `slide` needs a
 * slide-to-confirm on touch/pointer or a long hold on a key/gamepad button;
 * `guarded` is the kill tier: the first activation arms a guard and a hold
 * inside that window fires.
 */
export type ConfirmGesture = "tap" | "hold" | "slide" | "guarded";

/**
 * The confirm holds the shared cockpit spec names (`layout.json` `holds_ms`):
 * take control, hand to the flight controller, the VTOL transition, Fly Here
 * and the emergency stop. Every surface holds these for the same time.
 */
export const SPEC_HOLD_MS: Readonly<{
  take_control: number;
  hand_to_fc: number;
  vtol_transition: number;
  fly_here: number;
  stop: number;
}> = Object.freeze({ ...layoutSpec.holds_ms });

/** Hold duration (ms) each tier asks for when the policy names none. The
 * guarded tier is the emergency stop's, so it holds for the spec's stop. */
export const CONFIRM_HOLD_DEFAULT_MS: Record<ConfirmGesture, number> = {
  tap: 0,
  hold: 800,
  slide: 1500,
  guarded: SPEC_HOLD_MS.stop,
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
  /**
   * Set per request when the command goes out over a stale link (no FC
   * heartbeat inside the freshness window). The sheet then warns that the
   * vehicle may not receive the command.
   */
  staleLink?: boolean;
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
