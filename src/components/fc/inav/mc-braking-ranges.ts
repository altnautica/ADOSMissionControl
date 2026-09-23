/**
 * @module mc-braking-ranges
 * @description Firmware ranges of the iNav nav_mc_braking_* settings. The
 * MSP2_INAV_SET_MC_BRAKING frame carries boost factor and bank angle as u8 and
 * the rest as u16, so a value outside these ranges would wrap on the wire.
 * @license GPL-3.0-only
 */

import type { INavMcBraking } from "@/lib/protocol/msp/msp-decoders-inav";

export const MC_BRAKING_RANGES: Record<keyof INavMcBraking, { min: number; max: number }> = {
  speedThreshold: { min: 0, max: 1000 },
  disengageSpeed: { min: 0, max: 1000 },
  timeout: { min: 100, max: 5000 },
  boostFactor: { min: 0, max: 200 },
  boostTimeout: { min: 0, max: 5000 },
  boostSpeedThreshold: { min: 100, max: 1000 },
  boostDisengage: { min: 0, max: 1000 },
  bankAngle: { min: 15, max: 60 },
};

/** Every field clamped into its firmware range, plus the fields that moved. */
export function clampMcBraking(b: INavMcBraking): { value: INavMcBraking; adjusted: (keyof INavMcBraking)[] } {
  const value = { ...b };
  const adjusted: (keyof INavMcBraking)[] = [];
  for (const key of Object.keys(MC_BRAKING_RANGES) as (keyof INavMcBraking)[]) {
    const { min, max } = MC_BRAKING_RANGES[key];
    const clamped = Math.min(max, Math.max(min, Math.round(b[key])));
    if (clamped !== b[key]) adjusted.push(key);
    value[key] = clamped;
  }
  return { value, adjusted };
}
