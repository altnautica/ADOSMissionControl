/**
 * KMZ import must read archives from streaming ZIP writers, which set
 * general-purpose flag bit 3 and leave zero sizes in the local file header,
 * putting the real sizes in a data descriptor after the compressed data.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import pako from "pako";
import { parseKMZ } from "@/lib/formats/kmz-handler";

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Field</name>
<Placemark><name>P1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
77.59,12.97,0 77.60,12.97,0 77.60,12.98,0 77.59,12.98,0 77.59,12.97,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

/** Build a one-entry ZIP the way a streaming writer does (bit 3 + descriptor). */
function streamingZip(name: string, content: string): Uint8Array<ArrayBuffer> {
  const nameBytes = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(content);
  const deflated = pako.deflateRaw(raw);
  const parts: number[] = [];
  const u16 = (v: number) => parts.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) => {
    u16(v & 0xffff);
    u16((v >>> 16) & 0xffff);
  };

  // Local file header: sizes and CRC left zero, flag bit 3 set.
  u32(0x04034b50);
  u16(20);
  u16(0x0008);
  u16(8);
  u16(0);
  u16(0);
  u32(0);
  u32(0);
  u32(0);
  u16(nameBytes.length);
  u16(0);
  parts.push(...nameBytes, ...deflated);
  // Data descriptor carrying the real sizes (CRC is not checked by the reader).
  u32(0x08074b50);
  u32(0);
  u32(deflated.length);
  u32(raw.length);

  const centralOffset = parts.length;
  u32(0x02014b50);
  u16(20);
  u16(20);
  u16(0x0008);
  u16(8);
  u16(0);
  u16(0);
  u32(0);
  u32(deflated.length);
  u32(raw.length);
  u16(nameBytes.length);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32(0);
  u32(0);
  parts.push(...nameBytes);
  const centralSize = parts.length - centralOffset;

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(1);
  u16(1);
  u32(centralSize);
  u32(centralOffset);
  u16(0);
  return new Uint8Array(parts);
}

describe("parseKMZ", () => {
  it("reads a KMZ whose local header defers sizes to a data descriptor", async () => {
    const file = new File([streamingZip("doc.kml", KML)], "field.kmz");
    const result = await parseKMZ(file);
    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0].length).toBeGreaterThanOrEqual(4);
  });
});
