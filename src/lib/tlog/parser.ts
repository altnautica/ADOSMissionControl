/**
 * Standard MAVLink `.tlog` file parser.
 *
 * tlog format: repeating blocks of [8-byte BIG-endian timestamp (µs since the
 * Unix epoch)] + [MAVLink v1/v2 packet]. The ground stations that write tlogs
 * store the timestamp in network byte order, and so does every reader. We
 * extract the timestamps and raw packets, then decode the few messages the
 * history import needs.
 *
 * @module tlog/parser
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import type { FlightRecord } from "../types";
import { haversineDistance } from "../geo/distance";

export interface TlogPacket {
  timestampUs: number;
  /** Raw MAVLink packet bytes (including STX, length, seq, sysid, compid, msgid, payload, checksum). */
  raw: Uint8Array;
}

/**
 * Parse a .tlog binary buffer into timestamped MAVLink packets.
 * Does NOT decode the MAVLink messages — returns raw packets with timestamps.
 *
 * A block whose packet does not start with a MAVLink start byte is garbage (a
 * torn write, a partial block); the reader slides forward one byte at a time
 * until a timestamp + start byte lines up again. A packet cut off by the end
 * of the file ends the parse.
 */
export function parseTlog(buffer: ArrayBuffer): TlogPacket[] {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const packets: TlogPacket[] = [];
  let pos = 0;

  while (pos + 8 < bytes.length) {
    const timestampUs = Number(dv.getBigUint64(pos, false));
    const start = pos + 8;
    const stx = bytes[start];
    let packetLen: number;

    if (stx === 0xfe) {
      // MAVLink v1: STX(1) + len(1) + seq(1) + sysid(1) + compid(1) + msgid(1) + payload(len) + crc(2)
      if (start + 6 > bytes.length) break;
      packetLen = 6 + bytes[start + 1] + 2;
    } else if (stx === 0xfd) {
      // MAVLink v2: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3) + payload(len) + crc(2) [+ sig(13)]
      if (start + 10 > bytes.length) break;
      const hasSig = (bytes[start + 2] & 0x01) !== 0;
      packetLen = 10 + bytes[start + 1] + 2 + (hasSig ? 13 : 0);
    } else {
      // Not a block boundary: try the next byte as the start of a timestamp.
      pos += 1;
      continue;
    }

    if (start + packetLen > bytes.length) break;

    packets.push({ timestampUs, raw: bytes.slice(start, start + packetLen) });
    pos = start + packetLen;
  }

  return packets;
}

/** Full (untrimmed) payload lengths of the messages decoded below. */
const GLOBAL_POSITION_INT_LEN = 28;
const ATTITUDE_LEN = 28;
const SYS_STATUS_LEN = 31;

/**
 * The packet's payload as a view at least `len` bytes long. MAVLink 2 strips
 * trailing zero bytes from a payload on the wire, so a message whose last
 * fields are zero (a heading of north, a zero yaw rate) arrives short; the
 * receiver restores the zeros before decoding.
 */
function payloadView(
  raw: Uint8Array,
  payloadStart: number,
  wireLen: number,
  len: number,
): DataView {
  if (wireLen >= len) return new DataView(raw.buffer, raw.byteOffset + payloadStart, wireLen);
  const padded = new Uint8Array(len);
  padded.set(raw.subarray(payloadStart, payloadStart + wireLen));
  return new DataView(padded.buffer);
}

/** Earliest tlog timestamp read as a real Unix-epoch time (2000-01-01). */
const MIN_EPOCH_US = 946_684_800_000_000;

