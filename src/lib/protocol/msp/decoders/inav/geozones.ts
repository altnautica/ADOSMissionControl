/**
 * iNav geozone decoders: geofence zone metadata and vertices.
 *
 * @module protocol/msp/decoders/inav/geozones
 */

import { readU8, readS32, readU32 } from "./helpers";
import type { INavGeozone, INavGeozoneVertex } from "./types";

// ── iNav GEOZONE decoder ──────────────────────────────────────

/**
 * MSP2_INAV_GEOZONE (0x2210), 14 bytes:
 *
 * U8  number
 * U8  type (0=EXCLUSIVE, 1=INCLUSIVE)
 * U8  shape (0=CIRCULAR, 1=POLYGON)
 * S32 minAlt (cm)
 * S32 maxAlt (cm)
 * U8  isSealevelRef (bool)
 * U8  fenceAction
 * U8  vertexCount
 */
export function decodeMspINavGeozone(dv: DataView): INavGeozone {
  return {
    number: readU8(dv, 0),
    type: readU8(dv, 1),
    shape: readU8(dv, 2),
    minAlt: readS32(dv, 3),
    maxAlt: readS32(dv, 7),
    isSeaLevelRef: readU8(dv, 11) !== 0,
    fenceAction: readU8(dv, 12),
    vertexCount: readU8(dv, 13),
  };
}

// ── iNav GEOZONE VERTEX decoder ───────────────────────────────

/**
 * MSP2_INAV_GEOZONE_VERTEX (0x2212), 10 bytes, or 14 for a circular zone:
 *
 * U8  geozoneId
 * U8  vertexIdx
 * S32 lat (degrees x 1e7)
 * S32 lon (degrees x 1e7)
 * U32 radius (cm), circular zones only
 */
export function decodeMspINavGeozoneVertex(dv: DataView): INavGeozoneVertex {
  const vertex: INavGeozoneVertex = {
    geozoneId: readU8(dv, 0),
    vertexIdx: readU8(dv, 1),
    lat: readS32(dv, 2) / 1e7,
    lon: readS32(dv, 6) / 1e7,
  };
  if (dv.byteLength >= 14) vertex.radius = readU32(dv, 10);
  return vertex;
}
