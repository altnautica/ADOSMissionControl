/**
 * @module formats/kmz-handler
 * @description KMZ file handler. KMZ is a ZIP archive containing a doc.kml file.
 * Uses pako (already a project dependency) for decompression.
 * @license GPL-3.0-only
 */

import pako from "pako";
import { parseKML, type KmlParseResult } from "./kml-parser";

/**
 * Parse a KMZ file (ZIP containing doc.kml) into waypoints, polygons, and paths.
 * Falls back to treating the content as plain KML if ZIP parsing fails.
 */
export async function parseKMZ(file: File): Promise<KmlParseResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check for ZIP magic number (PK\x03\x04)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const kmlContent = extractKmlFromZip(bytes);
    if (kmlContent) {
      return parseKML(kmlContent);
    }
  }

  // Fallback: try to parse as plain KML text
  const text = new TextDecoder().decode(bytes);
  return parseKML(text);
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** EOCD record without its trailing comment. */
const EOCD_MIN = 22;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * List the archive's entries from the central directory. Unlike a local file
 * header, a central-directory entry always carries the real sizes, including
 * for archives written by streaming writers that set general-purpose flag bit 3
 * and leave zeros in the local header (sizes follow the data in a descriptor).
 */
function readCentralDirectory(data: Uint8Array, view: DataView): ZipEntry[] | null {
  // The EOCD record sits at the end, followed by a comment of up to 64 KiB.
  let eocd = -1;
  for (let i = data.length - EOCD_MIN; i >= Math.max(0, data.length - EOCD_MIN - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== CENTRAL_SIG) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      name: decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength)),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateEntry(data: Uint8Array, view: DataView, entry: ZipEntry): string | null {
  const at = entry.localHeaderOffset;
  if (at + 30 > data.length || view.getUint32(at, true) !== LOCAL_SIG) return null;
  // The local header's own name/extra lengths locate the data; they can differ
  // from the central directory's copy.
  const dataOffset = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  if (dataOffset + entry.compressedSize > data.length) return null;
  const fileData = data.subarray(dataOffset, dataOffset + entry.compressedSize);
  const decoder = new TextDecoder();
  if (entry.method === 0) return decoder.decode(fileData);
  if (entry.method !== 8) return null;
  try {
    return decoder.decode(pako.inflateRaw(fileData));
  } catch {
    return null;
  }
}

/**
 * Extract the KML document from a ZIP archive: `doc.kml` when present (the KMZ
 * convention), else the first `.kml` entry.
 */
function extractKmlFromZip(data: Uint8Array): string | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries = readCentralDirectory(data, view);
  if (!entries) return null;
  const kml = entries.filter((e) => e.name.toLowerCase().endsWith(".kml"));
  const entry = kml.find((e) => e.name.toLowerCase().split("/").pop() === "doc.kml") ?? kml[0];
  return entry ? inflateEntry(data, view, entry) : null;
}
