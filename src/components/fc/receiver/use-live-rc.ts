/**
 * @module fc/receiver/use-live-rc
 * @description The latest RC_CHANNELS frame, re-read on every telemetry push
 * and on the shared 1 Hz clock, and dropped once it is older than
 * `TELEMETRY_STALE_MS`. Calibration and trim flows capture stick positions
 * from this value, so a frozen or stale frame must never stand in for live
 * sticks.
 * @license GPL-3.0-only
 */

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";
import type { RcData } from "@/lib/types/telemetry";

export function useLiveRc(): RcData | undefined {
  const rcBuffer = useTelemetryStore((s) => s.rc);
  // Both subscriptions only force a re-render: the ring buffer instance is
  // stable, so without them `latest()` would be read once and never again.
  useTelemetryStore((s) => s._version);
  useClockTick();
  return freshOnly(rcBuffer.latest(), Date.now());
}
