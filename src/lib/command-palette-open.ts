/**
 * Opening the global command palette from outside its keyboard chord (the
 * shell's hint button), and the chord's label for this OS.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

export const OPEN_COMMAND_PALETTE_EVENT = "ados:open-command-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

const noSubscribe = () => () => {};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** "⌘K" on macOS, "Ctrl K" elsewhere (and on the server render). */
export function usePaletteChordLabel(): string {
  const isMac = useSyncExternalStore(noSubscribe, isMacPlatform, () => false);
  return isMac ? "⌘K" : "Ctrl K";
}
