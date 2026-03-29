/**
 * Telemetry recording export utilities.
 *
 * Converts recorded telemetry frames (from IndexedDB) into
 * downloadable CSV and KML/KMZ files for post-flight analysis.
 *
 * @module telemetry-export
 * @license GPL-3.0-only
 */

import type { TelemetryFrame, TelemetryRecording } from "./telemetry-recorder";
import { loadRecordingFrames } from "./telemetry-recorder";
import { haversineDistance } from "./telemetry-utils";
import type { PositionData, AttitudeData, BatteryData, GpsData, VfrData } from "@/lib/types";

// ── CSV Export ───────────────────────────────────────────────

interface FlattenedRow {
  timestamp_ms: number;
  lat: number;
  lon: number;
  alt_m: number;
  relative_alt_m: number;
  heading_deg: number;
  roll_deg: number;
  pitch_deg: number;
  yaw_deg: number;
  groundspeed_ms: number;
  airspeed_ms: number;
  climb_ms: number;
  battery_v: number;
  battery_pct: number;
  battery_current_a: number;
  battery_consumed_mah: number;
  gps_fix: number;
  gps_satellites: number;
  gps_hdop: number;
  throttle_pct: number;
}

const CSV_COLUMNS: (keyof FlattenedRow)[] = [
  "timestamp_ms",
  "lat",
  "lon",
  "alt_m",
  "relative_alt_m",
  "heading_deg",
  "roll_deg",
  "pitch_deg",
  "yaw_deg",
  "groundspeed_ms",
  "airspeed_ms",
  "climb_ms",
  "battery_v",
  "battery_pct",
  "battery_current_a",
  "battery_consumed_mah",
  "gps_fix",
  "gps_satellites",
  "gps_hdop",
  "throttle_pct",
];

/**
 * Build a time-aligned CSV from telemetry recording frames.
 *
 * Approach: walk all frames in timestamp order, keeping the latest value
 * per channel. Emit a CSV row every time a `position` frame arrives
 * (position is the primary sample clock for flight data).
 */
export async function exportTelemetryAsCSV(
  recording: TelemetryRecording,
): Promise<string> {
  const frames = await loadRecordingFrames(recording.id);
  if (frames.length === 0) return "";

  // Latest state per channel
  let pos: PositionData | null = null;
  let att: AttitudeData | null = null;
  let bat: BatteryData | null = null;
  let gps: GpsData | null = null;
  let vfr: VfrData | null = null;

  const rows: string[] = [CSV_COLUMNS.join(",")];

  for (const frame of frames) {
    switch (frame.channel) {
      case "position":
        pos = frame.data as PositionData;
        break;
      case "attitude":
        att = frame.data as AttitudeData;
        break;
      case "battery":
        bat = frame.data as BatteryData;
        break;
      case "gps":
        gps = frame.data as GpsData;
        break;
      case "vfr":
        vfr = frame.data as VfrData;
        break;
      default:
        continue;
    }

    // Emit row on position updates (primary sample clock)
    if (frame.channel === "position" && pos) {
      const row: FlattenedRow = {
        timestamp_ms: frame.offsetMs,
        lat: pos.lat,
        lon: pos.lon,
        alt_m: pos.alt,
        relative_alt_m: pos.relativeAlt,
        heading_deg: pos.heading,
        roll_deg: att?.roll ?? 0,
        pitch_deg: att?.pitch ?? 0,
        yaw_deg: att?.yaw ?? 0,
        groundspeed_ms: pos.groundSpeed,
        airspeed_ms: pos.airSpeed,
        climb_ms: pos.climbRate,
        battery_v: bat?.voltage ?? 0,
        battery_pct: bat?.remaining ?? 0,
        battery_current_a: bat?.current ?? 0,
        battery_consumed_mah: bat?.consumed ?? 0,
        gps_fix: gps?.fixType ?? 0,
        gps_satellites: gps?.satellites ?? 0,
        gps_hdop: gps?.hdop ?? 0,
        throttle_pct: vfr?.throttle ?? 0,
      };

      rows.push(CSV_COLUMNS.map((col) => String(row[col])).join(","));
    }
  }

  return rows.join("\n");
}

