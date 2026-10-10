/**
 * @module hud-readings
 * @description The single freshness-gated telemetry read behind every HUD
 * instrument, canvas or DOM.
 *
 * Every reading here is nullable and every null means the same thing: no live
 * sample backs it. The HUD is the most safety-loaded widget in the product, so
 * an absent attitude has to render as an absent attitude — a `?? 0` fallback
 * draws a perfectly level horizon on an aircraft nobody is hearing from, and a
 * hardcoded bar count draws a full-strength radio meter on a dead link. Both
 * were live defects; both are impossible to reintroduce from here, because
 * there is no non-null path out of this module that is not backed by a fresh
 * sample.
 *
 * The canvas HUDs read through {@link readHudFrame} inside their rAF loop
 * (store `getState`, no React subscription); the DOM instruments read the same
 * derivation through `useHudInstruments`. One implementation, so the two can
 * never disagree about whether a value is known.
 *
 * @license GPL-3.0-only
 */

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { isTimestampFresh } from "@/hooks/use-telemetry-freshness";
import { bearing, mpsToKph } from "@/lib/telemetry-utils";
import { knownRemainingPct } from "@/lib/battery";
import type {
  AttitudeData,
  BatteryData,
  GpsData,
  HomePositionData,
  PositionData,
  RadioData,
  VfrData,
  WindData,
} from "@/lib/types/telemetry";
import type { ArmState, FlightMode } from "@/lib/types";

/**
 * Heartbeat age at which mode / arm state stop counting as live. A heartbeat
 * arrives at ~1 Hz, so this tolerates one dropped frame and no more: a mode
 * label is a claim about what the aircraft is doing right now.
 */
export const HEARTBEAT_FRESH_MS = 3000;

/**
 * Full-scale reading of a SiK radio's RADIO_STATUS rssi (device units, 0..254;
 * 255 is the field's "unknown" value).
 */
const SIK_RSSI_FULL_SCALE = 254;

/** RADIO_STATUS rssi value meaning "invalid / unknown". */
const RSSI_UNKNOWN = 255;

/** System id a SiK telemetry radio sends RADIO_STATUS as. */
const SIK_RADIO_SYSTEM_ID = 51;

/** Bars the signal meter can show. */
export const SIGNAL_BAR_COUNT = 4;

/**
 * Speed below which the velocity vector has no usable direction: at a hover
 * the flight-path marker would swing with sensor noise, so it is withheld.
 */
export const FPM_MIN_SPEED_MPS = 1;

/** Where the aircraft is actually going, relative to where its nose points. */
export interface FlightPath {
  /** Flight-path angle, degrees above (positive) or below the horizon. */
  gammaDeg: number;
  /** Track minus heading, degrees, -180..180 (positive = drifting right). */
  driftDeg: number;
}

export interface WindReading {
  /** Direction the wind blows FROM, degrees true. */
  fromDeg: number;
  /** Horizontal wind speed, m/s. */
  speedMps: number;
}

export interface HudInstruments {
  /** Pitch, degrees (nose-up positive). Null when attitude is stale. */
  pitch: number | null;
  /** Roll, degrees (right-wing-down positive). Null when attitude is stale. */
  roll: number | null;
  /**
   * Height above home (GLOBAL_POSITION_INT.relative_alt), meters. Null when
   * position is stale: VFR_HUD.alt is MSL, so it is no stand-in.
   */
  alt: number | null;
  /** Ground speed, m/s. */
  speedMps: number | null;
  /** Ground speed, km/h (derived). */
  speedKph: number | null;
  /** Heading, degrees. */
  heading: number | null;
  /** Vertical speed / climb, m/s. */
  climb: number | null;
  /** Indicated airspeed, m/s: only a fresh VFR_HUD airspeed above zero. */
  airspeed: number | null;
  /** Altitude above mean sea level (GLOBAL_POSITION_INT.alt), meters. */
  altMsl: number | null;
  /**
   * Velocity-vector marker from the GLOBAL_POSITION_INT NED velocity. Null
   * without a fresh vector, a heading to reference it to, or enough speed to
   * give it a direction.
   */
  flightPath: FlightPath | null;
  /** True bearing from the aircraft to the FC's home position, degrees. */
  homeBearing: number | null;
  /** Wind estimate (WIND message), null when none is fresh. */
  wind: WindReading | null;
}

