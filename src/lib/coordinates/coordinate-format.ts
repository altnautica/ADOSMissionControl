/**
 * @module coordinates/coordinate-format
 * @description Pure geodesy for converting WGS84 latitude/longitude to and from
 * UTM (Universal Transverse Mercator) and MGRS (Military Grid Reference System),
 * plus decimal-degree and degree/minute/second string formatting. No external
 * dependency: the Transverse Mercator forward/inverse use the standard truncated
 * series (Snyder, "Map Projections — A Working Manual"), accurate to well under a
 * metre inside a UTM zone. Used by the map coordinate readout and interop export.
 * @license GPL-3.0-only
 */

/** A UTM grid position on the WGS84 ellipsoid. */
export interface UTMCoordinate {
  /** UTM zone number, 1..60. */
  zone: number;
  /** "N" for the northern hemisphere, "S" for the southern. */
  hemisphere: "N" | "S";
  /** Easting in metres (false easting 500000 already applied). */
  easting: number;
  /** Northing in metres (false northing 10000000 applied in the south). */
  northing: number;
}

/** Decimal-degree latitude/longitude pair. */
export interface LatLonDeg {
  lat: number;
  lon: number;
}

// WGS84 ellipsoid + UTM projection constants.
const A = 6378137.0; // semi-major axis, metres
const K0 = 0.9996; // UTM central-meridian scale factor
const E = 0.00669438; // first eccentricity squared, e^2
const E2 = E * E;
const E3 = E2 * E;
const E_P2 = E / (1 - E); // second eccentricity squared, e'^2

// Meridional-arc series coefficients.
const M1 = 1 - E / 4 - (3 * E2) / 64 - (5 * E3) / 256;
const M2 = (3 * E) / 8 + (3 * E2) / 32 + (45 * E3) / 1024;
const M3 = (15 * E2) / 256 + (45 * E3) / 1024;
const M4 = (35 * E3) / 3072;

