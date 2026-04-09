/**
 * Parse an aviationweather.gov METAR JSON record into our normalized
 * {@link WeatherSnapshot} shape.
 *
 * The API is public, no key, and returns a stable JSON schema documented
 * at `https://aviationweather.gov/data/api/`. Fields we consume:
 *
 *   - `icaoId` — 4-letter station code
 *   - `name` — friendly name
 *   - `lat` / `lon` — station position
 *   - `obsTime` — UNIX seconds of observation
 *   - `temp` / `dewp` — degrees C
 *   - `wdir` / `wspd` / `wgst` — direction (deg), speed (kt), gust (kt)
 *   - `visib` — visibility in statute miles; may be string "6+"
 *   - `altim` — altimeter in hPa
 *   - `rawOb` — raw METAR string
 *   - `clouds[]` — [{ cover: "FEW"|"SCT"|"BKN"|"OVC"|"CLR"|..., base: ft AGL }]
 *
 * @module environment/metar-parser
 * @license GPL-3.0-only
 */

import type { WeatherSnapshot } from "@/lib/types";

/** Raw row shape from aviationweather.gov/api/data/metar?format=json. */
export interface AwcMetarRow {
  metar_id?: number;
  icaoId?: string;
  name?: string;
  lat?: number;
  lon?: number;
  obsTime?: number;
  reportTime?: string;
  temp?: number | null;
  dewp?: number | null;
  wdir?: number | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: number | string | null;
  altim?: number | null;
  rawOb?: string;
  clouds?: { cover?: string; base?: number | null }[];
  mostRecent?: number;
}

function numOrUndef(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Parse the visibility field. aviationweather.gov sends either a number
 * (statute miles) or a string like `"6+"` for "6 or greater" or `"10"`.
 */
function parseVisibility(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const s = v.toString().replace("+", "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Derive the lowest BKN or OVC cloud layer in feet AGL. "Ceiling" is the
 * FAA definition — SKC / FEW / SCT do NOT contribute. Returns undefined
 * when there are no broken or overcast layers (effectively "unlimited").
 */
function parseCeiling(clouds: AwcMetarRow["clouds"]): number | undefined {
  if (!clouds || clouds.length === 0) return undefined;
  let best: number | undefined;
  for (const c of clouds) {
    const cover = c.cover ?? "";
    if (cover !== "BKN" && cover !== "OVC") continue;
    const base = c.base;
    if (typeof base !== "number") continue;
    if (best === undefined || base < best) best = base;
  }
  return best;
}

/**
 * Derive FAA flight category from ceiling + visibility.
 *
 *   LIFR: ceiling <500 ft OR visibility < 1 mi
 *   IFR:  ceiling 500–999 ft OR visibility 1 to <3 mi
 *   MVFR: ceiling 1000–3000 ft OR visibility 3 to 5 mi
 *   VFR:  ceiling >3000 ft AND visibility >5 mi
 *
 * An undefined ceiling is treated as unlimited.
 */
function deriveFlightCategory(
  visibilityMi: number | undefined,
  ceilingFt: number | undefined,
): WeatherSnapshot["flightCategory"] {
  const vis = visibilityMi ?? 99;
  const ceil = ceilingFt ?? 99_000;
  if (ceil < 500 || vis < 1) return "LIFR";
  if (ceil < 1000 || vis < 3) return "IFR";
  if (ceil <= 3000 || vis <= 5) return "MVFR";
  return "VFR";
}

export function parseAwcMetar(row: AwcMetarRow, stationDistanceKm?: number): WeatherSnapshot {
  const obsMs = typeof row.obsTime === "number" ? row.obsTime * 1000 : Date.now();
  const visibilityMi = parseVisibility(row.visib);
  const ceilingFt = parseCeiling(row.clouds);

  return {
    observedAt: new Date(obsMs).toISOString(),
    stationIcao: row.icaoId ?? "",
    stationName: row.name ?? undefined,
    stationLat: numOrUndef(row.lat),
    stationLon: numOrUndef(row.lon),
    stationDistanceKm,
    tempC: numOrUndef(row.temp),
    dewPointC: numOrUndef(row.dewp),
    windDirDeg: numOrUndef(row.wdir),
    windKts: numOrUndef(row.wspd),
    gustKts: numOrUndef(row.wgst),
    visibilityMi,
    ceilingFtAgl: ceilingFt,
    altimeterHpa: numOrUndef(row.altim),
    flightCategory: deriveFlightCategory(visibilityMi, ceilingFt),
    rawMetar: row.rawOb ?? undefined,
  };
}