export interface HudStatusReadings {
  /** Remaining battery, percent. */
  batteryPct: number | null;
  /** Satellites in the GPS solution. */
  satellites: number | null;
  /** True armed, false disarmed, null when no live heartbeat says either. */
  armed: boolean | null;
  /** Flight mode, null when no live heartbeat backs it. */
  mode: FlightMode | null;
  /**
   * Radio link strength, 0..{@link SIGNAL_BAR_COUNT}, or null when no fresh
   * RADIO_STATUS sample exists. 0 and null are different readings and the meter
   * must draw them differently: 0 is "the link is measured and it is dead",
   * null is "nothing has reported a link".
   */
  signalBars: number | null;
}

export type HudFrame = HudInstruments & HudStatusReadings;

/** Latest samples of the channels a HUD frame is built from. */
export interface HudSamples {
  attitude?: AttitudeData;
  position?: PositionData;
  vfr?: VfrData;
  battery?: BatteryData;
  gps?: GpsData;
  radio?: RadioData;
  wind?: WindData;
  /** The FC's latched HOME_POSITION; not age-gated (it is sent rarely). */
  home?: HomePositionData;
}

/** Signed smallest difference a - b, degrees, in -180..180. */
export function angleDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** Flight-path marker from a fresh NED velocity and the heading it is drawn against. */
export function deriveFlightPath(
  pos: PositionData | undefined,
  heading: number | null,
): FlightPath | null {
  if (heading === null || !pos) return null;
  const { vn, ve, vd } = pos;
  if (
    typeof vn !== "number" || typeof ve !== "number" || typeof vd !== "number" ||
    !Number.isFinite(vn) || !Number.isFinite(ve) || !Number.isFinite(vd)
  ) {
    return null;
  }
  const horizontal = Math.hypot(vn, ve);
  if (Math.hypot(horizontal, vd) < FPM_MIN_SPEED_MPS) return null;
  const gammaDeg = (Math.atan2(-vd, horizontal) * 180) / Math.PI;
  // A near-vertical climb or descent has no track; draw it on the centreline.
  const driftDeg =
    horizontal < FPM_MIN_SPEED_MPS / 2
      ? 0
      : angleDiff((Math.atan2(ve, vn) * 180) / Math.PI, heading);
  return { gammaDeg, driftDeg };
}

/** Flight state as the drone store holds it, for the heartbeat-gated readings. */
export interface HudFlightState {
  armState: ArmState;
  flightMode: FlightMode;
  lastHeartbeat: number;
}

/**
 * Attitude / navigation instruments. Pure over the samples so both the hook and
 * the canvas loop get identical answers for identical input.
 */
export function deriveHudInstruments(samples: HudSamples): HudInstruments {
  const { attitude: att, position: pos, vfr, wind: windSample, home } = samples;

  const attFresh = isTimestampFresh(att?.timestamp);
  const posFresh = isTimestampFresh(pos?.timestamp);
  const vfrFresh = isTimestampFresh(vfr?.timestamp);

  const pitch = attFresh && typeof att?.pitch === "number" ? att.pitch : null;
  const roll = attFresh && typeof att?.roll === "number" ? att.roll : null;

  const alt =
    posFresh && typeof pos?.relativeAlt === "number" ? pos.relativeAlt : null;

  const speedMps =
    vfrFresh && typeof vfr?.groundspeed === "number"
      ? vfr.groundspeed
      : posFresh && typeof pos?.groundSpeed === "number"
        ? pos.groundSpeed
        : null;

  const heading =
    posFresh && typeof pos?.heading === "number"
      ? pos.heading
      : vfrFresh && typeof vfr?.heading === "number"
        ? vfr.heading
        : null;

  const climb =
    vfrFresh && typeof vfr?.climb === "number"
      ? vfr.climb
      : posFresh && typeof pos?.climbRate === "number"
        ? pos.climbRate
        : null;

  const airspeed =
    vfrFresh && typeof vfr?.airspeed === "number" && vfr.airspeed > 0
      ? vfr.airspeed
      : null;

  const homeBearing =
    posFresh && pos && home && (pos.lat !== 0 || pos.lon !== 0)
      ? bearing(pos.lat, pos.lon, home.lat, home.lon)
      : null;

  const wind =
    windSample &&
    isTimestampFresh(windSample.timestamp) &&
    Number.isFinite(windSample.direction) &&
    Number.isFinite(windSample.speed)
      ? { fromDeg: windSample.direction, speedMps: windSample.speed }
      : null;

  return {
    pitch,
    roll,
    alt,
    speedMps,
    speedKph: speedMps !== null ? mpsToKph(speedMps) : null,
    heading,
    climb,
    airspeed,
    altMsl: posFresh && typeof pos?.alt === "number" ? pos.alt : null,
    flightPath: posFresh ? deriveFlightPath(pos, heading) : null,
    homeBearing,
    wind,
  };
}

