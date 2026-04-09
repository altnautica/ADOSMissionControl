/**
 * Sun + moon environmental snapshot.
 *
 * Pure function — no network, no permissions, no side effects. Wraps the
 * `suncalc` library in a normalized shape matching {@link SunMoonSnapshot}.
 * Used by the flight lifecycle to freeze environmental context into every
 * new FlightRecord on arm (Phase 14a).
 *
 * @module environment/sun-moon
 * @license GPL-3.0-only
 */

import SunCalc from "suncalc";
import type { SunMoonSnapshot } from "@/lib/types";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Classify the current daylight phase from a sun altitude in degrees.
 *
 * Thresholds follow the standard definitions used by astronomers and
 * aviation regulators:
 *  - > -0.833° (refraction-corrected horizon): day
 *  - -0.833° to -6°: civil twilight
 *  - -6° to -12°: nautical twilight
 *  - -12° to -18°: astronomical twilight
 *  - < -18°: night
 */
function classifyDaylight(sunAltDeg: number): SunMoonSnapshot["daylightPhase"] {
  if (sunAltDeg > -0.833) return "day";
  if (sunAltDeg > -6) return "civil_twilight";
  if (sunAltDeg > -12) return "nautical_twilight";
  if (sunAltDeg > -18) return "astronomical_twilight";
  return "night";
}

/**
 * Convert the suncalc `phase` value (0..1) into an English label.
 *
 * suncalc phase:
 *  - 0        new moon
 *  - 0.25     first quarter
 *  - 0.5      full moon
 *  - 0.75     last quarter
 */
function moonPhaseLabel(phase: number): string {
  // Normalize to [0, 1).
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p > 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

/**
 * True iff `when` falls inside either of the two golden-hour windows
 * (morning or evening), each defined by suncalc as the sun altitude
 * range roughly -4° to +6°.
 */
function isWithinGoldenHour(
  when: Date,
  morningStart: Date | undefined,
  morningEnd: Date | undefined,
  eveningStart: Date | undefined,
  eveningEnd: Date | undefined,
): boolean {
  const t = when.getTime();
  const inMorning =
    morningStart !== undefined &&
    morningEnd !== undefined &&
    !Number.isNaN(morningStart.getTime()) &&
    !Number.isNaN(morningEnd.getTime()) &&
    t >= morningStart.getTime() &&
    t <= morningEnd.getTime();
  const inEvening =
    eveningStart !== undefined &&
    eveningEnd !== undefined &&
    !Number.isNaN(eveningStart.getTime()) &&
    !Number.isNaN(eveningEnd.getTime()) &&
    t >= eveningStart.getTime() &&
    t <= eveningEnd.getTime();
  return inMorning || inEvening;
}

/** Return `Date.toISOString()` or `undefined` for invalid dates (polar regions). */
function safeIso(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  const t = date.getTime();
  if (Number.isNaN(t)) return undefined;
  return date.toISOString();
}

/**
 * Compute a {@link SunMoonSnapshot} for a given position and wall-clock
 * instant. Pure — safe to call from any context.
 *
 * `lat` / `lon` are in decimal degrees (WGS84). `whenMs` is a UNIX epoch
 * in milliseconds.
 */
export function computeSunMoon(lat: number, lon: number, whenMs: number): SunMoonSnapshot {
  const when = new Date(whenMs);
  const times = SunCalc.getTimes(when, lat, lon);
  const sunPos = SunCalc.getPosition(when, lat, lon);
  const moonPos = SunCalc.getMoonPosition(when, lat, lon);
  const moonIllum = SunCalc.getMoonIllumination(when);

  const sunAltitudeDeg = sunPos.altitude * RAD_TO_DEG;
  const sunAzimuthDeg = ((sunPos.azimuth * RAD_TO_DEG + 180) + 360) % 360;
  // suncalc returns azimuth measured from south; +180 to get compass (from north).

  const moonAltitudeDeg = moonPos.altitude * RAD_TO_DEG;
  const moonAzimuthDeg = ((moonPos.azimuth * RAD_TO_DEG + 180) + 360) % 360;

  // suncalc "goldenHourEnd" is the MORNING golden-hour end
  //   (i.e. when the morning warm-light window closes),
  // and "goldenHour" is the EVENING golden-hour start.
  // Morning golden-hour starts at sunrise; evening ends at sunset.
  // (Matching the convention used by standard photography tools.)
  const goldenHourMorningStart = times.sunrise;
  const goldenHourMorningEnd = times.goldenHourEnd;
  const goldenHourEveningStart = times.goldenHour;
  const goldenHourEveningEnd = times.sunset;

  return {
    computedAt: when.toISOString(),
    lat,
    lon,
    sunriseIso: safeIso(times.sunrise),
    sunsetIso: safeIso(times.sunset),
    civilDawnIso: safeIso(times.dawn),
    civilDuskIso: safeIso(times.dusk),
    goldenHourMorningStartIso: safeIso(goldenHourMorningStart),
    goldenHourMorningEndIso: safeIso(goldenHourMorningEnd),
    goldenHourEveningStartIso: safeIso(goldenHourEveningStart),
    goldenHourEveningEndIso: safeIso(goldenHourEveningEnd),
    daylightPhase: classifyDaylight(sunAltitudeDeg),
    inGoldenHour: isWithinGoldenHour(
      when,
      goldenHourMorningStart,
      goldenHourMorningEnd,
      goldenHourEveningStart,
      goldenHourEveningEnd,
    ),
    sunAltitudeDeg: Math.round(sunAltitudeDeg * 10) / 10,
    sunAzimuthDeg: Math.round(sunAzimuthDeg * 10) / 10,
    moonPhase: Math.round(moonIllum.phase * 1000) / 1000,
    moonIllumination: Math.round(moonIllum.fraction * 1000) / 1000,
    moonPhaseLabel: moonPhaseLabel(moonIllum.phase),
    moonAltitudeDeg: Math.round(moonAltitudeDeg * 10) / 10,
    moonAzimuthDeg: Math.round(moonAzimuthDeg * 10) / 10,
  };
}
