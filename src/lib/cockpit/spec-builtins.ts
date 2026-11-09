/**
 * @module cockpit/spec-builtins
 * @description Typed access to the shared cockpit spec's built-in table
 * (`spec/builtins.json`, a byte copy of the one every cockpit surface reads).
 * The built-in skills take their label key, arm gate, confirm tier, link
 * rule, keyboard chord and pilot action from here, so the three surfaces
 * cannot drift.
 * @license GPL-3.0-only
 */

import builtinsSpec from "./spec/builtins.json";
import type { ConfirmGesture } from "@/lib/skills/types";
import type { PilotActionName } from "@/lib/input/pilot-stream";

export type SpecArmRequirement = "any" | "armed" | "disarmed" | "armed_landed" | "disarmed_or_landed";

export interface SpecBuiltin {
  id: string;
  label: string;
  icon: string;
  arm_requirement: SpecArmRequirement;
  confirm: { kind: "tap" | "hold" | "hold_confirm"; ms: number };
  needs_fresh_link: boolean;
  stale_link: "disable" | "send_blind";
  keyboard: string | null;
  arms_first: boolean;
  pilot_action: PilotActionName;
  notes: string | null;
}

export const SPEC_BUILTINS = builtinsSpec.builtins as SpecBuiltin[];

/** The spec row of a built-in. Throws on an id the spec does not define. */
export function specBuiltin(id: string): SpecBuiltin {
  const row = SPEC_BUILTINS.find((b) => b.id === id);
  if (!row) throw new Error(`cockpit spec has no built-in "${id}"`);
  return row;
}

/** The skill confirm gesture and hold time a spec confirm tier maps to. */
export function specConfirmGesture(row: SpecBuiltin): { gesture: ConfirmGesture; holdMs: number } {
  switch (row.confirm.kind) {
    case "tap":
      return { gesture: "tap", holdMs: 0 };
    case "hold":
      return { gesture: "hold", holdMs: row.confirm.ms };
    case "hold_confirm":
      // Hold, then confirm: the guarded tier (a first activation arms the
      // guard, a hold inside the window fires).
      return { gesture: "guarded", holdMs: row.confirm.ms };
  }
}
