/**
 * @module fc/calibration/rc-calibration-entries
 * @description Turns captured RC stick extremes into the RCn_MIN/MAX/TRIM
 * writes for a calibration. A channel only gets written when the capture saw
 * it move (max > min); a channel the receiver never reported keeps its
 * inverted start values and must not land on the vehicle as MIN 2200 / MAX 800.
 * @license GPL-3.0-only
 */

import type { ParamBatchEntry } from "@/lib/protocol/param-write";

export interface RcChannelCapture {
  min: number;
  max: number;
  trim: number;
}

export function rcCalibrationEntries(
  captures: readonly RcChannelCapture[],
  current: ReadonlyMap<string, number>,
): ParamBatchEntry[] {
  const entries: ParamBatchEntry[] = [];
  captures.forEach((ch, i) => {
    if (!(ch.max > ch.min)) return;
    const n = i + 1;
    const trim = Math.min(Math.max(ch.trim, ch.min), ch.max);
    const values: [string, number][] = [
      [`RC${n}_MIN`, ch.min],
      [`RC${n}_MAX`, ch.max],
      [`RC${n}_TRIM`, trim],
    ];
    for (const [name, value] of values) {
      entries.push({ name, value, oldValue: current.get(name) ?? 0 });
    }
  });
  return entries;
}
