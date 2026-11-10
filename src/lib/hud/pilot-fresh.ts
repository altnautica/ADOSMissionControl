// Whether a pilot state is fresh enough to show what it says.
//
// Everything a surface derives from a pilot frame (flow countdowns, the
// control gate ring, the handover banner, "sticks with", AGL, the status
// pill's pilot items) hides or dims once the newest frame is as old as
// `flight-state.json` `stale_after_ms` (2000 ms), the age at which the chip
// turns to LINK. A frame that never arrived is not fresh either.

import { CHIP_STALE_AFTER_MS } from "./flight-state";

/** True while a pilot frame received at `frameAtMs` is younger than the
 *  spec's stale age at `nowMs` (same clock). Null or undefined: no frame. */
export function pilotFresh(frameAtMs: number | null | undefined, nowMs: number): boolean {
  return frameAtMs !== null && frameAtMs !== undefined && nowMs - frameAtMs < CHIP_STALE_AFTER_MS;
}
