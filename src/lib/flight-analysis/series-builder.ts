/**
 * Group recorded telemetry frames into per-channel typed series for charting.
 *
 * Used by the History detail Charts tab and the Compare modal.
 *
 * @module flight-analysis/series-builder
 * @license GPL-3.0-only
 */

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

interface PositionFrame { relativeAlt?: number; alt?: number; groundSpeed?: number }
interface VfrFrame { groundspeed?: number; airspeed?: number; alt?: number }
interface BatteryFrame { voltage?: number; remaining?: number }
interface AttitudeFrame { roll: number; pitch: number; yaw: number }
interface GpsFrame { satellites?: number; hdop?: number }
interface VibrationFrame { vibrationX?: number; vibrationY?: number; vibrationZ?: number }

interface RawFrame {
  offsetMs: number;
  channel: string;
  data: unknown;
}

const toDeg = (rad: number) => (rad * 180) / Math.PI;

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
      const alt = typeof d.relativeAlt === "number" ? d.relativeAlt : d.alt;
      if (typeof alt === "number") out.altitude.push({ t, alt });
      if (typeof d.groundSpeed === "number") out.speed.push({ t, gs: d.groundSpeed });
    } else if (f.channel === "vfr") {
      const d = f.data as VfrFrame;
      out.speed.push({ t, gs: d.groundspeed, as: d.airspeed });
      if (typeof d.alt === "number") out.altitude.push({ t, alt: d.alt });
    } else if (f.channel === "battery") {
      const d = f.data as BatteryFrame;
      out.battery.push({ t, v: d.voltage, pct: d.remaining });
    } else if (f.channel === "attitude") {
      const d = f.data as AttitudeFrame;
      out.attitude.push({
        t,
        roll: toDeg(d.roll ?? 0),
        pitch: toDeg(d.pitch ?? 0),
        yaw: toDeg(d.yaw ?? 0),
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
