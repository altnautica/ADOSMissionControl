/**
 * @module formats/kml-exporter
 * @description Export mission waypoints as KML/KMZ files.
 * Generates standard KML XML with Placemarks for waypoints and a LineString for the path.
 *
 * CRITICAL: KML coordinate order is lon,lat,alt — opposite of our lat,lon convention.
 *
 * Each Placemark carries the `altitudeMode` its waypoint's altitude frame maps
 * onto instead of a hardcoded `relativeToGround`, so a third-party viewer draws
 * an AMSL waypoint at the right height. KML has no "above home" mode, so a
 * `relative`-frame waypoint is written as `relativeToGround` for interop AND
 * its true frame is recorded in `ExtendedData` — that is what makes our own
 * re-import lossless rather than silently re-labelling the vertical datum.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types";

/** Our frame name, written verbatim into ExtendedData for a lossless re-import. */
export const KML_FRAME_KEY = "adosAltitudeFrame";

/**
 * KML `altitudeMode` for an altitude frame. `absolute` is AMSL in both models;
 * `terrain` is exactly KML's `relativeToGround`; `relative` (above home) has no
 * KML equivalent and degrades to `relativeToGround`.
 */
function altitudeModeFor(frame: AltitudeFrame | undefined): string {
  return frame === "absolute" ? "absolute" : "relativeToGround";
}

/**
 * Export waypoints as a KML XML string.
 */
export function generateKML(waypoints: Waypoint[], name: string): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push("  <Document>");
  lines.push(`    <name>${escapeXml(name)}</name>`);
  lines.push(`    <description>Mission exported from Altnautica Command</description>`);

  // Style for waypoint icons
  lines.push("    <Style id=\"waypointStyle\">");
  lines.push("      <IconStyle>");
  lines.push("        <color>ffff8200</color>");
  lines.push("        <scale>0.8</scale>");
  lines.push("        <Icon>");
  lines.push("          <href>http://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href>");
  lines.push("        </Icon>");
  lines.push("      </IconStyle>");
  lines.push("    </Style>");

  // Style for the flight path line
  lines.push("    <Style id=\"pathStyle\">");
  lines.push("      <LineStyle>");
  lines.push("        <color>ffff8200</color>");
  lines.push("        <width>3</width>");
  lines.push("      </LineStyle>");
  lines.push("    </Style>");

  // Flight path as a LineString
  if (waypoints.length > 1) {
    lines.push("    <Placemark>");
    lines.push(`      <name>Flight Path</name>`);
    lines.push("      <styleUrl>#pathStyle</styleUrl>");
    lines.push("      <LineString>");
    // The path renders in the first waypoint's mode; per-point frames ride on
    // the individual Placemarks below, which is where re-import reads them.
    lines.push(`        <altitudeMode>${altitudeModeFor(waypoints[0]?.frame)}</altitudeMode>`);
    lines.push("        <coordinates>");

    const coords = waypoints
      .map((wp) => `          ${wp.lon},${wp.lat},${wp.alt}`)
      .join("\n");
    lines.push(coords);

    lines.push("        </coordinates>");
    lines.push("      </LineString>");
    lines.push("    </Placemark>");
  }

  // Individual waypoints as Placemarks
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const label = wp.command === "WAYPOINT" ? `WP ${i + 1}` : (wp.command ?? `WP ${i + 1}`);

    lines.push("    <Placemark>");
    lines.push(`      <name>${escapeXml(label)}</name>`);
    lines.push("      <styleUrl>#waypointStyle</styleUrl>");
    if (wp.frame !== undefined) {
      lines.push("      <ExtendedData>");
      lines.push(`        <Data name="${KML_FRAME_KEY}"><value>${wp.frame}</value></Data>`);
      lines.push("      </ExtendedData>");
    }
    lines.push("      <Point>");
    lines.push(`        <altitudeMode>${altitudeModeFor(wp.frame)}</altitudeMode>`);
    // KML order: lon,lat,alt
    lines.push(`        <coordinates>${wp.lon},${wp.lat},${wp.alt}</coordinates>`);
    lines.push("      </Point>");
    lines.push("    </Placemark>");
  }

  lines.push("  </Document>");
  lines.push("</kml>");

  return lines.join("\n");
}

/**
 * Download waypoints as a .kml file.
 */