// ── KML Export ───────────────────────────────────────────────

/**
 * Generate a KML string from a telemetry recording.
 *
 * Creates a flight path LineString from position data,
 * plus takeoff and landing Placemarks.
 */
export async function exportTelemetryAsKML(
  recording: TelemetryRecording,
): Promise<string> {
  const frames = await loadRecordingFrames(recording.id);

  // Extract position frames
  const positions = frames
    .filter((f) => f.channel === "position")
    .map((f) => f.data as PositionData);

  if (positions.length === 0) {
    return generateEmptyKML(recording.name);
  }

  // Compute metadata
  const maxAlt = Math.max(...positions.map((p) => p.alt));
  const maxSpeed = Math.max(...positions.map((p) => p.groundSpeed));
  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    totalDistance += haversineDistance(
      positions[i - 1].lat,
      positions[i - 1].lon,
      positions[i].lat,
      positions[i].lon,
    );
  }

  const durationMin = (recording.durationMs / 60000).toFixed(1);
  const distanceKm = (totalDistance / 1000).toFixed(2);
  const date = new Date(recording.startTime).toISOString();
  const takeoff = positions[0];
  const landing = positions[positions.length - 1];

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push("  <Document>");
  lines.push(`    <name>${escapeXml(recording.name)}</name>`);
  lines.push(`    <description>Flight recorded by Altnautica Command on ${date}</description>`);

  // Styles
  lines.push('    <Style id="flightPath">');
  lines.push("      <LineStyle>");
  lines.push("        <color>ff0082ff</color>"); // ABGR: orange
  lines.push("        <width>3</width>");
  lines.push("      </LineStyle>");
  lines.push("    </Style>");

  lines.push('    <Style id="takeoff">');
  lines.push("      <IconStyle>");
  lines.push("        <color>ff00ff00</color>"); // green
  lines.push("        <scale>1.0</scale>");
  lines.push("        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon>");
  lines.push("      </IconStyle>");
  lines.push("    </Style>");

  lines.push('    <Style id="landing">');
  lines.push("      <IconStyle>");
  lines.push("        <color>ff0000ff</color>"); // red
  lines.push("        <scale>1.0</scale>");
  lines.push("        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>");
  lines.push("      </IconStyle>");
  lines.push("    </Style>");

  // Flight path
  lines.push("    <Placemark>");
  lines.push("      <name>Flight Path</name>");
  lines.push("      <styleUrl>#flightPath</styleUrl>");
  lines.push("      <LineString>");
  lines.push("        <altitudeMode>relativeToGround</altitudeMode>");
  lines.push("        <coordinates>");

  // KML coordinate order: lon,lat,alt
  for (const p of positions) {
    lines.push(`          ${p.lon},${p.lat},${p.alt}`);
  }

  lines.push("        </coordinates>");
  lines.push("      </LineString>");
  lines.push("    </Placemark>");

  // Takeoff marker
  lines.push("    <Placemark>");
  lines.push("      <name>Takeoff</name>");
  lines.push("      <styleUrl>#takeoff</styleUrl>");
  lines.push("      <Point>");
  lines.push("        <altitudeMode>relativeToGround</altitudeMode>");
  lines.push(`        <coordinates>${takeoff.lon},${takeoff.lat},${takeoff.alt}</coordinates>`);
  lines.push("      </Point>");
  lines.push("    </Placemark>");

  // Landing marker
  lines.push("    <Placemark>");
  lines.push("      <name>Landing</name>");
  lines.push("      <styleUrl>#landing</styleUrl>");
  lines.push("      <Point>");
  lines.push("        <altitudeMode>relativeToGround</altitudeMode>");
  lines.push(`        <coordinates>${landing.lon},${landing.lat},${landing.alt}</coordinates>`);
  lines.push("      </Point>");
  lines.push("    </Placemark>");

  // Metadata folder
  lines.push("    <Folder>");
  lines.push("      <name>Flight Summary</name>");
  lines.push("      <description>");
  lines.push(`Duration: ${durationMin} min`);
  lines.push(`Distance: ${distanceKm} km`);
  lines.push(`Max Altitude: ${maxAlt.toFixed(1)} m AGL`);
  lines.push(`Max Speed: ${maxSpeed.toFixed(1)} m/s`);
  lines.push(`Drone: ${recording.droneName ?? "Unknown"}`);
  lines.push(`Frames: ${recording.frameCount}`);
  lines.push("      </description>");
  lines.push("    </Folder>");

  lines.push("  </Document>");
  lines.push("</kml>");

  return lines.join("\n");
}