// Footpoint-latitude series coefficients (inverse).
const SQRT_E = Math.sqrt(1 - E);
const _E = (1 - SQRT_E) / (1 + SQRT_E);
const _E2 = _E * _E;
const _E3 = _E2 * _E;
const _E4 = _E3 * _E;
const _E5 = _E4 * _E;
const P2 = (3 / 2) * _E - (27 / 32) * _E3 + (269 / 512) * _E5;
const P3 = (21 / 16) * _E2 - (55 / 32) * _E4;
const P4 = (151 / 96) * _E3 - (417 / 128) * _E5;
const P5 = (1097 / 512) * _E4;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Wrap radians into (-PI, PI] so the meridian difference stays small. */
function wrapRad(v: number): number {
  const twoPi = 2 * Math.PI;
  let r = v % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

/**
 * UTM zone number for a lat/lon, with the Norway + Svalbard exceptions.
 * Longitude +180 is the same meridian as -180's zone 60 edge, so it maps to
 * zone 60, never a non-existent zone 61.
 */
export function utmZone(lat: number, lon: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return Math.min(60, Math.floor((lon + 180) / 6) + 1);
}

/**
 * Whether a latitude lies in the UTM/MGRS band [-80, 84). The polar caps use
 * the UPS grid instead, which this module does not produce.
 */
export function isWithinUtmBand(lat: number): boolean {
  return lat >= -80 && lat < 84;
}

/** Central-meridian longitude (degrees) of a UTM zone. */
function centralLon(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * Convert WGS84 lat/lon (degrees) to a UTM grid position. Valid for
 * -80 <= lat < 84 (the UTM band); check {@link isWithinUtmBand} first, since
 * outside it the projection is not a UTM coordinate.
 */
export function latLonToUTM(lat: number, lon: number): UTMCoordinate {
  const zone = utmZone(lat, lon);
  const latRad = lat * DEG;
  const latSin = Math.sin(latRad);
  const latCos = Math.cos(latRad);
  const latTan = latSin / latCos;
  const latTan2 = latTan * latTan;
  const latTan4 = latTan2 * latTan2;

  const n = A / Math.sqrt(1 - E * latSin * latSin);
  const c = E_P2 * latCos * latCos;
  const a = latCos * wrapRad((lon - centralLon(zone)) * DEG);
  const a2 = a * a;
  const a3 = a2 * a;
  const a4 = a3 * a;
  const a5 = a4 * a;
  const a6 = a5 * a;

  const m =
    A *
    (M1 * latRad -
      M2 * Math.sin(2 * latRad) +
      M3 * Math.sin(4 * latRad) -
      M4 * Math.sin(6 * latRad));

  const easting =
    K0 *
      n *
      (a +
        (a3 / 6) * (1 - latTan2 + c) +
        (a5 / 120) * (5 - 18 * latTan2 + latTan4 + 72 * c - 58 * E_P2)) +
    500000;

  let northing =
    K0 *
    (m +
      n *
        latTan *
        (a2 / 2 +
          (a4 / 24) * (5 - latTan2 + 9 * c + 4 * c * c) +
          (a6 / 720) * (61 - 58 * latTan2 + latTan4 + 600 * c - 330 * E_P2)));

  if (lat < 0) northing += 10000000;

  return { zone, hemisphere: lat < 0 ? "S" : "N", easting, northing };
}

/** Convert a UTM grid position back to WGS84 lat/lon (degrees). */
export function utmToLatLon(utm: UTMCoordinate): LatLonDeg {
  const x = utm.easting - 500000;
  let y = utm.northing;
  if (utm.hemisphere === "S") y -= 10000000;

  const m = y / K0;
  const mu = m / (A * M1);

  const pRad =
    mu +
    P2 * Math.sin(2 * mu) +
    P3 * Math.sin(4 * mu) +
    P4 * Math.sin(6 * mu) +
    P5 * Math.sin(8 * mu);

  const pSin = Math.sin(pRad);
  const pSin2 = pSin * pSin;
  const pCos = Math.cos(pRad);
  const pTan = pSin / pCos;
  const pTan2 = pTan * pTan;
  const pTan4 = pTan2 * pTan2;

  const epSin = 1 - E * pSin2;
  const n = A / Math.sqrt(epSin);
  const r = (1 - E) / epSin;
  const c = E_P2 * pCos * pCos;
  const c2 = c * c;

  const d = x / (n * K0);
  const d2 = d * d;
  const d3 = d2 * d;
  const d4 = d3 * d;
  const d5 = d4 * d;
  const d6 = d5 * d;

  const latitude =
    pRad -
    (pTan / r) *
      (d2 / 2 -
        (d4 / 24) * (5 + 3 * pTan2 + 10 * c - 4 * c2 - 9 * E_P2) +
        (d6 / 720) *
          (61 + 90 * pTan2 + 298 * c + 45 * pTan4 - 252 * E_P2 - 3 * c2));

  const longitude =
    (d -
      (d3 / 6) * (1 + 2 * pTan2 + c) +
      (d5 / 120) * (5 - 2 * c + 28 * pTan2 - 3 * c2 + 8 * E_P2 + 24 * pTan4)) /
    pCos;

  return {
    lat: latitude * RAD,
    lon: wrapRad(longitude + centralLon(utm.zone) * DEG) * RAD,
  };
}

// MGRS lettering tables. Latitude bands omit I and O; the 100km column and row
// letters use the standard I/O-skipping alphabets keyed by the zone number.
const LAT_BANDS = "CDEFGHJKLMNPQRSTUVWX";
const COL_LETTERS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROW_LETTERS = ["ABCDEFGHJKLMNPQRSTUV", "FGHJKLMNPQRSTUVABCDE"];

/** MGRS latitude band letter for a latitude in [-80, 84); null outside the band. */
export function mgrsLatBand(lat: number): string | null {
  if (!isWithinUtmBand(lat)) return null;
  const idx = Math.min(19, Math.floor((lat + 80) / 8)); // X spans 72..84 (12 degrees wide)
  return LAT_BANDS.charAt(idx);
}

/**
 * Convert WGS84 lat/lon (degrees) to an MGRS grid reference string, e.g.
 * "32ULB9520173135". `precision` is the number of digits per axis (1..5), so 5
 * is 1 m, 4 is 10 m, ... 1 is 10 km. No separating spaces (compact form).
 * Null for a latitude outside the MGRS band (the polar caps), rather than a
 * plausible-looking but wrong reference.
 */
export function latLonToMGRS(lat: number, lon: number, precision = 5): string | null {
  const band = mgrsLatBand(lat);
  if (band === null) return null;
  const p = Math.max(1, Math.min(5, Math.floor(precision)));
  const utm = latLonToUTM(lat, lon);

  const colSet = (utm.zone - 1) % 3;
  const col = Math.floor(utm.easting / 100000); // 1..8
  const colLetter = COL_LETTERS[colSet].charAt(col - 1);

  const rowSet = (utm.zone - 1) % 2;
  const row = Math.floor(utm.northing / 100000) % 20;
  const rowLetter = ROW_LETTERS[rowSet].charAt(row);

  const eInt = Math.floor(utm.easting % 100000);
  const nInt = Math.floor(utm.northing % 100000);
  const eStr = String(eInt).padStart(5, "0").slice(0, p);
  const nStr = String(nInt).padStart(5, "0").slice(0, p);

  return `${utm.zone}${band}${colLetter}${rowLetter}${eStr}${nStr}`;
}

/** Split a signed decimal degree into degrees / minutes / seconds magnitudes. */
function toDMSParts(value: number): { deg: number; min: number; sec: number } {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return { deg, min, sec };
}

/** Format one axis in D°MM'SS.SS" H form. */
function formatDMSAxis(value: number, isLat: boolean): string {
  let { deg, min, sec } = toDMSParts(value);
  // Guard against 60.00" from floating-point rounding rolling up cleanly.
  if (Number(sec.toFixed(2)) >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min -= 60;
    deg += 1;
  }
  const hemi = isLat ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  const mm = String(min).padStart(2, "0");
  const ss = sec.toFixed(2).padStart(5, "0");
  return `${deg}°${mm}'${ss}" ${hemi}`;
}

/**
 * Format a lat/lon pair as a display string. "dd" gives signed decimal degrees
 * ("34.000000, -118.000000", round-trippable by the coordinate parser); "dms"
 * gives degree/minute/second with hemisphere ("34°00'00.00" N, ...").
 */
export function formatLatLon(lat: number, lon: number, mode: "dd" | "dms"): string {
  if (mode === "dms") {
    return `${formatDMSAxis(lat, true)}, ${formatDMSAxis(lon, false)}`;
  }
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
