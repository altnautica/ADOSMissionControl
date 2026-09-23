/**
 * @module ez-tune-fields
 * @description The iNav EZ Tune fields with the firmware's own ranges and
 * defaults (settings.yaml `ez_*`). MSP2_INAV_EZ_TUNE_SET stores the block
 * without a range check and applies it at once, and an axis ratio of 0 zeroes
 * the pitch PIDs, so a value outside these ranges is refused before it is sent.
 * @license GPL-3.0-only
 */

import type { INavEzTune } from "@/lib/protocol/msp/msp-decoders-inav";

export type EzTuneSliderKey = Exclude<keyof INavEzTune, "enabled">;

export interface EzTuneField {
  key: EzTuneSliderKey;
  label: string;
  min: number;
  max: number;
  hint: string;
}

export const EZ_TUNE_DEFAULTS: INavEzTune = {
  enabled: false,
  filterHz: 110,
  axisRatio: 110,
  response: 100,
  damping: 100,
  stability: 100,
  aggressiveness: 100,
  rate: 100,
  expo: 100,
  snappiness: 0,
};

export const EZ_TUNE_FIELDS: readonly EzTuneField[] = [
  { key: "filterHz", label: "Filter cutoff", min: 20, max: 300, hint: "Gyro low-pass filter cutoff in Hz" },
  { key: "axisRatio", label: "Axis ratio", min: 25, max: 175, hint: "Pitch gains as a percentage of roll" },
  { key: "response", label: "Response", min: 0, max: 200, hint: "Overall stick response" },
  { key: "damping", label: "Damping", min: 0, max: 200, hint: "Oscillation suppression" },
  { key: "stability", label: "Stability", min: 0, max: 200, hint: "Position-hold authority" },
  { key: "aggressiveness", label: "Aggressiveness", min: 0, max: 200, hint: "Flip and roll authority" },
  { key: "rate", label: "Rate", min: 0, max: 200, hint: "Maximum rotation rate" },
  { key: "expo", label: "Expo", min: 0, max: 200, hint: "Stick expo curve" },
  { key: "snappiness", label: "Snappiness", min: 0, max: 100, hint: "Quick-stop precision" },
];

/** The first field outside its firmware range, described, or null when all fit. */
export function ezTuneRangeError(values: INavEzTune): string | null {
  for (const f of EZ_TUNE_FIELDS) {
    const v = values[f.key];
    if (!Number.isFinite(v) || v < f.min || v > f.max) {
      return `${f.label} must be ${f.min} to ${f.max} (is ${v})`;
    }
  }
  return null;
}
