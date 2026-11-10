// Readout formatters every ground surface shares, so the same value reads the
// same everywhere. A missing or non-finite value reads "—".

const NO_DATA = "—";

/** One decimal with its sign, e.g. a climb rate: "1.2", "-0.4". A value that
 *  rounds to zero reads "0.0", never "-0.0". */
export function fmtSigned1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NO_DATA;
  return Math.abs(v) < 0.05 ? "0.0" : v.toFixed(1);
}

/** A distance: whole metres below 1 km ("120 m"), kilometres with two
 *  decimals from 1 km on ("1.25 km"), as Mission Control's bottom row. */
export function fmtDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return NO_DATA;
  return Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** Whole seconds left on a countdown: 1.2 s left reads 2, never below 0. */
export function countdownS(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
