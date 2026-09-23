/**
 * @module api/ground-station/calibration
 * @description Pure, agent-agnostic WFB link auto-calibration engine. Sweeps a
 * transmitter's (mcs, fec_k, fec_n) trio over a small grid, measures the
 * RECEIVER's decode-side link quality at each cell, scores each cell, and picks
 * the best safe trio. The sweep and measure are injected callbacks, so the
 * engine is fully unit-testable and carries no React or network code.
 *
 * The score is built ONLY from received-side signal (valid-decode rate, FEC
 * failures, loss, decoded goodput), never the transmitter's tx_bytes. An
 * advancing TX counter is never proof of a link.
 *
 * @license GPL-3.0-only
 */

export interface CalTrio {
  mcs: number;
  fecK: number;
  fecN: number;
}

/** A single decode-side sample read from the RECEIVER's radio snapshot. */
export interface CalMeasurement {
  /**
   * Epoch ms the receiver produced this snapshot, or null when the source
   * carries no stamp. A sample only scores a cell when it is newer than the
   * moment that cell's trio finished applying.
   */
  sampledAtMs: number | null;
  lossPercent: number | null;
  fecFailed: number | null;
  validRxPacketsPerS: number | null;
  bitrateKbps: number | null;
  rssiDbm: number | null;
}

export type CalVerdict = "ok" | "lossy" | "fec_fail" | "link_lost";

export interface CalCellResult {
  trio: CalTrio;
  /** Averaged measurement over the cell's measure window. */
  avg: CalMeasurement;
  /** Decoded goodput used for ranking (averaged bitrateKbps), or null. */
  goodputKbps: number | null;
  verdict: CalVerdict;
}

export interface CalConfig {
  grid: CalTrio[];
  settleMs: number;
  /** Distinct receiver snapshots, each newer than the sweep, scored per cell. */
  samples: number;
  /** How often the receiver snapshot is re-read while waiting for new samples. */
  pollMs: number;
  /**
   * How long after the settle window a cell may wait for `samples` fresh
   * snapshots. A cell that times out scores link_lost.
   */
  sampleTimeoutMs: number;
  lossThresholdPct: number;
}

export interface CalCallbacks {
  /** Apply a trio to the transmitter (e.g. drone setMcs + setFec). */
  sweep: (trio: CalTrio) => Promise<void>;
  /** Read one decode-side sample from the receiver's radio snapshot. */
  measure: () => Promise<CalMeasurement>;
  /** Injectable sleep (tests pass an instant resolver). */
  sleep: (ms: number) => Promise<void>;
  /** Injectable epoch-ms clock, on the same timebase as `sampledAtMs`. */
  now: () => number;
  /** Cooperative abort flag, polled between every async step. */
  signal?: { aborted: boolean };
  /** Per-cell progress callback. */
  onCell?: (done: number, total: number, cell: CalCellResult) => void;
}

// The default sweep grid: the three preset MCS values crossed with the FEC
// ladder, most-protected first. 3 x 4 = 12 cells. The receiver snapshot is a
// heartbeat that lands every ~5 s, so two fresh samples take up to ~10 s after
// the settle window (~2.5 min for the whole grid).
export const DEFAULT_GRID: CalTrio[] = (() => {
  const mcs = [1, 3, 5];
  const fec: Array<[number, number]> = [
    [8, 16],
    [8, 14],
    [8, 12],
    [8, 10],
  ];
  const out: CalTrio[] = [];
  for (const m of mcs) {
    for (const [k, n] of fec) out.push({ mcs: m, fecK: k, fecN: n });
  }
  return out;
})();

export const DEFAULT_CAL_CONFIG: CalConfig = {
  grid: DEFAULT_GRID,
  settleMs: 2500,
  samples: 2,
  pollMs: 1000,
  sampleTimeoutMs: 15000,
  lossThresholdPct: 2,
};

class AbortError extends Error {
  constructor() {
    super("calibration aborted");
    this.name = "AbortError";
  }
}

const NO_MEASUREMENT: CalMeasurement = {
  sampledAtMs: null,
  lossPercent: null,
  fecFailed: null,
  validRxPacketsPerS: null,
  bitrateKbps: null,
  rssiDbm: null,
};