export function exportKML(waypoints: Waypoint[], name: string): void {
  const kml = generateKML(waypoints, name);
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  downloadBlob(blob, `${name || "mission"}.kml`);
}

/**
 * Download waypoints as a .kmz file (KML compressed in ZIP).
 * Uses a minimal ZIP builder (no external deps beyond pako which is already available).
 */
export async function exportKMZ(waypoints: Waypoint[], name: string): Promise<void> {
  const kml = generateKML(waypoints, name);
  const kmlBytes = new TextEncoder().encode(kml);

  // Use pako for deflation
  const pako = await import("pako");
  const compressed = pako.deflateRaw(kmlBytes);

  // Build minimal ZIP file
  const zipBytes = buildMinimalZip("doc.kml", kmlBytes, compressed);
  const blob = new Blob([new Uint8Array(zipBytes)], { type: "application/vnd.google-earth.kmz" });
  downloadBlob(blob, `${name || "mission"}.kmz`);
}

// ── Helpers ──────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build a minimal ZIP file containing a single deflated file.
 * Just enough ZIP structure to be valid.
 */
function buildMinimalZip(
  fileName: string,
  uncompressed: Uint8Array,
  compressed: Uint8Array
): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const crc = crc32(uncompressed);

  // Local file header
  const localHeader = new Uint8Array(30 + fileNameBytes.length);
  const lhView = new DataView(localHeader.buffer);
  lhView.setUint32(0, 0x04034b50, true); // Local file header signature
  lhView.setUint16(4, 20, true);          // Version needed (2.0)
  lhView.setUint16(6, 0, true);           // General purpose bit flag
  lhView.setUint16(8, 8, true);           // Compression method (deflate)
  lhView.setUint16(10, 0, true);          // File last mod time
  lhView.setUint16(12, 0, true);          // File last mod date
  lhView.setUint32(14, crc, true);        // CRC-32
  lhView.setUint32(18, compressed.length, true);   // Compressed size
  lhView.setUint32(22, uncompressed.length, true); // Uncompressed size
  lhView.setUint16(26, fileNameBytes.length, true); // File name length
  lhView.setUint16(28, 0, true);          // Extra field length
  localHeader.set(fileNameBytes, 30);

  // Central directory file header
  const centralHeader = new Uint8Array(46 + fileNameBytes.length);
  const chView = new DataView(centralHeader.buffer);
  chView.setUint32(0, 0x02014b50, true);  // Central directory signature
  chView.setUint16(4, 20, true);           // Version made by
  chView.setUint16(6, 20, true);           // Version needed
  chView.setUint16(8, 0, true);            // General purpose bit flag
  chView.setUint16(10, 8, true);           // Compression method
  chView.setUint16(12, 0, true);           // File last mod time
  chView.setUint16(14, 0, true);           // File last mod date
  chView.setUint32(16, crc, true);         // CRC-32
  chView.setUint32(20, compressed.length, true);
  chView.setUint32(24, uncompressed.length, true);
  chView.setUint16(28, fileNameBytes.length, true);
  chView.setUint16(30, 0, true);           // Extra field length
  chView.setUint16(32, 0, true);           // File comment length
  chView.setUint16(34, 0, true);           // Disk number start
  chView.setUint16(36, 0, true);           // Internal file attributes
  chView.setUint32(38, 0, true);           // External file attributes
  chView.setUint32(42, 0, true);           // Relative offset of local header
  centralHeader.set(fileNameBytes, 46);

  // End of central directory record
  const centralDirOffset = localHeader.length + compressed.length;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true);           // Disk number
  eocdView.setUint16(6, 0, true);           // Disk with central dir
  eocdView.setUint16(8, 1, true);           // Entries on this disk
  eocdView.setUint16(10, 1, true);          // Total entries
  eocdView.setUint32(12, centralHeader.length, true); // Central dir size
  eocdView.setUint32(16, centralDirOffset, true);     // Central dir offset
  eocdView.setUint16(20, 0, true);          // Comment length

  // Combine all parts
  const total = localHeader.length + compressed.length + centralHeader.length + eocd.length;
  const result = new Uint8Array(total);
  let pos = 0;
  result.set(localHeader, pos); pos += localHeader.length;
  result.set(compressed, pos); pos += compressed.length;
  result.set(centralHeader, pos); pos += centralHeader.length;
  result.set(eocd, pos);

  return result;
}

/**
 * CRC-32 calculation (used for ZIP file entries).
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
