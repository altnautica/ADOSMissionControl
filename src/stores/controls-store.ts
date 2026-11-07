/**
 * @module controls-store
 * @description Settings › Controls on this surface: the controller binding
 * list (the spec defaults until the operator edits it), and which pads have
 * seen the first-connect tour. Stick mode, deadzone and stick calibration
 * live in the input store, which the stick stream reads.
 *
 * The export file is the spec's `export_format` (`kind: "ados-controls"`):
 * the complete effective binding list, never a diff. An import missing a
 * locked safety binding, or naming an unknown action, is refused.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  DS4_ACTIONS,
  SPEC_BINDINGS,
  bindingConflicts,
  missingLocked,
  type Ds4Binding,
} from "@/lib/input/ds4-bindings";
import { useInputStore } from "@/stores/input-store";

export interface ControlsExport {
  v: 1;
  kind: "ados-controls";
  pad: "ds4" | "generic";
  stick_mode: "mode1" | "mode2";
  deadzone: number;
  profile: "ados_default" | "user";
  bindings: Ds4Binding[];
}

interface ControlsState {
  /** The operator's binding list, or null for the spec defaults. */
  bindings: Ds4Binding[] | null;
  tourSeen: Record<string, true>;
  setBindings: (bindings: Ds4Binding[]) => void;
  reset: () => void;
  markTourSeen: (padId: string) => void;
}

export const useControlsStore = create<ControlsState>()(
  persist(
    (set) => ({
      bindings: null,
      tourSeen: {},
      setBindings: (bindings) => set({ bindings }),
      reset: () => set({ bindings: null }),
      markTourSeen: (padId) => set((s) => ({ tourSeen: { ...s.tourSeen, [padId]: true } })),
    }),
    {
      name: "altcmd:cockpit-controls",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ bindings: s.bindings, tourSeen: s.tourSeen }),
    },
  ),
);

/** The bindings in force: the operator's, else the spec's. */
export function effectiveBindings(state: Pick<ControlsState, "bindings"> = useControlsStore.getState()): readonly Ds4Binding[] {
  return state.bindings ?? SPEC_BINDINGS;
}

/** Why a binding list cannot be saved, or null when it can. */
export function bindingsSaveError(bindings: readonly Ds4Binding[]): string | null {
  if (bindingConflicts(bindings).size > 0) return "Bound twice: resolve before saving";
  const missing = missingLocked(bindings);
  if (missing.length > 0) return `Safety bindings missing: ${missing.join(", ")}`;
  return null;
}

export function exportControls(): ControlsExport {
  const input = useInputStore.getState();
  const bindings = useControlsStore.getState().bindings;
  return {
    v: 1,
    kind: "ados-controls",
    pad: "ds4",
    stick_mode: input.txMode === 1 ? "mode1" : "mode2",
    deadzone: input.deadzone,
    profile: bindings ? "user" : "ados_default",
    bindings: [...(bindings ?? SPEC_BINDINGS)],
  };
}

const KNOWN_ACTIONS = new Set(DS4_ACTIONS.map((a) => a.id));

function isBinding(v: unknown): v is Ds4Binding {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.control === "string" &&
    Array.isArray(b.with) &&
    b.with.every((w) => typeof w === "string") &&
    (b.gesture === "tap" || b.gesture === "hold" || b.gesture === "double_tap" || b.gesture === "analog") &&
    (b.hold_ms === null || typeof b.hold_ms === "number") &&
    (b.when === null || typeof b.when === "string") &&
    typeof b.action === "string" &&
    (KNOWN_ACTIONS.has(b.action) || /^skill:[^:]+:.+$/.test(b.action))
  );
}

/** Apply an export file. Returns an error message, or null on success. */
export function importControls(text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "Not a controls file";
  }
  const f = raw as Partial<ControlsExport>;
  if (!f || f.kind !== "ados-controls" || f.v !== 1 || !Array.isArray(f.bindings)) return "Not a controls file";
  const bindings: Ds4Binding[] = [];
  for (const b of f.bindings) {
    if (!isBinding(b)) return `Unknown binding: ${JSON.stringify(b).slice(0, 80)}`;
    bindings.push({
      control: b.control,
      with: [...b.with],
      gesture: b.gesture,
      hold_ms: b.hold_ms,
      when: b.when,
      action: b.action,
      rumble: typeof b.rumble === "string" ? b.rumble : null,
      locked: b.locked === true,
      ...(typeof b.rate_full_dps === "number" ? { rate_full_dps: b.rate_full_dps } : {}),
    });
  }
  const missing = missingLocked(bindings);
  if (missing.length > 0) return `This file is missing safety bindings: ${missing.join(", ")}`;
  if (bindingConflicts(bindings).size > 0) return "Bound twice: resolve before saving";
  const input = useInputStore.getState();
  if (f.stick_mode === "mode1" || f.stick_mode === "mode2") input.setTxMode(f.stick_mode === "mode1" ? 1 : 2);
  if (typeof f.deadzone === "number" && f.deadzone >= 0.04 && f.deadzone <= 0.2) input.setDeadzone(f.deadzone);
  useControlsStore.getState().setBindings(f.profile === "ados_default" ? SPEC_BINDINGS.slice() : bindings);
  return null;
}
