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
