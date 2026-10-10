"use client";

/**
 * @module hooks/use-hud-instruments
 * @description Freshness-gated, FRAME-ALIGNED telemetry read for the
 * glass-cockpit instruments (attitude indicator, flight-path marker, heading
 * tape, speed/alt tapes, vertical speed, wind). The derivation itself lives in
 * `@/lib/hud-readings`, shared with the canvas HUDs' rAF loop, so a DOM
 * instrument and the canvas beside it cannot disagree about whether a reading
 * is known. A stale/absent sample yields `null`, so an instrument shows "—"
 * rather than a fabricated 0.
 *
 * ## Once per animation frame
 *
 * The hook takes no subscription to the telemetry store's `_version`. It runs
 * one `requestAnimationFrame` loop, derives the instruments once per frame,
 * and commits a new reading to React only when a value actually changed. So:
 *
 * - a burst of telemetry between two frames costs one derivation, not one per
 *   sample;
 * - a silent link still decays on time: every reading is gated against
 *   `Date.now()` at derivation time, and the loop keeps deriving, so a sample
 *   crossing the freshness threshold blanks its instrument on the next frame;
 * - only the component that calls this hook re-renders. Call it ONCE per
 *   instrument cluster (the cockpit `HudLayer`) and pass the reading down.
 *
 * ## Frame alignment
 *
 * Every consumer of this hook is composited OVER the video. Feeding it
 * `latest()` paints the newest telemetry onto a frame captured 180-240 ms
 * earlier, so through a manoeuvre the horizon, speed and altitude an operator
 * reads are ahead of the picture they are read against. Each channel is
 * therefore sampled at `now - frameAgeMs` through the ring buffers'
 * nearest-timestamp lookup, so an instrument travels with its frame. When no
 * estimator knows the frame age (`useVideoFrameAge` returns null) the offset
 * is zero and the lookup collapses to the newest sample.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { deriveHudInstruments, type HudInstruments } from "@/lib/hud-readings";
import type { Timestamped } from "@/lib/telemetry/freshness";

/** Timestamp accessor for the nearest-sample lookup. */
const sampleTs = (s: Timestamped): number => s.timestamp;

export type { HudInstruments } from "@/lib/hud-readings";

/** Derive the instruments for the frame being shown `frameAgeMs` ago. */
export function readHudInstruments(frameAgeMs: number): HudInstruments {
  const t = useTelemetryStore.getState();
  const at = Date.now() - frameAgeMs;
  return deriveHudInstruments({
    attitude: t.attitude.nearest(at, sampleTs),
    position: t.position.nearest(at, sampleTs),
    vfr: t.vfr.nearest(at, sampleTs),
    wind: t.wind.nearest(at, sampleTs),
    // Home is latched, not a time series: the newest one is the one in force.
    home: t.homePosition.latest(),
  });
}

/** Whether two readings would draw identically. */
export function sameHudInstruments(a: HudInstruments, b: HudInstruments): boolean {
  return (
    a.pitch === b.pitch &&
    a.roll === b.roll &&
    a.alt === b.alt &&
    a.altMsl === b.altMsl &&
    a.speedMps === b.speedMps &&
    a.airspeed === b.airspeed &&
    a.heading === b.heading &&
    a.climb === b.climb &&
    a.homeBearing === b.homeBearing &&
    a.flightPath?.gammaDeg === b.flightPath?.gammaDeg &&
    a.flightPath?.driftDeg === b.flightPath?.driftDeg &&
    a.wind?.fromDeg === b.wind?.fromDeg &&
    a.wind?.speedMps === b.wind?.speedMps
  );
}

export function useHudInstruments(): HudInstruments {
  const frameAgeMs = useVideoFrameAge()?.ms ?? 0;
  const frameAgeRef = useRef(frameAgeMs);
  const [reading, setReading] = useState<HudInstruments>(() =>
    readHudInstruments(frameAgeMs),
  );

  useEffect(() => {
    frameAgeRef.current = frameAgeMs;
  }, [frameAgeMs]);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const next = readHudInstruments(frameAgeRef.current);
      // Functional update keeps the previous object when nothing changed, so
      // React bails out of the render entirely.
      setReading((prev) => (sameHudInstruments(prev, next) ? prev : next));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return reading;
}
