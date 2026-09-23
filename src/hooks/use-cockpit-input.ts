/**
 * @module use-cockpit-input
 * @description The cockpit's own keyboard and gamepad controls: the command
 * palette chord, Escape for the palette and the binding editor, the
 * quick-settings chord, the video-stream hotkeys, the picture-in-picture
 * toggle, D-pad stream cycling and the Start exit.
 *
 * Every handler asks one question before acting: does something else own
 * input right now? A pending skill confirm, the binding editor, the command
 * palette, the quick-settings drawer and the gamepad radial each take input
 * while open, and a control that ignores one of them fires twice (the D-pad
 * steering the radial also switching the main video, say).
 *
 * The Escape handler runs in the capture phase so it wins over the shell's
 * bubble-phase immersive-exit listener regardless of which registered first.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useInputStore } from "@/stores/input-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useUiStore } from "@/stores/ui-store";
import { COCKPIT_GAMEPAD_BUTTON } from "@/lib/skills/chord";
import { isTextTarget } from "@/hooks/use-skill-input";
import { isDemoMode } from "@/lib/utils";

interface CockpitInputOptions {
  /** The drone whose cockpit this is. */
  droneId: string;
  /** The skill layer is on: quick settings answer only then. */
  cockpitEnabled: boolean;
}

/**
 * True while a confirm, the editor, the palette, the quick-settings drawer or
 * the radial owns input. Read at event time, so no handler re-subscribes when
 * one of them opens.
 */
function inputOwnedElsewhere(): boolean {
  const input = useSkillInputStore.getState();
  return (
    useSkillConfirmStore.getState().pending !== null ||
    input.editorOpen ||
    input.paletteOpen ||
    input.radialOpen ||
    useFlyQuickSettingsStore.getState().isOpen
  );
}

/** Edge-detect one gamepad button (or all of a chord) going down. */
function onGamepadPress(buttons: readonly number[], fire: () => void): () => void {
  const down = (state: boolean[]) => buttons.every((b) => state[b] ?? false);
  let prev = down(useInputStore.getState().buttons);
  return useInputStore.subscribe((state) => {
    const now = down(state.buttons);
    if (now && !prev) fire();
    prev = now;
  });
}

export function useCockpitInput({ droneId, cockpitEnabled }: CockpitInputOptions): void {
  // Ctrl/Cmd+K toggles the command palette. Not gated on the skill layer: the
  // palette is how an operator discovers the skills they could turn on.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (useSkillConfirmStore.getState().pending !== null) return;
      const input = useSkillInputStore.getState();
      if (input.editorOpen) return;
      e.preventDefault();
      input.togglePalette();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Escape closes the palette, else the binding editor. Capture phase plus
  // stopImmediatePropagation, so the shell never also leaves immersive mode.
  // A confirm or a dialog opened from the editor handles its own Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useSkillConfirmStore.getState().pending !== null) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"],[role="alertdialog"]')
      ) {
        return;
      }
      const input = useSkillInputStore.getState();
      if (input.paletteOpen) {
        input.setPaletteOpen(false);
      } else if (input.editorOpen && !useFlyQuickSettingsStore.getState().isOpen) {
        input.setEditorOpen(false);
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Shift+comma toggles quick settings. Matched on the physical key: with Shift
  // held, `e.key` is "<" on US/UK layouts and ";" on German ones.
  useEffect(() => {
    if (!cockpitEnabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Comma" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTextTarget(e.target)) return;
      if (useSkillConfirmStore.getState().pending !== null) return;
      if (useSkillInputStore.getState().editorOpen) return;
      e.preventDefault();
      useFlyQuickSettingsStore.getState().toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cockpitEnabled]);

  // L1 + R1 together toggles quick settings.
  useEffect(() => {
    if (!cockpitEnabled) return;
    return onGamepadPress(
      [COCKPIT_GAMEPAD_BUTTON.quickSettingsLeft, COCKPIT_GAMEPAD_BUTTON.quickSettingsRight],
      () => {
        const input = useSkillInputStore.getState();
        if (useSkillConfirmStore.getState().pending !== null) return;
        if (input.editorOpen || input.paletteOpen || input.radialOpen) return;
        useFlyQuickSettingsStore.getState().toggle();
      },
    );
  }, [cockpitEnabled]);

  // Bare digits 1..N select the Nth video stream and backtick cycles, on a
  // multi-stream node only (otherwise the key passes through). The store
  // refuses a known-dead leg.
  useEffect(() => {
    if (!droneId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTextTarget(e.target) || inputOwnedElsewhere()) return;
      const vs = useVideoStreamsStore.getState();
      const streams = vs.streamsByDrone[droneId] ?? [];
      if (streams.length <= 1) return;
      // A single-encoder restart in flight debounces further switches.
      if (vs.switchingByDrone[droneId]) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        const index = Number(digit[1]);
        if (index > streams.length) return;
        e.preventDefault();
        vs.selectStream(droneId, index);
        return;
      }
      if (e.code === "Backquote") {
        e.preventDefault();
        vs.cycleStream(droneId, 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [droneId]);

  // P toggles the picture-in-picture inset on a PiP-capable node (two or more
  // concurrent streams, or any multi-stream node in demo mode). Elsewhere P
  // reaches a bound skill.
  useEffect(() => {
    if (!droneId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "KeyP" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTextTarget(e.target) || inputOwnedElsewhere()) return;
      const st = useVideoStreamsStore.getState();
      const streams = st.streamsByDrone[droneId] ?? [];
      const concurrent = streams.filter((s) => s.kind === "concurrent");
      const pipCapable = streams.length >= 2 && (isDemoMode() || concurrent.length >= 2);
      if (!pipCapable) return;
      e.preventDefault();
      if (st.pipStreamIdByDrone[droneId]) {
        st.setPip(droneId, null);
        return;
      }
      const activeId = st.activeStreamIdByDrone[droneId] ?? streams[0]?.id;
      const candidates = isDemoMode() ? streams : concurrent;
      const next = candidates.find((s) => s.id !== activeId);
      if (next) st.setPip(droneId, next.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [droneId]);

  // D-pad left/right cycles the video stream, except while the radial (which
  // the D-pad aims) or any other input owner is open.
  useEffect(() => {
    if (!droneId) return;
    const cycle = (dir: 1 | -1) => () => {
      const vs = useVideoStreamsStore.getState();
      if ((vs.streamsByDrone[droneId] ?? []).length <= 1) return;
      if (vs.switchingByDrone[droneId] || inputOwnedElsewhere()) return;
      vs.cycleStream(droneId, dir);
    };
    const offRight = onGamepadPress([COCKPIT_GAMEPAD_BUTTON.dpadRight], cycle(1));
    const offLeft = onGamepadPress([COCKPIT_GAMEPAD_BUTTON.dpadLeft], cycle(-1));
    return () => {
      offRight();
      offLeft();
    };
  }, [droneId]);

  // Start leaves immersive mode, so a stick-only operator always has a way
  // back to the embedded tab.
  useEffect(
    () =>
      onGamepadPress([COCKPIT_GAMEPAD_BUTTON.exit], () => {
        if (useSkillConfirmStore.getState().pending === null) {
          useUiStore.getState().exitImmersiveMode();
        }
      }),
    [],
  );
}
