/**
 * Binding-capture hooks shared by the cockpit Skill Bar editor and the input
 * config panel. One hook captures the next keyboard chord, one captures the
 * next gamepad button edge. Both arm on demand, fire a single result, and
 * disarm — so a slot's "press a key…" / "press a button…" state is a short,
 * self-contained capture window.
 *
 * The keyboard capture reuses the dispatcher's exact chord encoding (so a
 * captured binding matches at dispatch time byte-for-byte) and refuses globally
 * reserved chords. The gamepad capture edge-detects an off->on transition on
 * the input-store buttons[] so a button already held when capture starts never
 * registers a spurious press.
 *
 * @module use-binding-capture
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureChord,
  isReservedChord,
  isReservedGamepadButton,
} from "@/lib/skills/chord";
import { useInputStore } from "@/stores/input-store";

export interface KeyCaptureResult {
  /** True while waiting for a key. */
  capturing: boolean;
  /** Begin capturing; the next keydown resolves the callback. */
  start: () => void;
  /** Cancel a pending capture without binding. */
  cancel: () => void;
}

interface KeyCaptureOptions {
  /** Called with the canonical chord for an accepted (non-reserved) key. */
  onCapture: (chord: string) => void;
  /** Called when the captured chord is globally reserved (refused). */
  onReserved?: (chord: string) => void;
}

/**
 * Capture the next keyboard chord. While capturing, a window keydown is
 * intercepted (preventDefault + stopPropagation) so it neither dispatches a
 * skill nor triggers a reserved app shortcut during the capture window. An
 * accepted chord calls onCapture; a reserved chord calls onReserved and keeps
 * the capture open is NOT done — capture always ends after the first key so the
 * UI returns to rest; the caller re-arms if it wants another attempt.
 */
export function useKeyCapture({
  onCapture,
  onReserved,
}: KeyCaptureOptions): KeyCaptureResult {
  const [capturing, setCapturing] = useState(false);
  const onCaptureRef = useRef(onCapture);
  const onReservedRef = useRef(onReserved);
  onCaptureRef.current = onCapture;
  onReservedRef.current = onReserved;

  useEffect(() => {
    if (!capturing) return;

    const handle = (e: KeyboardEvent) => {
      // Swallow the key during capture so it never reaches the dispatcher or a
      // global shortcut.
      e.preventDefault();
      e.stopPropagation();

      const chord = captureChord(e);
      if (chord === null) return; // bare modifier / dead key — wait for a real key

      setCapturing(false);
      if (isReservedChord(chord)) {
        onReservedRef.current?.(chord);
        return;
      }
      onCaptureRef.current(chord);
    };

    // Capture-phase so we win over bubble-phase global listeners.
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [capturing]);

  const start = useCallback(() => setCapturing(true), []);
  const cancel = useCallback(() => setCapturing(false), []);

  return { capturing, start, cancel };
}

export interface ButtonCaptureResult {
  capturing: boolean;
  start: () => void;
  cancel: () => void;
}

interface ButtonCaptureOptions {
  /** Called with the 0..15 button index for the first off->on edge. */
  onCapture: (button: number) => void;
  /** Called when the pressed button is owned by the cockpit (refused). */
  onReserved?: (button: number) => void;
}

/**
 * Capture the next gamepad button press. Seeds from the current button state on
 * arm so a held button does not register, then resolves on the first off->on
 * edge in input-store buttons[]. A cockpit-owned button ends the capture
 * through onReserved instead of binding.
 */
export function useButtonCapture({
  onCapture,
  onReserved,
}: ButtonCaptureOptions): ButtonCaptureResult {
  const [capturing, setCapturing] = useState(false);
  const onCaptureRef = useRef(onCapture);
  const onReservedRef = useRef(onReserved);
  onCaptureRef.current = onCapture;
  onReservedRef.current = onReserved;

  useEffect(() => {
    if (!capturing) return;

    const prev = [...useInputStore.getState().buttons];
    const unsubscribe = useInputStore.subscribe((state) => {
      const buttons = state.buttons;
      for (let i = 0; i < buttons.length; i++) {
        const wasDown = prev[i] ?? false;
        const isDown = buttons[i] ?? false;
        if (isDown && !wasDown) {
          setCapturing(false);
          if (isReservedGamepadButton(i)) {
            onReservedRef.current?.(i);
            return;
          }
          onCaptureRef.current(i);
          return;
        }
        prev[i] = isDown;
      }
    });

    return () => unsubscribe();
  }, [capturing]);

  const start = useCallback(() => setCapturing(true), []);
  const cancel = useCallback(() => setCapturing(false), []);

  return { capturing, start, cancel };
}
