/**
 * @module use-gamepad-radial
 * @description Drives the Cockpit gamepad radial quick-select. Holding a
 * reserved gamepad button opens a radial of the active loadout's bound skills;
 * the right stick (angle) or the d-pad selects a wedge; releasing the hold
 * button fires the highlighted skill through the shared dispatcher so every
 * gate (confirm / arm / cooldown / charges) is uniform with the keyboard and
 * Skill Bar paths.
 *
 * Kiosk-friendly: an HDMI operator with a stick and no mouse selects and fires
 * an action without touching the bar. The hold/release and the d-pad are
 * edge-detected off the input-store buttons, exactly like the main dispatcher,
 * so a held button never re-fires.
 *
 * The hook is pure state + side-effect wiring; the visual overlay is
 * {@link SkillRadial}, which reads the same returned model.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import {
  useSkillRegistry,
  buildSkillContext,
  activate,
  type Skill,
} from "@/lib/skills";

/**
 * Reserved gamepad button that opens the radial while held. Index 8 (Select /
 * Back on a standard mapping) is chosen because index 9 (Start) is already the
 * cockpit exit chord and indices 0-3 are common skill bindings.
 */
export const RADIAL_GAMEPAD_BUTTON = 8;

/**
 * Standard-mapping d-pad button indices (up/down/left/right). Pressing one
 * steps the highlight to the nearest wedge in that screen direction, so the
 * radial is fully usable on a controller with no analog stick.
 */
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

/** Right-stick axes in the input store's [roll, pitch, throttle, yaw] tuple. */
const RIGHT_STICK_X = 0; // roll
const RIGHT_STICK_Y = 1; // pitch (already Y-inverted by the poller: up = +)

/** Below this magnitude the right stick is treated as centered (no aim). */
const STICK_AIM_DEADZONE = 0.4;

export interface RadialWedge {
  skill: Skill;
  /** Center angle of this wedge, radians, 0 = up, clockwise. */
  angle: number;
}

export interface GamepadRadialModel {
  /** Whether the radial overlay is open (the hold button is down). */
  open: boolean;
  /** The wedges to render, one per bound+available skill. */
  wedges: RadialWedge[];
  /** Index into `wedges` of the highlighted wedge, or -1 for none. */
  highlightedIndex: number;
}

/**
 * Map a screen direction angle (0 = up, clockwise, radians) to the index of
 * the nearest wedge, or -1 when there are no wedges. Exported for testing.
 */
