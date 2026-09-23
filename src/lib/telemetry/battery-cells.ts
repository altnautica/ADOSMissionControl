/**
 * @module telemetry/battery-cells
 * @description Series cell count for per-cell battery thresholds.
 *
 * BATTERY_STATUS carries per-cell voltages only when the FC monitors cells.
 * When it does not, the MAVLink spec puts the whole pack voltage in
 * voltages[0] and UINT16_MAX in the rest, so after the unused entries are
 * dropped a 4S pack arrives as `cellVoltages: [16.8]` — one "cell" at 16.8 V.
 * Counting entries would apply per-cell thresholds to the whole pack and never
 * alarm. Inferring the count from live pack voltage is just as wrong: a 4S
 * sagging to 14.0 V rounds to a healthy-looking 3S. So the count comes from
 * measured cells that are plausibly single Li cells, or from a count that is
 * known independently of the voltage, and otherwise it is unknown.
 *
 * @license GPL-3.0-only
 */

/** Lowest voltage a single lithium cell can plausibly report under load. */
export const MIN_PLAUSIBLE_CELL_V = 2.5;
/** Highest voltage a single lithium cell (including HV chemistries) reports. */
export const MAX_PLAUSIBLE_CELL_V = 4.5;

/**
 * The per-cell voltages when every entry is a plausible single cell,
 * otherwise `undefined` (not measured, or a whole-pack value in voltages[0]).
 */
export function plausibleCellVoltages(
  cellVoltages: readonly number[] | undefined,
): readonly number[] | undefined {
  if (!cellVoltages || cellVoltages.length === 0) return undefined;
  const allCells = cellVoltages.every(
    (v) => Number.isFinite(v) && v >= MIN_PLAUSIBLE_CELL_V && v <= MAX_PLAUSIBLE_CELL_V,
  );
  return allCells ? cellVoltages : undefined;
}

/**
 * Series cell count, or `null` when nothing establishes it.
 *
 * Measured cells win; then a count known independently of the live voltage
 * (the FC-reported count, the fitted pack). Never inferred from pack voltage.
 */
export function resolveCellCount(
  cellVoltages: readonly number[] | undefined,
  knownCellCount: number | null | undefined,
): number | null {
  const measured = plausibleCellVoltages(cellVoltages);
  if (measured) return measured.length;
  if (typeof knownCellCount === "number" && Number.isInteger(knownCellCount) && knownCellCount > 0) {
    return knownCellCount;
  }
  return null;
}
