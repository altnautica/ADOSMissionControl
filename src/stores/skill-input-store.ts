/**
 * @module stores/skill-input-store
 * @description Who owns keyboard and gamepad input on the flying surfaces.
 *
 * The skill dispatcher is mounted once, in the shell. It runs only while a
 * flying surface (the Cockpit tab, the Flight tab's actions panel) is on
 * screen, and pauses while a surface that captures input is open: the binding
 * editor, the command palette or the gamepad radial. Those flags live here so
 * the shell-level dispatcher and every cockpit input handler read one source
 * instead of each re-deriving it.
 *
 * The take-off altitude the operator typed on the Flight tab lives here too,
 * so a take-off fired from a key or button commands the same altitude as the
 * panel button.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { TAKEOFF_ALTITUDE_M } from "@/lib/skills/builtins/takeoff";

interface SkillInputState {
  /** Mounted flying surfaces. The dispatcher is live while this is above 0. */
  surfaces: number;
  /** The Skill Bar binding editor is open. */
  editorOpen: boolean;
  /** The cockpit command palette is open. */
  paletteOpen: boolean;
  /** The gamepad radial is open and the D-pad / sticks aim it. */
  radialOpen: boolean;
  /** Take-off altitude (m above home) for a key- or button-fired take-off, or
   *  `null` while the Flight tab's altitude field holds an out-of-range entry
   *  (a take-off is then refused rather than flown to some other number). */
  takeoffAltitudeM: number | null;
  /** Register a mounted flying surface; returns its release. */
  acquireSurface: () => () => void;
  setEditorOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setRadialOpen: (open: boolean) => void;
  setTakeoffAltitudeM: (altitudeM: number | null) => void;
}

export const useSkillInputStore = create<SkillInputState>((set) => ({
  surfaces: 0,
  editorOpen: false,
  paletteOpen: false,
  radialOpen: false,
  takeoffAltitudeM: TAKEOFF_ALTITUDE_M.default,
  acquireSurface: () => {
    set((s) => ({ surfaces: s.surfaces + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ surfaces: Math.max(0, s.surfaces - 1) }));
    };
  },
  setEditorOpen: (editorOpen) => set({ editorOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setRadialOpen: (radialOpen) => set({ radialOpen }),
  setTakeoffAltitudeM: (takeoffAltitudeM) => set({ takeoffAltitudeM }),
}));
