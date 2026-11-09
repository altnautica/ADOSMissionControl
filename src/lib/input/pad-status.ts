/**
 * What the cockpit shows about the connected gamepad itself, published by the
 * gamepad poller.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** What the cockpit shows about the pad itself. */
export interface PadStatus {
  /** A pad is connected (from `gamepadconnected`/`gamepaddisconnected` or a read). */
  connected: boolean;
  /** The pad has reported at least once: browsers expose a pad only after its first input. */
  seen: boolean;
  name: string | null;
  /** `mapping === "standard"`, or a calibration wizard axis map exists for this pad. */
  usable: boolean;
  /** True when the pad layout is not standard and has no calibration. */
  needsCalibration: boolean;
}

export const usePadStatusStore = create<PadStatus & { set: (p: Partial<PadStatus>) => void }>(
  (set) => ({
    connected: false,
    seen: false,
    name: null,
    usable: false,
    needsCalibration: false,
    set: (p) => set(p),
  }),
);

export function patchPadStatus(p: Partial<PadStatus>): void {
  const s = usePadStatusStore.getState();
  for (const k of Object.keys(p) as (keyof PadStatus)[]) {
    if (s[k] !== p[k]) {
      s.set(p);
      return;
    }
  }
}

/**
 * The pad's product name without the browser's id decorations: Chromium
 * appends "(STANDARD GAMEPAD Vendor: 054c Product: 09cc)" or "(Vendor: …
 * Product: …)", Firefox prefixes "054c-09cc-". Null when nothing is left.
 */
export function shortPadName(id: string | null): string | null {
  if (!id) return null;
  const name = id
    .replace(/\s*\((?:STANDARD GAMEPAD\s*)?(?:Vendor:[^)]*)?\)\s*$/i, "")
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, "")
    .trim();
  return name || null;
}
