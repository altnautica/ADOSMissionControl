/**
 * @module cockpit/picker-commands
 * @description The skill picker's controller commands. The controller
 * dispatcher sends them; the mounted picker executes them (it owns the skill
 * list, the selection and the GO / Stop pipeline). `open` mirrors the
 * picker sheet so `picker_open` / `picker_closed` bindings resolve.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type PickerCommand = "focus_prev" | "focus_next" | "select" | "stop" | "param_up" | "param_down";

interface PickerState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePickerStore = create<PickerState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const listeners = new Set<(cmd: PickerCommand) => void>();

/** The picker subscribes while mounted. */
export function onPickerCommand(fn: (cmd: PickerCommand) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Send a command; returns false when no picker is mounted. */
export function sendPickerCommand(cmd: PickerCommand): boolean {
  for (const fn of listeners) fn(cmd);
  return listeners.size > 0;
}
