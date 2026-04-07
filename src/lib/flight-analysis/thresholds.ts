/**
 * Tunable thresholds for {@link analyzeFlight}.
 *
 * Constants only — no logic. Edit these to tune sensitivity without
 * touching the analyzer module.
 *
 * @license GPL-3.0-only
 */

export const THRESHOLDS = {
  /** Battery remaining % triggering a "low" warning event. */
  batteryLowPct: 30,
  /** Battery remaining % triggering a "critical" error event. */
  batteryCriticalPct: 15,
  /** Vibration RMS magnitude (m/s²) for spike events. */
  vibrationSpikeRms: 30,
  /** Vibration RMS magnitude (m/s²) for the "vibration high" flag (mean). */
  vibrationHighRmsMean: 20,
  /** Min satellites for the "GPS quality poor" flag (mean). */
  gpsPoorMeanSats: 8,
  /** Max HDOP for the "GPS quality poor" flag (mean). */
  gpsPoorMeanHdop: 2,
  /** Sat-count drop within one sample to trigger a glitch event. */
  gpsGlitchSatDrop: 4,
  /** Battery voltage drop (V) within ~1 s to trigger a sag flag. */
  batterySagVolts: 1.0,
} as const;
