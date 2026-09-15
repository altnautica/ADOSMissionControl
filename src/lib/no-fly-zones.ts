/**
 * @module no-fly-zones
 * @description Per-region no-fly zone data, rendered as red semi-transparent
 * polygons on the map.
 *
 * The table is keyed by ISO 3166-1 alpha-2 country code and it is NOT
 * complete: most regions have no entries. That distinction is the whole
 * point of {@link noFlyZonesForRegion} returning `null` rather than `[]` —
 * an empty overlay is visually identical to clear airspace, so a dataset
 * that silently covers one country only told every operator elsewhere that
 * their airspace was clear. A caller MUST render the unknown state rather
 * than an empty layer.
 * @license GPL-3.0-only
 */

export interface NoFlyZone {
  name: string;
  type: "airport" | "military" | "restricted";
  /** Approximate center for label placement [lat, lon]. */
  center: [number, number];
  /** Polygon boundary points [lat, lon][]. For airports, approximated as circle vertices. */
  polygon: [number, number][];
}

/**
 * Generate a circle approximation polygon (32 vertices) centered at [lat, lon]
 * with given radius in meters.
 */
function circlePolygon(lat: number, lon: number, radiusM: number, points = 32): [number, number][] {
  const R = 6371000;
  const result: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points;
    const dLat = (radiusM * Math.cos(angle)) / R;
    const dLon = (radiusM * Math.sin(angle)) / (R * Math.cos((lat * Math.PI) / 180));
    result.push([
      lat + (dLat * 180) / Math.PI,
      lon + (dLon * 180) / Math.PI,
    ]);
  }
  return result;
}

/** 5 km radius, the perimeter most civil authorities publish around an airport. */
const AIRPORT_RADIUS = 5000;

/**
 * No-fly zones by ISO 3166-1 alpha-2 region code.
 *
 * A region absent from this table has no dataset, which is not the same as
 * having no restrictions. Adding a region means adding real surveyed data,
 * not a placeholder.
 */
export const NO_FLY_ZONES_BY_REGION: Record<string, NoFlyZone[]> = {
  IN: [
    {
      name: "DEL - Indira Gandhi Intl",
      type: "airport",
      center: [28.5562, 77.1000],
      polygon: circlePolygon(28.5562, 77.1000, AIRPORT_RADIUS),
    },
    {
      name: "BLR - Kempegowda Intl",
      type: "airport",
      center: [13.1979, 77.7063],
      polygon: circlePolygon(13.1979, 77.7063, AIRPORT_RADIUS),
    },
    {
      name: "BOM - Chhatrapati Shivaji Intl",
      type: "airport",
      center: [19.0896, 72.8656],
      polygon: circlePolygon(19.0896, 72.8656, AIRPORT_RADIUS),
    },
    {
      name: "MAA - Chennai Intl",
      type: "airport",
      center: [12.9941, 80.1709],
      polygon: circlePolygon(12.9941, 80.1709, AIRPORT_RADIUS),
    },
    {
      name: "HYD - Rajiv Gandhi Intl",
      type: "airport",
      center: [17.2403, 78.4294],
      polygon: circlePolygon(17.2403, 78.4294, AIRPORT_RADIUS),
    },
    {
      name: "CCU - Netaji Subhas Chandra Bose Intl",
      type: "airport",
      center: [22.6547, 88.4467],
      polygon: circlePolygon(22.6547, 88.4467, AIRPORT_RADIUS),
    },
  ],
};

/**
 * The zones for `region`, or `null` when this build carries no data for it.
 *
 * `null` and `[]` mean different things and callers must not conflate them:
 * `[]` would be "surveyed, nothing restricted", which no region in this
 * table claims. An unset or malformed region code is also `null`.
 */
export function noFlyZonesForRegion(
  region: string | null | undefined,
): NoFlyZone[] | null {
  if (!region) return null;
  return NO_FLY_ZONES_BY_REGION[region.trim().toUpperCase()] ?? null;
}
