/**
 * @module use-skill-input
 * @description The global cockpit input dispatcher. One window keydown
 * listener plus a gamepad button edge-detector resolve the active loadout's
 * bindings to a Skill and activate it through the registry's single gating
 * pipeline (text-field guard, arm-requirement, confirm, idempotency).
 *
 * Keyboard and gamepad are two sources into the same resolve-and-activate
 * path; a binding only ever names a Skill id, so it can never bypass a
 * safety gate. Bound gamepad buttons stay in the MANUAL_CONTROL bitmask —
 * the action edge is purely additive on top of the flight-control stream.
 *
 * Mounted once by the shell. It listens only while a flying surface has
 * registered itself with `useFlightInputSurface`, and pauses while a confirm
 * modal, the binding editor, the command palette, the radial or the
 * quick-settings drawer owns input. The default loadout reproduces the
 * Shift+A/T/L/P/R/X chords, and a rebind applies on every flying surface.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useSettingsStore } from "@/stores/settings-store";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { activate, buildSkillContext } from "@/lib/skills";
import { canonicalChord } from "@/lib/skills/chord";
import { TAKEOFF_ALTITUDE_M } from "@/lib/skills/builtins/takeoff";
import type { SkillActivateArgs, SkillContext } from "@/lib/skills/types";

/** True when the event originates from an editable field — never dispatch. */
export function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Register the calling component as a flying surface for as long as it is
 * mounted, which lets the shell-level dispatcher act on skill bindings.
 */
export function useFlightInputSurface(): void {
  useEffect(() => useSkillInputStore.getState().acquireSurface(), []);
}

export function useSkillInput(): void {
  const surfaceLive = useSkillInputStore(
    (s) => s.surfaces > 0 && !s.editorOpen && !s.paletteOpen && !s.radialOpen,
  );
  const confirmPending = useSkillConfirmStore((s) => s.pending !== null);
  const quickOpen = useFlyQuickSettingsStore((s) => s.isOpen);
  const enabled = surfaceLive && !confirmPending && !quickOpen;
  const { toast } = useToast();
  const tFlight = useTranslations("flight");

  // Keep the live toast + translator in refs so the long-lived listeners always
  // reach the current ones without re-subscribing on every render.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tFlightRef = useRef(tFlight);
  tFlightRef.current = tFlight;

  // Resolve the active loadout slots fresh at dispatch time so a rebind takes
  // effect without re-registering the listener.
  function dispatchSkill(skillId: string): void {
    const droneId = useDroneManager.getState().selectedDroneId;
    if (!droneId) return;
    let args: SkillActivateArgs | undefined;
    if (skillId === "takeoff") {
      // Take-off flies to the Flight tab's altitude; an out-of-range entry
      // there refuses it, exactly as the panel button does.
      const altitudeM = useSkillInputStore.getState().takeoffAltitudeM;
      if (altitudeM === null) {
        toastRef.current(
          tFlightRef.current("takeoffAltitudeOutOfRange", {
            min: TAKEOFF_ALTITUDE_M.min,
            max: TAKEOFF_ALTITUDE_M.max,
          }),
          "error",
        );
        return;
      }
      args = { altitudeM };
    }
    const ctx: SkillContext = buildSkillContext(droneId);
    // Inject the live toast as the user-facing notifier.
    ctx.notify = (message: string, status?: "success" | "warning" | "error" | "info") =>
      toastRef.current(message, status);
    void activate(skillId, ctx, args);
  }

  // Keyboard half: one window keydown listener.
  useEffect(() => {
    if (!enabled) return;

    function handleKey(e: KeyboardEvent): void {
      if (isTextTarget(e.target)) return;

      const chord = canonicalChord(e);
      if (!chord) return;

      const { loadouts, activeLoadoutId } = useSettingsStore.getState();
      const loadout = loadouts[activeLoadoutId];
      if (!loadout) return;

      const slot = loadout.slots.find(
        (s) => s.key === chord && s.skillId !== null,
      );
      if (!slot || slot.skillId === null) return;

      e.preventDefault();
      dispatchSkill(slot.skillId);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // dispatchSkill closes over stable store getters + a ref'd toast; it does
    // not need to be a dependency.
  }, [enabled]);

  // Gamepad half: edge-detect false->true transitions on input-store buttons.
  useEffect(() => {
    if (!enabled) return;

    // Seed from the current state so a button already held at mount does not
    // register a spurious edge.
    const prevButtons: boolean[] = [...useInputStore.getState().buttons];

    const unsubscribe = useInputStore.subscribe((state) => {
      const buttons = state.buttons;
      const { loadouts, activeLoadoutId } = useSettingsStore.getState();
      const loadout = loadouts[activeLoadoutId];

      for (let i = 0; i < buttons.length; i++) {
        const wasDown = prevButtons[i] ?? false;
        const isDown = buttons[i] ?? false;
        // Off->on edge only: holding a bound button never re-fires the skill,
        // while the bitmask keeps reporting the held state to the FC.
        if (isDown && !wasDown && loadout) {
          const slot = loadout.slots.find(
            (s) => s.gamepadButton === i && s.skillId !== null,
          );
          if (slot && slot.skillId !== null) {
            dispatchSkill(slot.skillId);
          }
        }
        prevButtons[i] = isDown;
      }
    });

    return () => unsubscribe();
  }, [enabled]);
}