/**
 * Convert tlog packets into TelemetryFrames + a FlightRecord.
 *
 * Since full MAVLink decoding requires the parser state machine (which is
 * tightly coupled to the WebSocket stream), we do a simplified extraction
 * of the most common messages for history import. A field the vehicle
 * reported as unknown (its UINT16_MAX / -1 sentinel) is left out of the frame
 * rather than recorded as a reading.
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
  let maxSpeed = 0;
  let distance = 0;
  let prevFix: [number, number] | null = null;
  let lastPathMs = -Infinity;

  for (const pkt of packets) {
    const raw = pkt.raw;
    const offsetMs = (pkt.timestampUs - startUs) / 1000;

    let msgId: number;
    let payloadStart: number;
    if (raw[0] === 0xfd) {
      msgId = raw[7] | (raw[8] << 8) | (raw[9] << 16);
      payloadStart = 10;
    } else if (raw[0] === 0xfe) {
      msgId = raw[5];
      payloadStart = 6;
    } else {
      continue;
    }
    const wireLen = raw[1];

    // GLOBAL_POSITION_INT (33): time_boot_ms, lat, lon, alt, relative_alt, vx, vy, vz, hdg
    if (msgId === 33) {
      const pdv = payloadView(raw, payloadStart, wireLen, GLOBAL_POSITION_INT_LEN);
      const lat = pdv.getInt32(4, true) / 1e7;
      const lon = pdv.getInt32(8, true) / 1e7;
      const alt = pdv.getInt32(12, true) / 1000;
      const relAlt = pdv.getInt32(16, true) / 1000;
      const vx = pdv.getInt16(20, true) / 100;
      const vy = pdv.getInt16(22, true) / 100;
      const hdg = pdv.getUint16(26, true);
      const gs = Math.sqrt(vx * vx + vy * vy);

      if (relAlt > maxAlt) maxAlt = relAlt;
      if (gs > maxSpeed) maxSpeed = gs;

      frames.push({
        offsetMs,
        channel: "globalPosition",
        data: {
          lat,
          lon,
          alt,
          relativeAlt: relAlt,
          groundSpeed: gs,
          // UINT16_MAX: the vehicle does not know its heading.
          ...(hdg !== 0xffff ? { heading: hdg / 100 } : {}),
        },
      });

      // A 0/0 position is "no fix", not a point on the flight path.
      if (lat !== 0 || lon !== 0) {
        if (prevFix) distance += haversineDistance(prevFix[0], prevFix[1], lat, lon);
        prevFix = [lat, lon];
        if (offsetMs - lastPathMs >= 1000) {
          path.push([lat, lon]);
          lastPathMs = offsetMs;
        }
      }
    }

    // ATTITUDE (30): roll, pitch, yaw in radians on the wire. Recorded
    // attitude frames are degrees, the same contract as live AttitudeData.
    if (msgId === 30) {
      const pdv = payloadView(raw, payloadStart, wireLen, ATTITUDE_LEN);
      const toDeg = 180 / Math.PI;
      frames.push({
        offsetMs,
        channel: "attitude",
        data: {
          roll: pdv.getFloat32(4, true) * toDeg,
          pitch: pdv.getFloat32(8, true) * toDeg,
          yaw: pdv.getFloat32(12, true) * toDeg,
        },
      });
    }

    // SYS_STATUS (1): voltage, current, remaining.
    //
    // Wire order is size-descending, so `battery_remaining` is the int8 at
    // offset 30 — offset 18 is `drop_rate_comm`, a uint16. The frame follows
    // the live battery contract: a vehicle with no battery monitor (voltage
    // UINT16_MAX) records no battery frame, an unmeasured current (-1) is
    // left out, and `remaining` keeps the -1 "not estimated" marker.
    if (msgId === 1) {
      const pdv = payloadView(raw, payloadStart, wireLen, SYS_STATUS_LEN);
      const voltageMv = pdv.getUint16(14, true);
      const currentCa = pdv.getInt16(16, true);
      if (voltageMv !== 0xffff) {
        frames.push({
          offsetMs,
          channel: "battery",
          data: {
            voltage: voltageMv / 1000,
            ...(currentCa !== -1 ? { current: currentCa / 100 } : {}),
            remaining: pdv.getInt8(30),
          },
        });
      }
    }
  }

  if (frames.length === 0) return null;

  const cappedPath = path.length > 1000
    ? path.filter((_, i) => i % Math.ceil(path.length / 1000) === 0)
    : path;

  const importedAt = Date.now();
  // The block timestamps are wall-clock µs, so the flight is dated from the
  // log itself; a log whose clock never left the epoch falls back to the
  // import time.
  const startTime = startUs >= MIN_EPOCH_US ? Math.round(startUs / 1000) : importedAt;
  const record: FlightRecord = {
    id,
    droneId: `tlog-${startUs}`,
    droneName: sourceFilename?.replace(/\.tlog$/i, "") ?? "MAVLink Import",
    date: startTime,
    startTime,
    endTime: startTime + duration * 1000,
    duration,
    distance,
    maxAlt,
    maxSpeed,
    avgSpeed: duration > 0 ? distance / duration : 0,
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
    updatedAt: importedAt,
  };

  return { record, frames };
}
