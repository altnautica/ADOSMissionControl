"use client";

// Single-shot read of the four ring buffers feeding the cockpit safety band.
//
// Deliberately not memoized. The result depends on wall-clock time (a sample
// that was fresh last render can be stale this one), which no dependency array
// can express. Reading four ring-buffer tails and comparing four timestamps is
// cheaper than the memo bookkeeping around it.
//
// Two subscriptions drive the re-render, and both are load-bearing:
//   telemetry version — new telemetry arrived. Throttled to 4 Hz: the raw
//                       `_version` bumps once per frame, and a band that
//                       repaints at the telemetry rate buys the operator
//                       nothing a quarter-second cadence does not.
//   clock tick        — time passed. On link loss no telemetry arrives, so
//                       the version stops changing and nothing would
//                       re-render; the stale values would stay painted on
//                       screen. The tick is what makes staleness observable.
//
// Instruments go stale after two seconds: a safety readout older than that is
// dimmed to the no-data glyph instead of being shown as current.

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useClockTick } from "@/lib/agent/freshness";
import { TELEMETRY_FUTURE_SKEW_MS } from "@/lib/telemetry/freshness";
import type { RadioData, VfrData, BatteryData, GpsData } from "@/lib/types";

/** A band reading older than this is shown as no data. */
export const BAND_STALE_MS = 2_000;

export interface HudTopBarData {
  /** Fresh sample, or `undefined` once the reading goes stale. */
  radio: RadioData | undefined;
  vfr: VfrData | undefined;
  battery: BatteryData | undefined;
  gps: GpsData | undefined;
  /**
   * Newest timestamp across the four buffers, fresh or not, or `null` when
   * nothing has ever arrived. A surface that wants to say "last seen 12s ago"
   * instead of just blanking reads this.
   */
  lastSampleAt: number | null;
}

function bandFresh<T extends { timestamp: number }>(
  sample: T | undefined,
  now: number,
): T | undefined {
  if (sample === undefined || !Number.isFinite(sample.timestamp)) return undefined;
  const age = now - sample.timestamp;
  if (age < 0) return -age <= TELEMETRY_FUTURE_SKEW_MS ? sample : undefined;
  return age < BAND_STALE_MS ? sample : undefined;
}

export function useHudTopBarData(): HudTopBarData {
  useThrottledTelemetryVersion();
  useClockTick();

  const buffers = useTelemetryStore.getState();
  const now = Date.now();

  const radio = buffers.radio.latest();
  const vfr = buffers.vfr.latest();
  const battery = buffers.battery.latest();
  const gps = buffers.gps.latest();

  let lastSampleAt: number | null = null;
  for (const sample of [radio, vfr, battery, gps]) {
    const t = sample?.timestamp;
    if (typeof t === "number" && Number.isFinite(t)) {
      if (lastSampleAt === null || t > lastSampleAt) lastSampleAt = t;
    }
  }

  return {
    radio: bandFresh(radio, now),
    vfr: bandFresh(vfr, now),
    battery: bandFresh(battery, now),
    gps: bandFresh(gps, now),
    lastSampleAt,
  };
}