// ── Download Helpers ─────────────────────────────────────────

/**
 * Export telemetry recording as a CSV file download.
 */
export async function downloadTelemetryCSV(recording: TelemetryRecording): Promise<void> {
  const csv = await exportTelemetryAsCSV(recording);
  if (!csv) return;

  const dateStr = new Date(recording.startTime).toISOString().slice(0, 10);
  const name = recording.droneName ?? "flight";
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    `${name}-${dateStr}.csv`,
  );
}

/**
 * Export telemetry recording as a KML file download.
 */
export async function downloadTelemetryKML(recording: TelemetryRecording): Promise<void> {
  const kml = await exportTelemetryAsKML(recording);

  const dateStr = new Date(recording.startTime).toISOString().slice(0, 10);
  const name = recording.droneName ?? "flight";
  downloadBlob(
    new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }),
    `${name}-${dateStr}.kml`,
  );
}

/**
 * Export telemetry recording as a KMZ file download.
 */
export async function downloadTelemetryKMZ(recording: TelemetryRecording): Promise<void> {
  const kml = await exportTelemetryAsKML(recording);
  const kmlBytes = new TextEncoder().encode(kml);

  const pako = await import("pako");
  const compressed = pako.deflateRaw(kmlBytes);

  const zipBytes = buildMinimalZip("doc.kml", kmlBytes, compressed);
  const dateStr = new Date(recording.startTime).toISOString().slice(0, 10);
  const name = recording.droneName ?? "flight";
  downloadBlob(
    new Blob([new Uint8Array(zipBytes)], { type: "application/vnd.google-earth.kmz" }),
    `${name}-${dateStr}.kmz`,
  );
}

// ── Internal Helpers ─────────────────────────────────────────

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

function generateEmptyKML(name: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    `    <name>${escapeXml(name)}</name>`,
    "    <description>No position data recorded.</description>",
    "  </Document>",
    "</kml>",
  ].join("\n");
}

/**
 * Build a minimal ZIP file containing a single deflated file.
 * Replicates the pattern from kml-exporter.ts.
 */
function buildMinimalZip(
  fileName: string,
  uncompressed: Uint8Array,
  compressed: Uint8Array,
): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const crc = crc32(uncompressed);

  const localHeader = new Uint8Array(30 + fileNameBytes.length);
  const lhView = new DataView(localHeader.buffer);
  lhView.setUint32(0, 0x04034b50, true);
  lhView.setUint16(4, 20, true);
  lhView.setUint16(8, 8, true);
  lhView.setUint32(14, crc, true);
  lhView.setUint32(18, compressed.length, true);
  lhView.setUint32(22, uncompressed.length, true);
  lhView.setUint16(26, fileNameBytes.length, true);
  localHeader.set(fileNameBytes, 30);

  const centralHeader = new Uint8Array(46 + fileNameBytes.length);
  const chView = new DataView(centralHeader.buffer);
  chView.setUint32(0, 0x02014b50, true);
  chView.setUint16(4, 20, true);
  chView.setUint16(6, 20, true);
  chView.setUint16(10, 8, true);
  chView.setUint32(16, crc, true);
  chView.setUint32(20, compressed.length, true);
  chView.setUint32(24, uncompressed.length, true);
  chView.setUint16(28, fileNameBytes.length, true);
  centralHeader.set(fileNameBytes, 46);

  const centralDirOffset = localHeader.length + compressed.length;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralHeader.length, true);
  eocdView.setUint32(16, centralDirOffset, true);

  const total = localHeader.length + compressed.length + centralHeader.length + eocd.length;
  const result = new Uint8Array(total);
  let p = 0;
  result.set(localHeader, p); p += localHeader.length;
  result.set(compressed, p); p += compressed.length;
  result.set(centralHeader, p); p += centralHeader.length;
  result.set(eocd, p);

  return result;
}

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
