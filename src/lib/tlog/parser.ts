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
import { decimatePath } from "../flight-lifecycle/decimate";
import { CRC_EXTRA } from "../protocol/mavlink-crc-extra";
import { crc16, crc16Accumulate } from "../protocol/mavlink-parser";

export interface TlogPacket {
  timestampUs: number;
  /** Raw MAVLink packet bytes (including STX, length, seq, sysid, compid, msgid, payload, checksum). */
  raw: Uint8Array;
}

export interface TlogParseOptions {
  /** Called with the fraction of the file read, at most every 1% of the file. */
  onProgress?: (fraction: number) => void;
}

/**
 * True when the packet at `start` carries a valid X.25 checksum. A message
 * whose CRC_EXTRA is unknown cannot be checked and is accepted.
 */
function checksumValid(bytes: Uint8Array, start: number, headerLen: number, msgId: number): boolean {
  const extra = CRC_EXTRA.get(msgId);
  if (extra === undefined) return true;
  const payloadLen = bytes[start + 1];
  const crcAt = start + headerLen + payloadLen;
  const crc = crc16Accumulate(extra, crc16(bytes, start + 1, headerLen - 1 + payloadLen));
  return crc === (bytes[crcAt] | (bytes[crcAt + 1] << 8));
}

/**
 * Parse a .tlog binary buffer into timestamped MAVLink packets.
 * Does NOT decode the MAVLink messages — returns raw packets with timestamps.
 *
 * A block whose packet does not start with a MAVLink start byte, or whose
 * checksum is wrong, is garbage (a torn write, a partial block, a start byte
 * inside a payload); the reader slides forward one byte at a time until a
 * timestamp + valid packet lines up again. A packet cut off by the end of
 * the file ends the parse.
 */
