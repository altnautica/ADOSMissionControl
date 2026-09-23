/**
 * Battery pack state of health.
 *
 * Cycle-based linear degradation model: LiPo packs typically lose ~0.04% per
 * cycle in light use and ~0.08% in heavy use; 0.05% is a conservative middle
 * ground. An operator-entered `healthOverridePercent` wins over the
 * projection.
 *
 * @license GPL-3.0-only
 */

import type { BatteryPack } from "@/lib/types/operator";

const HEALTH_LOSS_PER_CYCLE_PCT = 0.05;

/** A pack's state of health 0..100: the operator's override, else the cycle projection. */
export function batteryHealthPercent(pack: BatteryPack): number {
  if (pack.healthOverridePercent !== undefined) return pack.healthOverridePercent;
  return Math.max(0, 100 - (pack.cycleCount ?? 0) * HEALTH_LOSS_PER_CYCLE_PCT);
}
