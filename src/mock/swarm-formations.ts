/**
 * @module mock/swarm-formations
 * @description Pure station-offset geometry for the demo swarm bus.
 *
 * No existing generator fits: `src/lib/patterns/*-generator.ts` lays survey
 * patterns over an area, not per-slot offsets from a leader, and the agent's
 * own formation generator is Rust and reachable only over the swarm control
 * loop. This is the GCS-side equivalent for `swarm-beacons.ts` to place
 * simulated followers around the live leader.
 *
 * Every offset is expressed in a leader-relative frame — metres RIGHT of the
 * leader's heading and metres BACK from the leader — with index 0 always the
 * leader at `{ rightM: 0, backM: 0 }`. `offsetLatLon` then rotates that frame
 * into the leader's actual heading and applies a flat-earth conversion, which
 * is correct here because every offset is tens of metres, not kilometres.
 *
 * Pure — no store reads, no clock. The offsets an operator sees are provably
 * the formation they picked, independent of when the function ran.
 *
 * @license GPL-3.0-only
 */

import type { SwarmFormation } from "@/lib/swarm/config-keys";

/** One member's station, in the leader-relative frame. */
export interface SwarmStationOffset {
  rightM: number;
  backM: number;
}

/**
 * Station offsets for every member of a `count`-drone formation, leader
 * first. `spacingM` is the agent's `swarm.default_spacing` — the same value
 * that drives the real onboard formation controller, so the demo lattice is
 * the shape the agent would actually fly.
 */
export function formationOffsets(
  formation: SwarmFormation,
  count: number,
  spacingM: number,
): SwarmStationOffset[] {
  const offsets: SwarmStationOffset[] = [{ rightM: 0, backM: 0 }];
  if (count <= 1) return offsets;

  switch (formation) {
    case "line":
      // Abeam, alternating left/right of the leader: 1 right, 1 left, 2
      // right, 2 left, ...
      for (let i = 1; i < count; i++) {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 1 ? 1 : -1;
        offsets.push({ rightM: side * rank * spacingM, backM: 0 });
      }
      break;

    case "column":
      // Single file astern, each member one more spacing behind the leader.
      for (let i = 1; i < count; i++) {
        offsets.push({ rightM: 0, backM: i * spacingM });
      }
      break;

    case "wedge":
      // A V astern of the leader: each rank one spacing further back AND
      // further out, alternating sides.
      for (let i = 1; i < count; i++) {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 1 ? 1 : -1;
        offsets.push({
          rightM: side * rank * spacingM,
          backM: rank * spacingM,
        });
      }
      break;

    case "grid": {
      // A raster of ceil(sqrt(count)) columns, the leader occupying the first
      // cell — so a follower's (row, col) is just its flat index into the
      // same grid the leader's index 0 already sits in.
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 1; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        offsets.push({ rightM: col * spacingM, backM: row * spacingM });
      }
      break;
    }

    case "circle": {
      // Followers evenly spaced on a ring centred on the leader. The radius
      // keeps neighbours on the ring roughly `spacingM` apart along its
      // circumference, floored at `spacingM` so a tiny fleet does not
      // collapse the ring to a point.
      const radius = Math.max(spacingM, (spacingM * count) / (2 * Math.PI));
      const followers = count - 1;
      for (let i = 1; i < count; i++) {
        const angle = (2 * Math.PI * (i - 1)) / followers;
        offsets.push({
          rightM: radius * Math.sin(angle),
          backM: radius * Math.cos(angle),
        });
      }
      break;
    }
  }

  return offsets;
}

/** Metres per degree of latitude — `1e-5 deg ≈ 1.11 m`, i.e. ~111 320 m/deg. */
const METERS_PER_DEG_LAT = 111_320;

/**
 * Place a leader-relative offset at an absolute position, rotated into the
 * leader's heading. Flat-earth: correct at the tens-of-metres scale every
 * formation offset uses, wrong at any scale this module never produces.
 */
export function offsetLatLon(
  lat: number,
  lon: number,
  headingDeg: number,
  rightM: number,
  backM: number,
): { lat: number; lon: number } {
  const headingRad = (headingDeg * Math.PI) / 180;
  const forwardM = -backM;
  const northM =
    forwardM * Math.cos(headingRad) - rightM * Math.sin(headingRad);
  const eastM =
    forwardM * Math.sin(headingRad) + rightM * Math.cos(headingRad);

  const dLat = northM / METERS_PER_DEG_LAT;
  const dLon =
    eastM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

  return { lat: lat + dLat, lon: lon + dLon };
}