export function nearestWedge(wedges: RadialWedge[], angle: number): number {
  if (wedges.length === 0) return -1;
  let best = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < wedges.length; i++) {
    // Smallest absolute angular distance on the circle.
    let delta = Math.abs(wedges[i].angle - angle);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * Build the radial model and wire the gamepad hold/aim/release behavior.
 * Active only while `enabled`; otherwise the overlay stays closed and no
 * skill ever fires from this path.
 */
export function useGamepadRadial(enabled: boolean): GamepadRadialModel {
  const selectedId = useDroneManager((s) => s.selectedDroneId);

  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadouts = useSettingsStore((s) => s.loadouts);

  const registrySkills = useSkillRegistry((s) => s.skills);
  const resolveForDrone = useSkillRegistry((s) => s.resolveForDrone);

  // The bound, firmware-/install-filtered skills laid out as wedges. A slot
  // bound to a skill unavailable on the selected drone is dropped (it can't
  // fire), so the radial only ever offers fireable wedges.
  const wedges = useMemo<RadialWedge[]>(() => {
    if (!selectedId) return [];
    const loadout = loadouts[activeLoadoutId] ?? loadouts.default;
    if (!loadout) return [];
    const available = new Map<string, Skill>();
    for (const skill of resolveForDrone(selectedId)) {
      available.set(skill.id, skill);
    }
    const bound: Skill[] = [];
    for (const slot of loadout.slots) {
      if (!slot.skillId) continue;
      const skill = available.get(slot.skillId);
      if (skill) bound.push(skill);
    }
    return bound.map((skill, i) => ({
      skill,
      angle: (i / bound.length) * 2 * Math.PI,
    }));
    // registrySkills drives a re-resolve on register/unregister.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeLoadoutId, loadouts, resolveForDrone, registrySkills]);

  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // The current wedge set + selection must be readable from the long-lived
  // subscription closure without re-subscribing, so keep them in refs.
  const wedgesRef = useRef(wedges);
  wedgesRef.current = wedges;
  const highlightRef = useRef(highlightedIndex);
  highlightRef.current = highlightedIndex;
  const openRef = useRef(open);
  openRef.current = open;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Close + clear whenever the path is disabled (e.g. Cockpit turned off or a
  // confirm modal took input) so a stale overlay never lingers.
  useEffect(() => {
    if (!enabled && (openRef.current || highlightRef.current !== -1)) {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const initial = useInputStore.getState();
    let prevHold = initial.buttons[RADIAL_GAMEPAD_BUTTON] ?? false;
    const prevDpad: Record<number, boolean> = {
      [DPAD_UP]: initial.buttons[DPAD_UP] ?? false,
      [DPAD_DOWN]: initial.buttons[DPAD_DOWN] ?? false,
      [DPAD_LEFT]: initial.buttons[DPAD_LEFT] ?? false,
      [DPAD_RIGHT]: initial.buttons[DPAD_RIGHT] ?? false,
    };

    const unsubscribe = useInputStore.subscribe((state) => {
      const list = wedgesRef.current;
      const holdDown = state.buttons[RADIAL_GAMEPAD_BUTTON] ?? false;

      // ── Open / fire on the hold-button edges ─────────────────────────────
      if (holdDown && !prevHold) {
        // Open with no preselection; the operator aims to pick.
        if (list.length > 0) {
          setOpen(true);
          setHighlightedIndex(-1);
        }
      } else if (!holdDown && prevHold) {
        // Release: fire the highlighted wedge through the shared dispatcher.
        if (openRef.current) {
          const idx = highlightRef.current;
          const droneId = selectedIdRef.current;
          const wedge = idx >= 0 ? list[idx] : undefined;
          if (wedge && droneId) {
            void activate(wedge.skill.id, buildSkillContext(droneId));
          }
        }
        setOpen(false);
        setHighlightedIndex(-1);
      }
      prevHold = holdDown;

      // Aim only while the radial is open.
      if (!openRef.current) {
        for (const b of [DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT]) {
          prevDpad[b] = state.buttons[b] ?? false;
        }
        return;
      }

      // ── Right-stick aim ──────────────────────────────────────────────────
      const sx = state.axes[RIGHT_STICK_X] ?? 0;
      const sy = state.axes[RIGHT_STICK_Y] ?? 0;
      if (Math.hypot(sx, sy) >= STICK_AIM_DEADZONE) {
        // Screen angle: 0 = up, clockwise. Poller already inverts Y so up = +.
        const angle = Math.atan2(sx, sy);
        const norm = angle < 0 ? angle + 2 * Math.PI : angle;
        const idx = nearestWedge(list, norm);
        if (idx !== highlightRef.current) setHighlightedIndex(idx);
      }

      // ── D-pad aim (edge-detected steps) ──────────────────────────────────
      const dpadDir = (b: number): number | null => {
        const down = state.buttons[b] ?? false;
        const edge = down && !prevDpad[b];
        prevDpad[b] = down;
        if (!edge) return null;
        switch (b) {
          case DPAD_UP:
            return 0;
          case DPAD_RIGHT:
            return Math.PI / 2;
          case DPAD_DOWN:
            return Math.PI;
          case DPAD_LEFT:
            return (3 * Math.PI) / 2;
          default:
            return null;
        }
      };
      for (const b of [DPAD_UP, DPAD_RIGHT, DPAD_DOWN, DPAD_LEFT]) {
        const dir = dpadDir(b);
        if (dir !== null) {
          const idx = nearestWedge(list, dir);
          if (idx !== highlightRef.current) setHighlightedIndex(idx);
        }
      }
    });

    return () => unsubscribe();
  }, [enabled]);

  return { open, wedges, highlightedIndex };
}