/** Mean of the finite numbers in `xs`, or null when none are finite. */
function meanOf(xs: Array<number | null>): number | null {
  const finite = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/** Reduce a window of samples to a single averaged measurement. fecFailed is
 *  SUMMED (any unrecoverable block over the window is disqualifying); the rest
 *  are averaged. */
export function averageSamples(samples: CalMeasurement[]): CalMeasurement {
  const fecFailedVals = samples
    .map((s) => s.fecFailed)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const stamps = samples
    .map((s) => s.sampledAtMs)
    .filter((x): x is number => typeof x === "number");
  return {
    sampledAtMs: stamps.length ? Math.max(...stamps) : null,
    lossPercent: meanOf(samples.map((s) => s.lossPercent)),
    fecFailed: fecFailedVals.length ? fecFailedVals.reduce((a, b) => a + b, 0) : null,
    validRxPacketsPerS: meanOf(samples.map((s) => s.validRxPacketsPerS)),
    bitrateKbps: meanOf(samples.map((s) => s.bitrateKbps)),
    rssiDbm: meanOf(samples.map((s) => s.rssiDbm)),
  };
}

/** Classify one cell's averaged measurement against the safety constraints.
 *  A null measurement (no fresh sample arrived in time) is link_lost. */
export function evaluateCell(
  trio: CalTrio,
  avg: CalMeasurement | null,
  lossThresholdPct: number,
): CalCellResult {
  if (avg == null) {
    return { trio, avg: NO_MEASUREMENT, goodputKbps: null, verdict: "link_lost" };
  }
  let verdict: CalVerdict;
  if (avg.validRxPacketsPerS == null || avg.validRxPacketsPerS <= 0) {
    verdict = "link_lost";
  } else if (avg.fecFailed != null && avg.fecFailed > 0) {
    verdict = "fec_fail";
  } else if (avg.lossPercent != null && avg.lossPercent > lossThresholdPct) {
    verdict = "lossy";
  } else {
    verdict = "ok";
  }
  return { trio, avg, goodputKbps: avg.bitrateKbps, verdict };
}

/**
 * Pick the recommended trio from the scored cells.
 *
 * Among cells that passed every constraint ("ok"), maximize decoded goodput;
 * tie-break toward a lower MCS (more robust) then more parity (more headroom).
 * If NO cell is fully clean, fall back to the survivor with the lowest loss and
 * the most parity (best-effort on a marginal link) and flag it.
 */
export function pickBest(
  results: CalCellResult[],
): { best: CalCellResult | null; marginal: boolean } {
  const ok = results.filter((r) => r.verdict === "ok");
  if (ok.length > 0) {
    const best = [...ok].sort((a, b) => {
      const ga = a.goodputKbps ?? -Infinity;
      const gb = b.goodputKbps ?? -Infinity;
      if (gb !== ga) return gb - ga;
      if (a.trio.mcs !== b.trio.mcs) return a.trio.mcs - b.trio.mcs;
      return b.trio.fecN - b.trio.fecK - (a.trio.fecN - a.trio.fecK);
    })[0];
    return { best, marginal: false };
  }
  // No clean cell: among cells that at least decoded (not link_lost), prefer
  // the lowest loss, then the most parity, then the lowest MCS.
  const decoded = results.filter((r) => r.verdict !== "link_lost");
  if (decoded.length === 0) return { best: null, marginal: true };
  const best = [...decoded].sort((a, b) => {
    const la = a.avg.lossPercent ?? Infinity;
    const lb = b.avg.lossPercent ?? Infinity;
    if (la !== lb) return la - lb;
    const pa = a.trio.fecN - a.trio.fecK;
    const pb = b.trio.fecN - b.trio.fecK;
    if (pb !== pa) return pb - pa;
    return a.trio.mcs - b.trio.mcs;
  })[0];
  return { best, marginal: true };
}

function throwIfAborted(signal?: { aborted: boolean }): void {
  if (signal?.aborted) throw new AbortError();
}

export interface CalibrationOutcome {
  results: CalCellResult[];
  best: CalCellResult | null;
  marginal: boolean;
}

/**
 * Measure the link after a trio change that finished at `appliedAtMs`: wait
 * `settleMs`, then poll the receiver until `samples` distinct snapshots stamped
 * after `appliedAtMs` have arrived, and average them. A snapshot taken before
 * the change describes the previous trio, so it never counts, and the same
 * snapshot read twice counts once. Returns null when the samples do not arrive
 * within `sampleTimeoutMs` (the caller scores that as link_lost).
 */
export async function measureAfter(
  cfg: CalConfig,
  cb: Pick<CalCallbacks, "measure" | "sleep" | "now" | "signal">,
  appliedAtMs: number,
): Promise<CalMeasurement | null> {
  await cb.sleep(cfg.settleMs);
  throwIfAborted(cb.signal);
  const deadline = cb.now() + cfg.sampleTimeoutMs;
  const seen = new Set<number>();
  const samples: CalMeasurement[] = [];
  for (;;) {
    throwIfAborted(cb.signal);
    const sample = await cb.measure();
    const at = sample.sampledAtMs;
    if (at != null && at > appliedAtMs && !seen.has(at)) {
      seen.add(at);
      samples.push(sample);
      if (samples.length >= cfg.samples) return averageSamples(samples);
    }
    if (cb.now() >= deadline) return null;
    await cb.sleep(cfg.pollMs);
  }
}

/**
 * Run the full sweep. For each grid cell: apply the trio, measure it with
 * `measureAfter`, classify, and report progress. Returns all cell results plus
 * the recommended pick.
 *
 * The caller is responsible for restoring the last-good trio on abort/error
 * (this engine only sweeps forward); it re-throws an AbortError when the signal
 * trips so the caller's finally-block can revert.
 */
export async function runCalibration(
  cfg: CalConfig,
  cb: CalCallbacks,
): Promise<CalibrationOutcome> {
  const results: CalCellResult[] = [];
  const total = cfg.grid.length;

  for (let i = 0; i < cfg.grid.length; i++) {
    const trio = cfg.grid[i];
    throwIfAborted(cb.signal);
    await cb.sweep(trio);
    const avg = await measureAfter(cfg, cb, cb.now());
    const cell = evaluateCell(trio, avg, cfg.lossThresholdPct);
    results.push(cell);
    cb.onCell?.(i + 1, total, cell);
  }

  const { best, marginal } = pickBest(results);
  return { results, best, marginal };
}

export { AbortError };
