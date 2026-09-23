/**
 * iNav geozone and vertex encoders.
 *
 * @module protocol/msp/encoders/inav/geozone
 */

import type { INavGeozone, INavGeozoneVertex } from '../../msp-decoders-inav';
import { writeU8, writeS32, writeU32 } from './_helpers';

/**
 * Encode MSP2_INAV_SET_GEOZONE (0x2211) payload, 14 bytes. Writing a zone
 * resets its vertices on the FC, so the vertices follow it.
 *
 * U8  number (geozone index)
 * U8  type   (0=EXCLUSIVE, 1=INCLUSIVE)
 * U8  shape  (0=CIRCULAR, 1=POLYGON)
 * S32 minAlt (cm)
 * S32 maxAlt (cm)
 * U8  isSealevelRef (bool)
 * U8  fenceAction
 * U8  vertexCount
 */
export function encodeMspINavSetGeozone(g: INavGeozone): Uint8Array {
  const buf = new Uint8Array(14);
  const dv = new DataView(buf.buffer);

  writeU8(dv, 0, g.number);
  writeU8(dv, 1, g.type);
  writeU8(dv, 2, g.shape);
  writeS32(dv, 3, g.minAlt);
  writeS32(dv, 7, g.maxAlt);
  writeU8(dv, 11, g.isSeaLevelRef ? 1 : 0);
  writeU8(dv, 12, g.fenceAction);
  writeU8(dv, 13, g.vertexCount);

  return buf;
}

/**
 * Encode MSP2_INAV_SET_GEOZONE_VERTEX (0x2213) payload. 10 bytes, or 14 when
 * the vertex carries a radius: a circular zone is written as its centre vertex
 * followed by the radius, and the FC stores the radius in the next slot.
 *
 * U8  geozoneId
 * U8  vertexIdx
 * S32 lat (degrees x 1e7)
 * S32 lon (degrees x 1e7)
 * U32 radius (cm), circular zones only
 */
export function encodeMspINavSetGeozoneVertex(v: INavGeozoneVertex): Uint8Array {
  const circular = v.radius !== undefined;
  const buf = new Uint8Array(circular ? 14 : 10);
  const dv = new DataView(buf.buffer);

  writeU8(dv, 0, v.geozoneId);
  writeU8(dv, 1, v.vertexIdx);
  writeS32(dv, 2, Math.round(v.lat * 1e7));
  writeS32(dv, 6, Math.round(v.lon * 1e7));
  if (circular) writeU32(dv, 10, Math.round(v.radius!));

  return buf;
}
