"use client";

// Single-shot read of the four ring buffers feeding the HUD top bar and the
// cockpit safety band.
//
// Deliberately not memoized. The result depends on wall-clock time (a sample
// that was fresh last render can be stale this one), which no dependency array
// can express — a `useMemo` here has to list its invalidation signals without
// referencing them, which is both a lie to the linter and a memo that saves
// nothing, since both signals change at least once a second. Reading four
// ring-buffer tails and comparing four timestamps is cheaper than the memo
// bookkeeping around it.
//
// Two subscriptions drive the re-render, and both are load-bearing:
//   _version  — new telemetry arrived.
//   clock tick — time passed. On link loss no telemetry arrives, so `_version`
//                stops changing and nothing would re-render; the stale values
//                would stay painted on screen however the gate below is
//                written. The tick is what makes staleness observable.

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";
import type { RadioData, VfrData, BatteryData, GpsData } from "@/lib/types";

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

export function useHudTopBarData(): HudTopBarData {
  useTelemetryStore((s) => s._version);
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
    radio: freshOnly(radio, now),
    vfr: freshOnly(vfr, now),
    battery: freshOnly(battery, now),
    gps: freshOnly(gps, now),
    lastSampleAt,
  };
}
