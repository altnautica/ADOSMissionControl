/**
 * GPS waypoint routes for demo drones.
 * Each path is a closed loop — drone cycles through waypoints continuously.
 */

export interface PathWaypoint {
  lat: number;
  lon: number;
  alt: number; // meters AGL
  speed: number; // m/s target ground speed
}

/**
 * Path 0: Alpha-1 — Security patrol loop (Bangalore, HAL area).
 */
const PATROL_LOOP_A: PathWaypoint[] = [
  { lat: 12.950, lon: 77.666, alt: 40, speed: 8 },
  { lat: 12.952, lon: 77.668, alt: 45, speed: 8 },
  { lat: 12.954, lon: 77.670, alt: 40, speed: 8 },
  { lat: 12.953, lon: 77.673, alt: 45, speed: 8 },
  { lat: 12.951, lon: 77.674, alt: 40, speed: 8 },
  { lat: 12.949, lon: 77.672, alt: 45, speed: 8 },
  { lat: 12.948, lon: 77.669, alt: 40, speed: 8 },
  { lat: 12.949, lon: 77.667, alt: 45, speed: 8 },
];

/**
 * Path 1: Bravo-2 — Survey grid pattern (Bangalore, Whitefield area).
 */
const SURVEY_GRID_A: PathWaypoint[] = [
  { lat: 12.955, lon: 77.673, alt: 80, speed: 5 },
  { lat: 12.957, lon: 77.673, alt: 80, speed: 5 },
  { lat: 12.957, lon: 77.676, alt: 80, speed: 5 },
  { lat: 12.955, lon: 77.676, alt: 80, speed: 5 },
  { lat: 12.955, lon: 77.679, alt: 80, speed: 5 },
  { lat: 12.957, lon: 77.679, alt: 80, speed: 5 },
  { lat: 12.957, lon: 77.682, alt: 80, speed: 5 },
  { lat: 12.955, lon: 77.682, alt: 80, speed: 5 },
  { lat: 12.953, lon: 77.682, alt: 80, speed: 5 },
  { lat: 12.953, lon: 77.679, alt: 80, speed: 5 },
  { lat: 12.953, lon: 77.676, alt: 80, speed: 5 },
  { lat: 12.953, lon: 77.673, alt: 80, speed: 5 },
];

/**
 * Path 2: Echo-5 — SAR search pattern (Bangalore, south of HAL).
 */
const SAR_SEARCH_A: PathWaypoint[] = [
  { lat: 12.940, lon: 77.683, alt: 60, speed: 10 },
  { lat: 12.942, lon: 77.686, alt: 65, speed: 10 },
  { lat: 12.944, lon: 77.683, alt: 60, speed: 10 },
  { lat: 12.942, lon: 77.680, alt: 65, speed: 10 },
  { lat: 12.940, lon: 77.677, alt: 60, speed: 10 },
  { lat: 12.938, lon: 77.680, alt: 65, speed: 10 },
  { lat: 12.938, lon: 77.686, alt: 60, speed: 10 },
  { lat: 12.940, lon: 77.689, alt: 65, speed: 10 },
];

export const FLIGHT_PATHS: PathWaypoint[][] = [
  PATROL_LOOP_A,
  SURVEY_GRID_A,
  SAR_SEARCH_A,
];

/**
 * Interpolate position between two waypoints.
 * Returns { lat, lon, alt, heading, progress (0-1) }.
 */
export function interpolatePath(
  from: PathWaypoint,
  to: PathWaypoint,
  t: number
): { lat: number; lon: number; alt: number; heading: number } {
  const lat = from.lat + (to.lat - from.lat) * t;
  const lon = from.lon + (to.lon - from.lon) * t;
  const alt = from.alt + (to.alt - from.alt) * t;

  // Calculate heading
  const dLon = to.lon - from.lon;
  const y = Math.sin(dLon * (Math.PI / 180)) * Math.cos(to.lat * (Math.PI / 180));
  const x =
    Math.cos(from.lat * (Math.PI / 180)) * Math.sin(to.lat * (Math.PI / 180)) -
    Math.sin(from.lat * (Math.PI / 180)) * Math.cos(to.lat * (Math.PI / 180)) * Math.cos(dLon * (Math.PI / 180));
  const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

  return { lat, lon, alt, heading };
}
