/**
 * @module airspace/convex-zone-adapter
 * @description Converts compact zone data from Convex back to full AirspaceZone[].
 * Server stores zones in a compressed format to minimize document size.
 * This adapter rehydrates them for client-side rendering.
 * @license GPL-3.0-only
 */

import type { AirspaceZone, AirspaceZoneType } from "./types";

/** Compact zone format stored in Convex. */
interface CompactZone {
  id: string;
  n: string;        // name
  t: string;        // type
  fa: number;       // floorAltitude
  ca: number;       // ceilingAltitude
  a: string;        // authority
  j?: string;       // jurisdiction
  c?: { lat: number; lon: number; r: number }; // circle (radiusM)
  p?: number[][][]; // polygon coordinates
  lc?: number;      // laancCeiling
  m?: Record<string, string>; // metadata
}

/**
 * Approximate a circle as a polygon with `points` vertices.
 * Same math as geo-utils.ts circleToPolygon.
 */
function circlePolygon(lat: number, lon: number, radiusKm: number, points = 32) {
  const coords: number[][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const y = lat + (radiusKm / 111.32) * Math.cos(angle);
    const x = lon + (radiusKm / (111.32 * Math.cos(lat * (Math.PI / 180)))) * Math.sin(angle);
    coords.push([x, y]);
  }
  return { type: "Polygon" as const, coordinates: [coords] };
}

/**
 * Rehydrate compact zone JSON from Convex into full AirspaceZone[].
 */
export function rehydrateZones(json: string): AirspaceZone[] {
  const compact: CompactZone[] = JSON.parse(json);
  return compact.map((z) => {
    const radiusKm = z.c ? z.c.r / 1000 : 0;
    return {
      id: z.id,
      name: z.n,
      type: z.t as AirspaceZoneType,
      geometry: z.p
        ? { type: "Polygon" as const, coordinates: z.p }
        : circlePolygon(z.c!.lat, z.c!.lon, radiusKm),
      floorAltitude: z.fa,
      ceilingAltitude: z.ca,
      authority: z.a,
      ...(z.j && { jurisdiction: z.j as AirspaceZone["jurisdiction"] }),
      ...(z.c && { circle: { lat: z.c.lat, lon: z.c.lon, radiusM: z.c.r } }),
      ...(z.lc != null && { laancCeiling: z.lc }),
      metadata: z.m ?? {},
    };
  });
}
