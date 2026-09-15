"use client";

/**
 * @module hooks/use-hud-instruments
 * @description Freshness-gated, FRAME-ALIGNED telemetry read for the
 * glass-cockpit instruments (attitude indicator, speed/alt tapes, flight-path
 * marker, heading). The derivation itself lives in `@/lib/hud-readings`,
 * shared with the canvas HUDs' rAF loop, so a DOM instrument and the canvas
 * beside it cannot disagree about whether a reading is known. A stale/absent
 * sample yields `null`, so an instrument shows "—" rather than a fabricated 0
 * (Rule 44). Re-renders are driven by the store's `_version` freshness
 * signal; ring-buffer refs are stable.
 *
 * ## Frame alignment
 *
 * Every consumer of this hook is composited OVER the video. Feeding it
 * `latest()` paints the newest telemetry onto a frame captured 180-240 ms
 * earlier, so through a manoeuvre the horizon, speed and altitude an operator
 * reads are ahead of the picture they are read against — at 15 m/s that is
 * ~3.5 m of position error and a visibly out-of-phase horizon through a roll,
 * the FPV desync that induces pilot-induced oscillation. Each channel is
 * therefore sampled at `now - frameAgeMs` through the ring buffers'
 * nearest-timestamp lookup, so an instrument travels with its frame.
 *
 * The derivation is untouched: it still receives one sample per channel and
 * still owns every freshness verdict. Only WHICH sample it receives changed.
 *
 * When no estimator knows the frame age (`useVideoFrameAge` returns null) the
 * offset is zero and the lookup collapses to the newest sample — the prior
 * behaviour, and the only honest default. The cockpit states that the age is
 * unknown rather than implying an alignment it did not achieve.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { deriveHudInstruments, type HudInstruments } from "@/lib/hud-readings";
import type { Timestamped } from "@/lib/telemetry/freshness";

/** Timestamp accessor for the nearest-sample lookup. */
const sampleTs = (s: Timestamped): number => s.timestamp;

export type { HudInstruments } from "@/lib/hud-readings";

export function useHudInstruments(): HudInstruments {
  const version = useTelemetryStore((s) => s._version);
  const attitudeBuf = useTelemetryStore((s) => s.attitude);
  const positionBuf = useTelemetryStore((s) => s.position);
  const vfrBuf = useTelemetryStore((s) => s.vfr);
  const frameAgeMs = useVideoFrameAge()?.ms ?? 0;

  return useMemo<HudInstruments>(() => {
    const at = Date.now() - frameAgeMs;
    return deriveHudInstruments({
      attitude: attitudeBuf.nearest(at, sampleTs),
      position: positionBuf.nearest(at, sampleTs),
      vfr: vfrBuf.nearest(at, sampleTs),
    });
    // version is the freshness trigger; buffer refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, attitudeBuf, positionBuf, vfrBuf, frameAgeMs]);
}
