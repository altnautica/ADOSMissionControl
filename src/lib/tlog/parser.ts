/**
 * Standard MAVLink `.tlog` file parser.
 *
 * tlog format: repeating blocks of [8-byte LE timestamp (µs)] + [MAVLink v1/v2 packet].
 * We extract the timestamps and raw packets, then feed each packet through
 * the existing MAVLink parser for decoding.
 *
 * Phase 30.
 *
 * @module tlog/parser
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import type { FlightRecord } from "../types";

export interface TlogPacket {
  timestampUs: number;
  /** Raw MAVLink packet bytes (including STX, length, seq, sysid, compid, msgid, payload, checksum). */
  raw: Uint8Array;
}

/**
 * Parse a .tlog binary buffer into timestamped MAVLink packets.
 * Does NOT decode the MAVLink messages — returns raw packets with timestamps.
 */
export function parseTlog(buffer: ArrayBuffer): TlogPacket[] {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const packets: TlogPacket[] = [];
  let pos = 0;

  while (pos + 8 < bytes.length) {
    // 8-byte LE timestamp in microseconds
    const timestampUs = Number(dv.getBigUint64(pos, true));
    pos += 8;

    if (pos >= bytes.length) break;

    const stx = bytes[pos];
    let packetLen: number;

    if (stx === 0xFE) {
      // MAVLink v1: STX(1) + len(1) + seq(1) + sysid(1) + compid(1) + msgid(1) + payload(len) + crc(2)
      if (pos + 6 > bytes.length) break;
      const payloadLen = bytes[pos + 1];
      packetLen = 6 + payloadLen + 2;
    } else if (stx === 0xFD) {
      // MAVLink v2: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3) + payload(len) + crc(2) [+ sig(13)]
      if (pos + 10 > bytes.length) break;
      const payloadLen = bytes[pos + 1];
      const incompatFlags = bytes[pos + 2];
      const hasSig = (incompatFlags & 0x01) !== 0;
      packetLen = 10 + payloadLen + 2 + (hasSig ? 13 : 0);
    } else {
      // Not a valid MAVLink start byte — skip to find next timestamp + packet
      pos++;
      continue;
    }

    if (pos + packetLen > bytes.length) break;

    packets.push({
      timestampUs,
      raw: bytes.slice(pos, pos + packetLen),
    });

    pos += packetLen;
  }

  return packets;
}

/**
 * Convert tlog packets into TelemetryFrames + a FlightRecord.
 *
 * Since full MAVLink decoding requires the parser state machine (which is
 * tightly coupled to the WebSocket stream), we do a simplified extraction
 * of the most common messages for history import.
 */
export function tlogToFlightRecord(
  packets: TlogPacket[],
  sourceFilename?: string,
): { record: FlightRecord; frames: TelemetryFrame[] } | null {
  if (packets.length === 0) return null;

  const startUs = packets[0].timestampUs;
  const endUs = packets[packets.length - 1].timestampUs;
  const durationMs = (endUs - startUs) / 1000;
  const duration = Math.max(0, Math.round(durationMs / 1000));

  const id = crypto.randomUUID();
  const frames: TelemetryFrame[] = [];

  // Extract basic position data from GLOBAL_POSITION_INT (msg 33)
  const path: [number, number][] = [];
  let maxAlt = 0;
  let lastPathMs = -Infinity;

  for (const pkt of packets) {
    const raw = pkt.raw;
    const offsetMs = (pkt.timestampUs - startUs) / 1000;

    // MAVLink v2 message ID extraction
    let msgId: number;
    let payloadStart: number;
    if (raw[0] === 0xFD) {
      msgId = raw[7] | (raw[8] << 8) | (raw[9] << 16);
      payloadStart = 10;
    } else if (raw[0] === 0xFE) {
      msgId = raw[5];
      payloadStart = 6;
    } else {
      continue;
    }

    const pdv = new DataView(raw.buffer, raw.byteOffset + payloadStart, raw[1]);

    // GLOBAL_POSITION_INT (33): lat, lon, alt, relative_alt, vx, vy, vz, hdg
    if (msgId === 33 && raw[1] >= 28) {
      const lat = pdv.getInt32(4, true) / 1e7;
      const lon = pdv.getInt32(8, true) / 1e7;
      const alt = pdv.getInt32(12, true) / 1000;
      const relAlt = pdv.getInt32(16, true) / 1000;
      const vx = pdv.getInt16(20, true) / 100;
      const vy = pdv.getInt16(22, true) / 100;
      const gs = Math.sqrt(vx * vx + vy * vy);

      if (relAlt > maxAlt) maxAlt = relAlt;

      frames.push({
        offsetMs,
        channel: "globalPosition",
        data: { lat, lon, alt, relativeAlt: relAlt, groundSpeed: gs, heading: 0 },
      });

      if (offsetMs - lastPathMs >= 1000) {
        path.push([lat, lon]);
        lastPathMs = offsetMs;
      }
    }

    // ATTITUDE (30): roll, pitch, yaw
    if (msgId === 30 && raw[1] >= 28) {
      frames.push({
        offsetMs,
        channel: "attitude",
        data: {
          roll: pdv.getFloat32(4, true),
          pitch: pdv.getFloat32(8, true),
          yaw: pdv.getFloat32(12, true),
        },
      });
    }

    // SYS_STATUS (1): voltage, current, remaining
    if (msgId === 1 && raw[1] >= 31) {
      frames.push({
        offsetMs,
        channel: "battery",
        data: {
          voltage: pdv.getUint16(14, true) / 1000,
          current: pdv.getInt16(16, true) / 100,
          remaining: pdv.getInt8(18),
        },
      });
    }
  }

  if (frames.length === 0) return null;

  const cappedPath = path.length > 1000
    ? path.filter((_, i) => i % Math.ceil(path.length / 1000) === 0)
    : path;

  const record: FlightRecord = {
    id,
    droneId: `tlog-${startUs}`,
    droneName: sourceFilename?.replace(/\.tlog$/i, "") ?? "MAVLink Import",
    date: Date.now(),
    startTime: Date.now(),
    endTime: Date.now() + duration * 1000,
    duration,
    distance: 0, // Would need haversine sum
    maxAlt,
    maxSpeed: 0,
    avgSpeed: 0,
    batteryUsed: 0,
    waypointCount: 0,
    status: "completed",
    path: cappedPath.length >= 2 ? cappedPath : undefined,
    takeoffLat: path[0]?.[0],
    takeoffLon: path[0]?.[1],
    landingLat: path[path.length - 1]?.[0],
    landingLon: path[path.length - 1]?.[1],
    recordingId: id,
    hasTelemetry: true,
    source: "tlog",
    sourceFilename,
    updatedAt: Date.now(),
  };

  return { record, frames };
}