/**
 * Bars from a RADIO_STATUS rssi reading. The field's units are defined by the
 * radio that sends it, so only a SiK radio's scale is mapped; any other source
 * (a video link that packs signed dBm into the byte, for one) reads as no
 * data rather than a guess. 255 is the field's "unknown" value. A fresh 0 rssi
 * from a SiK radio keeps 0 bars.
 */
export function signalBarsFromRssi(
  radio: RadioData | undefined,
): number | null {
  if (!isTimestampFresh(radio?.timestamp)) return null;
  if (typeof radio?.rssi !== "number" || !Number.isFinite(radio.rssi)) {
    return null;
  }
  if (radio.rssi === RSSI_UNKNOWN || radio.sourceSystemId !== SIK_RADIO_SYSTEM_ID) {
    return null;
  }
  const scaled = (radio.rssi / SIK_RSSI_FULL_SCALE) * SIGNAL_BAR_COUNT;
  return Math.max(0, Math.min(SIGNAL_BAR_COUNT, Math.round(scaled)));
}

/**
 * Battery / GPS / arm / mode / radio readings. Mode and arm state are gated on
 * heartbeat age rather than on attitude: they are heartbeat fields, and a
 * vehicle can publish attitude from a companion replay while the FC link is
 * gone.
 */
export function deriveHudStatus(
  samples: HudSamples,
  flight: HudFlightState,
): HudStatusReadings {
  const { battery: bat, gps, radio } = samples;
  const batFresh = isTimestampFresh(bat?.timestamp);
  const gpsFresh = isTimestampFresh(gps?.timestamp);
  const heartbeatFresh = isTimestampFresh(
    flight.lastHeartbeat || undefined,
    HEARTBEAT_FRESH_MS,
  );

  return {
    batteryPct: batFresh ? knownRemainingPct(bat?.remaining) : null,
    satellites:
      gpsFresh && typeof gps?.satellites === "number" ? gps.satellites : null,
    armed:
      heartbeatFresh && flight.armState !== "unknown"
        ? flight.armState === "armed"
        : null,
    mode: heartbeatFresh ? flight.flightMode : null,
    signalBars: signalBarsFromRssi(radio),
  };
}

/**
 * One HUD frame read straight from the live stores. Called from a rAF loop, so
 * it takes no React subscription and allocates one object per frame.
 */
export function readHudFrame(): HudFrame {
  const t = useTelemetryStore.getState();
  const d = useDroneStore.getState();
  const samples: HudSamples = {
    attitude: t.attitude.latest(),
    position: t.position.latest(),
    vfr: t.vfr.latest(),
    battery: t.battery.latest(),
    gps: t.gps.latest(),
    radio: t.radio.latest(),
    wind: t.wind.latest(),
    home: t.homePosition.latest(),
  };
  return {
    ...deriveHudInstruments(samples),
    ...deriveHudStatus(samples, {
      armState: d.armState,
      flightMode: d.flightMode,
      lastHeartbeat: d.lastHeartbeat,
    }),
  };
}
