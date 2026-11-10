/**
 * @module mock/engine-modes
 * @description How a flying demo drone moves in its FC mode. AUTO flies the
 * loop it holds as its mission; RTL and SMART_RTL fly straight home, where the
 * FC touches down and disarms; every other mode holds where the vehicle is (a
 * paused mission, a hand-over to the pilot, a hold mode). The demo does not
 * model stick flying, so a pilot-owned GUIDED hold stays put.
 * @license GPL-3.0-only
 */

import type { UnifiedFlightMode } from "@/lib/protocol/types";
import { haversineDistance } from "@/lib/geo/distance";
import { interpolatePath } from "./flight-paths";

export type DemoFlightPhase = "path" | "hold" | "return";

/** Ground speed of a demo drone flying home, m/s. */
export const RETURN_SPEED_MPS = 10;

/** A demo drone's position off its loop. `alt` is metres above home. */
export interface DemoFix {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
}

/** The movement a flying demo drone makes in `mode`. */
export function demoFlightPhase(mode: UnifiedFlightMode): DemoFlightPhase {
  if (mode === "AUTO") return "path";
  if (mode === "RTL" || mode === "SMART_RTL") return "return";
  return "hold";
}

/** One step of `stepM` metres from `from` toward `home`, at constant height. */
export function stepHome(
  from: DemoFix,
  home: { lat: number; lon: number },
  stepM: number,
): { fix: DemoFix; arrived: boolean } {
  const dist = haversineDistance(from.lat, from.lon, home.lat, home.lon);
  if (dist <= stepM) {
    return { fix: { ...from, lat: home.lat, lon: home.lon }, arrived: true };
  }
  const to = { lat: home.lat, lon: home.lon, alt: from.alt, speed: RETURN_SPEED_MPS };
  const next = interpolatePath({ ...from, speed: RETURN_SPEED_MPS }, to, stepM / dist);
  return { fix: { ...next, alt: from.alt }, arrived: false };
}
