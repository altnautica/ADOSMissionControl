/**
 * @module agent/history
 * @description Bounded utilisation-history series for the agent resource
 * charts. Pure: no React, no Zustand.
 * @license GPL-3.0-only
 */

/**
 * Append a utilisation sample to a bounded history series, oldest first.
 *
 * A sample of `undefined` appends nothing and returns the series unchanged.
 * A heartbeat that carried no reading is not a measurement of zero load, and a
 * chart that plots it as one shows a dip that never happened. Skipping the
 * sample leaves the series showing only figures the node actually reported.
 *
 * Returns the same array reference when nothing was appended so a caller can
 * cheaply detect a no-op.
 */
export function appendHistorySample(
  history: number[],
  sample: number | undefined,
  max: number,
): number[] {
  if (sample == null || !Number.isFinite(sample)) return history;
  const next = [...history, sample];
  while (next.length > max) next.shift();
  return next;
}
