/**
 * @module mission/mission-verify
 * @description Compares a mission list sent to a vehicle with the list read
 * back from it after the upload: same commands, frames and parameters;
 * positions within one 1e-7 degree unit and altitudes within 1 cm. An
 * acknowledged upload is only trusted once its read-back matches.
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types";

const POSITION_UNITS = 1;
const ALT_TOLERANCE_M = 0.01;
// Parameters travel as float32: allow its rounding, no more.
const PARAM_TOLERANCE = 1e-4;

/** A vehicle may echo a global frame as its `_INT` twin; both mean the same datum. */
const INT_FRAME: Record<number, number> = { 0: 5, 3: 6, 10: 11 };

function close(a: number, b: number, tolerance: number): boolean {
  return (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= tolerance;
}

function sameItem(a: MissionItem, b: MissionItem): boolean {
  return (
    a.command === b.command &&
    (INT_FRAME[a.frame] ?? a.frame) === (INT_FRAME[b.frame] ?? b.frame) &&
    close(a.param1, b.param1, PARAM_TOLERANCE) &&
    close(a.param2, b.param2, PARAM_TOLERANCE) &&
    close(a.param3, b.param3, PARAM_TOLERANCE) &&
    close(a.param4, b.param4, PARAM_TOLERANCE) &&
    Math.abs(a.x - b.x) <= POSITION_UNITS &&
    Math.abs(a.y - b.y) <= POSITION_UNITS &&
    close(a.z, b.z, ALT_TOLERANCE_M)
  );
}

/**
 * True when `readBack` holds what `sent` asked for. With `homeSlot` (ArduPilot)
 * seq 0 is home, which the vehicle fills from its own position, so it is
 * compared by count only.
 */
export function missionReadBackMatches(
  sent: readonly MissionItem[],
  readBack: readonly MissionItem[],
  homeSlot: boolean,
): boolean {
  if (sent.length !== readBack.length) return false;
  const bySeq = new Map(readBack.map((item) => [item.seq, item]));
  for (const item of sent) {
    if (homeSlot && item.seq === 0) continue;
    const echoed = bySeq.get(item.seq);
    if (!echoed || !sameItem(item, echoed)) return false;
  }
  return true;
}
