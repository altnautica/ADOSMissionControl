/**
 * Group recorded telemetry frames into per-channel typed series for charting.
 *
 * Used by the History detail Charts tab and the Compare modal.
 *
 * @module flight-analysis/series-builder
 * @license GPL-3.0-only
 */

import { knownRemainingPct } from "@/lib/battery";

export interface SeriesPoint {
  /** Seconds since flight start. */
  t: number;
}

export interface SeriesData {
  altitude: (SeriesPoint & { alt: number })[];
  speed: (SeriesPoint & { gs?: number; as?: number })[];
  battery: (SeriesPoint & { v?: number; pct?: number })[];
  attitude: (SeriesPoint & { roll: number; pitch: number; yaw: number })[];
  gps: (SeriesPoint & { sats?: number; hdop?: number })[];
  vibration: (SeriesPoint & { vx?: number; vy?: number; vz?: number })[];
}

export const EMPTY_SERIES: SeriesData = {
  altitude: [],
  speed: [],
  battery: [],
  attitude: [],
  gps: [],
  vibration: [],
};

interface PositionFrame { relativeAlt?: number; groundSpeed?: number }
interface VfrFrame { groundspeed?: number; airspeed?: number }
interface BatteryFrame { voltage?: number; remaining?: number }
/** Recorded attitude is in degrees, the same contract as live `AttitudeData`. */
interface AttitudeFrame { roll?: number; pitch?: number; yaw?: number }
interface GpsFrame { satellites?: number; hdop?: number }
interface VibrationFrame { vibrationX?: number; vibrationY?: number; vibrationZ?: number }

interface RawFrame {
  offsetMs: number;
  channel: string;
  data: unknown;
}

/**
 * Build chart series from recorded frames. Altitude is height above home
 * (`relativeAlt`); the AMSL `alt` of position and VFR_HUD frames is never
 * plotted on the same axis.
 */
export function buildSeries(frames: RawFrame[]): SeriesData {
  const out: SeriesData = {
    altitude: [],
    speed: [],
    battery: [],
    attitude: [],
    gps: [],
    vibration: [],
  };
  for (const f of frames) {
    const t = f.offsetMs / 1000;
    if (f.channel === "position" || f.channel === "globalPosition") {
      const d = f.data as PositionFrame;
      if (typeof d.relativeAlt === "number") out.altitude.push({ t, alt: d.relativeAlt });
      if (typeof d.groundSpeed === "number") out.speed.push({ t, gs: d.groundSpeed });
    } else if (f.channel === "vfr") {
      const d = f.data as VfrFrame;
      out.speed.push({ t, gs: d.groundspeed, as: d.airspeed });
    } else if (f.channel === "battery") {
      const d = f.data as BatteryFrame;
      const pct = knownRemainingPct(d.remaining) ?? undefined;
      out.battery.push({ t, v: d.voltage, pct });
    } else if (f.channel === "attitude") {
      const d = f.data as AttitudeFrame;
      out.attitude.push({
        t,
        roll: d.roll ?? 0,
        pitch: d.pitch ?? 0,
        yaw: d.yaw ?? 0,
      });
    } else if (f.channel === "gps") {
      const d = f.data as GpsFrame;
      out.gps.push({ t, sats: d.satellites, hdop: d.hdop });
    } else if (f.channel === "vibration") {
      const d = f.data as VibrationFrame;
      out.vibration.push({
        t,
        vx: d.vibrationX,
        vy: d.vibrationY,
        vz: d.vibrationZ,
      });
    }
  }
  return out;
}

/** Default point budget for one rendered chart panel. */
export const CHART_MAX_POINTS = 1500;

/**
 * Reduce `points` to about `maxPoints` for rendering while keeping the shape:
 * the series is cut into equal buckets and each bucket keeps, for every key,
 * the samples holding its minimum and maximum. Spikes survive, flat runs
 * shrink. The first and last samples are always kept so the time axis still
 * spans the whole flight. Returns `points` itself when already small enough.
 */
export function downsampleSeries<T extends SeriesPoint>(
  points: T[],
  keys: readonly string[],
  maxPoints: number = CHART_MAX_POINTS,
): T[] {
  if (points.length <= maxPoints) return points;
  const buckets = Math.max(1, Math.floor(maxPoints / (2 * Math.max(1, keys.length))));
  const size = points.length / buckets;
  const out: T[] = [points[0]];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(points.length, Math.floor((b + 1) * size));
    const picks = new Set<number>();
    for (const key of keys) {
      let minI = -1;
      let maxI = -1;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = start; i < end; i++) {
        const v: unknown = Reflect.get(points[i], key);
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        if (v < minV) {
          minV = v;
          minI = i;
        }
        if (v > maxV) {
          maxV = v;
          maxI = i;
        }
      }
      if (minI >= 0) picks.add(minI);
      if (maxI >= 0) picks.add(maxI);
    }
    if (picks.size === 0 && start < end) picks.add(start);
    for (const i of Array.from(picks).sort((a, c) => a - c)) {
      if (i !== 0 && i !== points.length - 1) out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