export function parseTlog(buffer: ArrayBuffer, options: TlogParseOptions = {}): TlogPacket[] {
  const { onProgress } = options;
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const packets: TlogPacket[] = [];
  const progressStep = Math.max(1, Math.floor(bytes.length / 100));
  let nextProgressAt = progressStep;
  let pos = 0;

  while (pos + 8 < bytes.length) {
    if (onProgress && pos >= nextProgressAt) {
      onProgress(pos / bytes.length);
      nextProgressAt = pos + progressStep;
    }
    const start = pos + 8;
    const stx = bytes[start];
    let packetLen: number;
    let headerLen: number;
    let msgId: number;

    if (stx === 0xfe) {
      // MAVLink v1: STX(1) + len(1) + seq(1) + sysid(1) + compid(1) + msgid(1) + payload(len) + crc(2)
      if (start + 6 > bytes.length) break;
      headerLen = 6;
      packetLen = headerLen + bytes[start + 1] + 2;
      msgId = bytes[start + 5];
    } else if (stx === 0xfd) {
      // MAVLink v2: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3) + payload(len) + crc(2) [+ sig(13)]
      if (start + 10 > bytes.length) break;
      const hasSig = (bytes[start + 2] & 0x01) !== 0;
      headerLen = 10;
      packetLen = headerLen + bytes[start + 1] + 2 + (hasSig ? 13 : 0);
      msgId = bytes[start + 7] | (bytes[start + 8] << 8) | (bytes[start + 9] << 16);
    } else {
      // Not a block boundary: try the next byte as the start of a timestamp.
      pos += 1;
      continue;
    }

    // A packet running past the end is either the file's cut-off last block
    // or a start byte inside garbage; keep sliding until the end either way.
    if (start + packetLen > bytes.length || !checksumValid(bytes, start, headerLen, msgId)) {
      pos += 1;
      continue;
    }

    packets.push({ timestampUs: Number(dv.getBigUint64(pos, false)), raw: bytes.slice(start, start + packetLen) });
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

/** HEARTBEAT `autopilot` of a component that is not a flight controller (a GCS, a camera). */
const MAV_AUTOPILOT_INVALID = 8;

/** Messages the record is built from. */
const DECODED_MSG_IDS = new Set([1, 30, 33]);

interface PacketHeader {
  msgId: number;
  payloadStart: number;
  /** `(sysid << 8) | compid` of the sender. */
  sender: number;
}

function headerOf(raw: Uint8Array): PacketHeader | null {
  if (raw[0] === 0xfd) {
    return { msgId: raw[7] | (raw[8] << 8) | (raw[9] << 16), payloadStart: 10, sender: (raw[5] << 8) | raw[6] };
  }
  if (raw[0] === 0xfe) return { msgId: raw[5], payloadStart: 6, sender: (raw[3] << 8) | raw[4] };
  return null;
}

/**
 * The autopilot the record describes: the component that sent the most
 * HEARTBEATs naming an autopilot, or, in a log without one, the sender of
 * the most position/attitude/battery messages. A ground station, companion
 * computer or second vehicle in the same log is left out.
 */
function primaryAutopilot(packets: TlogPacket[]): number | undefined {
  const heartbeats = new Map<number, number>();
  const decoded = new Map<number, number>();
  for (const { raw } of packets) {
    const header = headerOf(raw);
    if (!header) continue;
    if (header.msgId === 0) {
      // `autopilot` is payload byte 5; MAVLink 2 trims trailing zeros, and a
      // trimmed byte reads as 0 (MAV_AUTOPILOT_GENERIC).
      const autopilot = raw[1] > 5 ? raw[header.payloadStart + 5] : 0;
      if (autopilot !== MAV_AUTOPILOT_INVALID) {
        heartbeats.set(header.sender, (heartbeats.get(header.sender) ?? 0) + 1);
      }
    } else if (DECODED_MSG_IDS.has(header.msgId)) {
      decoded.set(header.sender, (decoded.get(header.sender) ?? 0) + 1);
    }
  }
  const tally = heartbeats.size > 0 ? heartbeats : decoded;
  let best: number | undefined;
  let bestCount = 0;
  for (const [sender, count] of tally) {
    if (count > bestCount) {
      best = sender;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Convert tlog packets into TelemetryFrames + a FlightRecord.
 *
 * Since full MAVLink decoding requires the parser state machine (which is
 * tightly coupled to the WebSocket stream), we do a simplified extraction
 * of the most common messages for history import. Only the primary
 * autopilot's messages are read. A field the vehicle reported as unknown
 * (its UINT16_MAX / -1 sentinel) is left out of the frame rather than
 * recorded as a reading.
 *
 * `fileId` identifies the log's content (a hash of its bytes), so importing
 * the same file again yields the same record id.
 */
export function tlogToFlightRecord(
  packets: TlogPacket[],
  fileId: string,
  sourceFilename?: string,
): { record: FlightRecord; frames: TelemetryFrame[] } | null {
  if (packets.length === 0) return null;

  const startUs = packets[0].timestampUs;
  const endUs = packets[packets.length - 1].timestampUs;
  const durationMs = (endUs - startUs) / 1000;
  const duration = Math.max(0, Math.round(durationMs / 1000));

  const id = `tlog-${fileId}`;
  const frames: TelemetryFrame[] = [];
  const autopilot = primaryAutopilot(packets);

  // Extract basic position data from GLOBAL_POSITION_INT (msg 33)
  const path: [number, number][] = [];
  let maxAlt = 0;
  let maxSpeed = 0;
  let distance = 0;
  let firstFix: [number, number] | null = null;
  let prevFix: [number, number] | null = null;

  for (const pkt of packets) {
    const raw = pkt.raw;
    const header = headerOf(raw);
    if (!header || header.sender !== autopilot) continue;
    const { msgId, payloadStart } = header;
    const offsetMs = (pkt.timestampUs - startUs) / 1000;
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
        firstFix ??= prevFix;
        path.push(prevFix);
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

  const cappedPath = decimatePath(path);

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
    takeoffLat: firstFix?.[0],
    takeoffLon: firstFix?.[1],
    landingLat: prevFix?.[0],
    landingLon: prevFix?.[1],
    recordingId: id,
    hasTelemetry: true,
    source: "tlog",
    sourceFilename,
    updatedAt: importedAt,
  };

  return { record, frames };
}
