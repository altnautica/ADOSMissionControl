/**
 * @module geocoding/parse-latlon
 * @description Parse a free-typed coordinate string into { lat, lon } so the map
 * search box resolves coordinates offline (no network) before falling back to
 * forward geocoding. Accepts decimal ("12.97, 77.59"), signed, hemisphere
 * suffixes/prefixes ("12.97N 77.59E", "N12.97 E77.59"), and lat/lon separated by
 * comma or whitespace. Returns null when the string is not a coordinate.
 * @license GPL-3.0-only
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** One signed decimal degrees value with an optional N/S/E/W hemisphere. */
function parseComponent(raw: string): { value: number; hemi?: "N" | "S" | "E" | "W" } | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([NSEW])?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);
  if (!m) return null;
  const hemi = (m[1] || m[3]) as "N" | "S" | "E" | "W" | undefined;
  if (m[1] && m[3]) return null; // hemisphere on both ends is malformed
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  return { value, hemi };
}

/** Apply a hemisphere sign to a magnitude. */
function signed(value: number, hemi?: "N" | "S" | "E" | "W"): number {
  if (hemi === "S" || hemi === "W") return -Math.abs(value);
  if (hemi === "N" || hemi === "E") return Math.abs(value);
  return value;
}

/**
 * Parse "lat, lon" (comma or whitespace separated). Returns null if the string
 * is not two valid coordinate components in range.
 */
export function parseLatLon(input: string): LatLon | null {
  if (!input) return null;
  const parts = input.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  // A standalone hemisphere letter ("12.97 S 77.59", "N 12.97 E 77.59") is
  // re-attached to one neighbouring number. It binds to the preceding bare
  // number when that number has no other claim on it (suffix form), to the
  // following one when nothing precedes it (prefix form). Between two bare
  // numbers the letter's axis settles it in lat-first order: N/S is the first
  // number's suffix, E/W the second number's prefix.
  const isBare = (t: string | undefined) =>
    t !== undefined && /^[+-]?\d+(?:\.\d+)?°?$/.test(t);
  const isHemi = (t: string | undefined) =>
    t !== undefined && /^[NSEW]$/i.test(t);
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!isHemi(part)) {
      tokens.push(part);
      continue;
    }
    const prevBare = isBare(tokens[tokens.length - 1]);
    const next = parts[i + 1];
    const nextFree = isBare(next) && !isHemi(parts[i + 2]);
    const bindBack =
      prevBare && (!nextFree || /^[NS]$/i.test(part));
    if (bindBack) {
      tokens[tokens.length - 1] += part;
    } else if (isBare(next)) {
      tokens.push(`${part}${next}`);
      i++;
    } else {
      return null;
    }
  }
  if (tokens.length !== 2) return null;

  const a = parseComponent(tokens[0]);
  const b = parseComponent(tokens[1]);
  if (!a || !b) return null;

  // Decide which token is latitude: an explicit N/S wins; else assume lat first.
  const aIsLat = a.hemi === "N" || a.hemi === "S";
  const bIsLat = b.hemi === "N" || b.hemi === "S";
  let latC = a, lonC = b;
  if (bIsLat && !aIsLat) { latC = b; lonC = a; }

  const lat = signed(latC.value, latC.hemi);
  const lon = signed(lonC.value, lonC.hemi);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
