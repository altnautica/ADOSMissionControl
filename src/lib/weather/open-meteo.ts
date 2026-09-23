/**
 * @module weather/open-meteo
 * @description Keyless flight-weather fetch over the free Open-Meteo forecast
 * API (no API key, non-commercial CC-BY 4.0). `fetchWeather` returns a typed
 * `WeatherReport` carrying surface wind (speed / gust / direction), air
 * temperature, winds-aloft at a few altitude levels, and a short near-term peak
 * gust forecast — or `null` on any failure (offline / non-200 / malformed /
 * abort). It never fabricates a reading. Callers in demo mode MUST NOT invoke
 * this (no live network in demo); the card substitutes a labelled mock instead.
 * @license GPL-3.0-only
 */

const API_URL = "https://api.open-meteo.com/v1/forecast";

/** Altitude levels (metres above ground) requested for winds-aloft, low→high. */
export const WINDS_ALOFT_LEVELS_M = [80, 120, 180] as const;

/** Hours of near-term hourly forecast pulled for the peak-gust lookahead. */
export const FORECAST_LOOKAHEAD_HOURS = 6;

/** Wind at a single altitude level. `null` fields mean the API omitted them. */
export interface WindLevel {
  /** Height above ground in metres (e.g. 80, 120, 180). */
  heightM: number;
  /** Wind speed in m/s, or `null` if unavailable. */
  speedMps: number | null;
  /** Direction the wind blows FROM, in degrees clockwise from north, or `null`. */
  directionDeg: number | null;
}

/** Parsed, unit-normalised flight-weather snapshot (all speeds in m/s). */
export interface WeatherReport {
  /** Observation time of the current values, epoch ms (UTC), or `null` if not provided. */
  observedAt: number | null;
  /** Surface (10 m) sustained wind speed in m/s, or `null`. */
  windSpeedMps: number | null;
  /** Surface (10 m) wind gust in m/s, or `null`. */
  windGustMps: number | null;
  /** Surface wind direction (from) in degrees, or `null`. */
  windDirectionDeg: number | null;
  /** Air temperature at 2 m in °C, or `null`. */
  temperatureC: number | null;
  /** Winds-aloft levels the API returned; empty when none are available. */
  levels: WindLevel[];
  /** Peak gust over the near-term forecast window (m/s), or `null`. */
  forecastPeakGustMps: number | null;
  /** Number of hours the peak-gust forecast covers, or `null`. */
  forecastWindowHours: number | null;
}

interface OpenMeteoCurrent {
  time?: string;
  [key: string]: number | string | undefined;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
  hourly?: { wind_gusts_10m?: Array<number | null> };
}

/** Coerce an unknown API value to a finite number, or `null`. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Map a raw Open-Meteo response onto the typed report. */
/**
 * Open-Meteo reports local ISO times without an offset in the requested
 * timezone; the request asks for GMT, so the time is read as UTC.
 */
function parseGmtTime(time: unknown): number | null {
  if (typeof time !== "string") return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(time) ? time : `${time}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function parseReport(data: OpenMeteoResponse): WeatherReport {
  const c: OpenMeteoCurrent = data.current ?? {};

  const levels: WindLevel[] = WINDS_ALOFT_LEVELS_M.map((m) => ({
    heightM: m,
    speedMps: num(c[`wind_speed_${m}m`]),
    directionDeg: num(c[`wind_direction_${m}m`]),
  })).filter((l) => l.speedMps !== null || l.directionDeg !== null);

  const gusts = data.hourly?.wind_gusts_10m ?? [];
  let peak: number | null = null;
  for (const g of gusts) {
    const n = num(g);
    if (n !== null && (peak === null || n > peak)) peak = n;
  }

  return {
    observedAt: parseGmtTime(c.time),
    windSpeedMps: num(c.wind_speed_10m),
    windGustMps: num(c.wind_gusts_10m),
    windDirectionDeg: num(c.wind_direction_10m),
    temperatureC: num(c.temperature_2m),
    levels,
    forecastPeakGustMps: peak,
    forecastWindowHours: gusts.length > 0 ? gusts.length : null,
  };
}

/**
 * Fetch current wind + winds-aloft + a short gust forecast for a location.
 * Returns `null` on any failure (offline / error / malformed / abort) — never a
 * fabricated reading. Speeds are requested in m/s so no unit conversion is done
 * downstream.
 */
export async function fetchWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<WeatherReport | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const currentVars = [
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "temperature_2m",
    ...WINDS_ALOFT_LEVELS_M.flatMap((m) => [
      `wind_speed_${m}m`,
      `wind_direction_${m}m`,
    ]),
  ];

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: currentVars.join(","),
    hourly: "wind_gusts_10m",
    wind_speed_unit: "ms",
    timezone: "GMT",
    forecast_hours: String(FORECAST_LOOKAHEAD_HOURS),
  });

  try {
    const res = await fetch(`${API_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) {
      console.warn(`[weather] Open-Meteo returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as OpenMeteoResponse;
    return parseReport(data);
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn("[weather] Open-Meteo fetch failed:", err);
    }
    return null;
  }
}
