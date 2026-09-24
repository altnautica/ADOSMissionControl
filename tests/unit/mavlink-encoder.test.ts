import { describe, it, expect } from 'vitest';
import {
  encodeHeartbeat,
  encodeSetMode,
  encodeParamSet,
  encodeManualControl,
  encodeMissionItemInt,
  encodeMissionCount,
  encodeMissionRequestInt,
  encodeMissionAck,
  encodeMissionClearAll,
  encodeSetGpsGlobalOrigin,
  encodeCommandLong,
  buildFrame,
} from '@/lib/protocol/mavlink-encoder';
import {
  MAVLinkParser,
  crc16,
  crc16Accumulate,
  CRC_EXTRA,
} from '@/lib/protocol/mavlink-parser';
import {
  decodeMissionItemInt,
  decodeMissionCount,
  decodeMissionRequestInt,
  decodeMissionAck,
} from '@/lib/protocol/mavlink-messages';

// ── Golden-byte helpers ──

/**
 * Recompute the 2-byte trailing CRC the way the wire spec defines it: CRC-16
 * over header bytes 1..(9+payloadLen) followed by the per-message CRC_EXTRA
 * seed. Asserting against this proves the encoder seeded CRC_EXTRA correctly
 * and laid the payload out at the offsets the CRC was taken over.
 */
function expectedCrc(frame: Uint8Array, msgId: number): { lo: number; hi: number } {
  const payloadLen = frame[1];
  let crc = crc16(frame, 1, 9 + payloadLen);
  crc = crc16Accumulate(CRC_EXTRA.get(msgId)!, crc);
  return { lo: crc & 0xff, hi: (crc >> 8) & 0xff };
}

/** Assert STX, payload length, sysid/compid, the 3 msgid bytes, and the CRC tail. */
function assertFrameEnvelope(
  frame: Uint8Array,
  msgId: number,
  payloadLen: number,
  sysId: number,
  compId: number,
): void {
  expect(frame[0]).toBe(0xfd); // STX
  expect(frame[1]).toBe(payloadLen); // payload length
  expect(frame[2]).toBe(0x00); // INC_FLAGS (unsigned)
  expect(frame[3]).toBe(0x00); // CMP_FLAGS
  expect(frame[5]).toBe(sysId);
  expect(frame[6]).toBe(compId);
  expect(frame[7]).toBe(msgId & 0xff);
  expect(frame[8]).toBe((msgId >> 8) & 0xff);
  expect(frame[9]).toBe((msgId >> 16) & 0xff);
  expect(frame.length).toBe(10 + payloadLen + 2);
  const { lo, hi } = expectedCrc(frame, msgId);
  expect(frame[10 + payloadLen]).toBe(lo);
  expect(frame[10 + payloadLen + 1]).toBe(hi);
}

/** A DataView over the payload region (offset 10) of a frame. */
function payloadView(frame: Uint8Array): DataView {
  return new DataView(frame.buffer, frame.byteOffset + 10, frame[1]);
}

/** Feed a frame through the real parser; return the single emitted frame or null. */
function roundTrip(frame: Uint8Array): import('@/lib/protocol/mavlink-parser').MAVLinkFrame | null {
  const parser = new MAVLinkParser();
  let out: import('@/lib/protocol/mavlink-parser').MAVLinkFrame | null = null;
  parser.onFrame((f) => {
    out = f;
  });
  parser.feed(frame);
  return out;
}

describe('encodeHeartbeat', () => {
  it('produces a valid MAVLink v2 frame', () => {
    const frame = encodeHeartbeat();
    expect(frame).toBeInstanceOf(Uint8Array);
    // MAVLink v2 STX byte
    expect(frame[0]).toBe(0xfd);
    // Payload length = 9 for heartbeat
    expect(frame[1]).toBe(9);
    // Message ID low byte = 0 (heartbeat)
    expect(frame[7]).toBe(0);
    expect(frame[8]).toBe(0);
    expect(frame[9]).toBe(0);
    // Total frame: 10 header + 9 payload + 2 CRC = 21
    expect(frame.length).toBe(21);
  });

  it('uses default sysId=255 and compId=190', () => {
    const frame = encodeHeartbeat();
    expect(frame[5]).toBe(255); // sysId
    expect(frame[6]).toBe(190); // compId
  });

  it('accepts custom sysId and compId', () => {
    const frame = encodeHeartbeat(1, 1);
    expect(frame[5]).toBe(1);
    expect(frame[6]).toBe(1);
  });
});

describe('encodeSetMode', () => {
  it('produces frame with correct message ID (11)', () => {
    const frame = encodeSetMode(1, 217, 5);
    expect(frame[0]).toBe(0xfd);
    // MSG ID = 11
    expect(frame[7]).toBe(11);
    expect(frame[8]).toBe(0);
    expect(frame[9]).toBe(0);
  });

  it('encodes target system and mode values', () => {
    const frame = encodeSetMode(1, 217, 5);
    const dv = new DataView(frame.buffer, frame.byteOffset);
    // Payload starts at offset 10
    // customMode (uint32 LE) at payload offset 0
    expect(dv.getUint32(10, true)).toBe(5);
    // targetSys at payload offset 4
    expect(frame[14]).toBe(1);
    // baseMode at payload offset 5
    expect(frame[15]).toBe(217);
  });
});

describe('encodeParamSet', () => {
  it('includes param name and value in frame', () => {
    const frame = encodeParamSet(1, 1, 'ARMING_CHECK', 1.0);
    expect(frame[0]).toBe(0xfd);
    // MSG ID = 23
    expect(frame[7]).toBe(23);

    // Payload starts at offset 10
    const dv = new DataView(frame.buffer, frame.byteOffset);
    // param_value (float32 LE) at payload offset 0
    expect(dv.getFloat32(10, true)).toBeCloseTo(1.0);

    // param_id starts at payload offset 6 (frame offset 16)
    const nameBytes = frame.slice(16, 16 + 16);
    const name = new TextDecoder().decode(nameBytes).replace(/\0+$/, '');
    expect(name).toBe('ARMING_CHECK');
  });
});

describe('encodeManualControl', () => {
  it('includes axis values in frame', () => {
    const frame = encodeManualControl(1, 500, -300, 700, -100, 0);
    expect(frame[0]).toBe(0xfd);
    // MSG ID = 69
    expect(frame[7]).toBe(69);

    const dv = new DataView(frame.buffer, frame.byteOffset);
    // Payload at offset 10: x(int16), y(int16), z(int16), r(int16), buttons(uint16), target(uint8)
    expect(dv.getInt16(10, true)).toBe(500);  // x (pitch)
    expect(dv.getInt16(12, true)).toBe(-300); // y (roll)
    expect(dv.getInt16(14, true)).toBe(700);  // z (throttle)
    expect(dv.getInt16(16, true)).toBe(-100); // r (yaw)
  });
});

describe('buildFrame', () => {
  it('builds a correctly structured MAVLink v2 frame', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const frame = buildFrame(42, payload, 255, 190, 0);
    expect(frame[0]).toBe(0xfd);       // STX
    expect(frame[1]).toBe(3);          // payload length
    expect(frame[4]).toBe(0);          // sequence
    expect(frame[5]).toBe(255);        // sysId
    expect(frame[6]).toBe(190);        // compId
    expect(frame[7]).toBe(42);         // msgId low
    // Total: 10 header + 3 payload + 2 CRC = 15
    expect(frame.length).toBe(15);
  });
});

// ── Byte-exact mission encoders ──
// A wrong offset, endianness, or CRC_EXTRA seed yields a frame the FC happily
// accepts and interprets as a waypoint at the wrong lat/lon/alt. These tests
// pin every payload field to its little-endian offset and prove the 2-byte CRC
// (including the per-message CRC_EXTRA) matches an independent recomputation,
// then round-trip the frame through the real parser as a second check.

describe('encodeMissionItemInt (ID 73)', () => {
  it('lays out every field at its little-endian offset for a standard waypoint', () => {
    const frame = encodeMissionItemInt(
      1, 1,
      7,            // seq
      3,            // frame (MAV_FRAME_GLOBAL_RELATIVE_ALT)
      16,           // command (NAV_WAYPOINT)
      0,            // current
      1,            // autocontinue
      1.5, 2.5, 3.5, 4.5, // param1..4
      128500000,    // x (lat degE7)
      775000000,    // y (lon degE7)
      42.25,        // z (alt)
      255, 190,     // sysId/compId
    );

    // missionType=0 -> 37-byte payload.
    assertFrameEnvelope(frame, 73, 37, 255, 190);

    const dv = payloadView(frame);
    expect(dv.getFloat32(0, true)).toBeCloseTo(1.5);
    expect(dv.getFloat32(4, true)).toBeCloseTo(2.5);
    expect(dv.getFloat32(8, true)).toBeCloseTo(3.5);
    expect(dv.getFloat32(12, true)).toBeCloseTo(4.5);
    expect(dv.getInt32(16, true)).toBe(128500000); // lat
    expect(dv.getInt32(20, true)).toBe(775000000); // lon
    expect(dv.getFloat32(24, true)).toBeCloseTo(42.25);
    expect(dv.getUint16(28, true)).toBe(7);   // seq
    expect(dv.getUint16(30, true)).toBe(16);  // command
    expect(dv.getUint8(32)).toBe(1);          // targetSys
    expect(dv.getUint8(33)).toBe(1);          // targetComp
    expect(dv.getUint8(34)).toBe(3);          // frame
    expect(dv.getUint8(35)).toBe(0);          // current
    expect(dv.getUint8(36)).toBe(1);          // autocontinue
  });

  it('round-trips through the parser with matching fields', () => {
    const frame = encodeMissionItemInt(
      1, 1, 2, 3, 16, 0, 1, 0, 0, 0, 0, -123456789, 987654321, 12.5, 255, 190,
    );
    const parsed = roundTrip(frame);
    expect(parsed).not.toBeNull();
    const decoded = decodeMissionItemInt(parsed!.payload);
    expect(decoded.seq).toBe(2);
    expect(decoded.command).toBe(16);
    expect(decoded.x).toBe(-123456789);
    expect(decoded.y).toBe(987654321);
    expect(decoded.z).toBeCloseTo(12.5);
    expect(decoded.frame).toBe(3);
    expect(decoded.missionType).toBe(0);
  });

  it('appends the missionType extension byte for rally items (missionType=2)', () => {
    const frame = encodeMissionItemInt(
      1, 1, 0, 6, 5100, 0, 0, 0, 0, 0, 0, 130000000, 780000000, 100, 255, 190, 2,
    );
    // missionType > 0 -> 38-byte payload.
    assertFrameEnvelope(frame, 73, 38, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getUint8(37)).toBe(2); // missionType

    const parsed = roundTrip(frame);
    expect(parsed).not.toBeNull();
    expect(decodeMissionItemInt(parsed!.payload).missionType).toBe(2);
  });
});

describe('encodeMissionCount (ID 44)', () => {
  it('encodes count as little-endian uint16 and round-trips', () => {
    const frame = encodeMissionCount(1, 1, 300, 255, 190);
    assertFrameEnvelope(frame, 44, 4, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getUint16(0, true)).toBe(300);
    expect(dv.getUint8(2)).toBe(1);
    expect(dv.getUint8(3)).toBe(1);

    const parsed = roundTrip(frame);
    expect(parsed).not.toBeNull();
    expect(decodeMissionCount(parsed!.payload).count).toBe(300);
  });

  it('adds the missionType extension byte when non-zero', () => {
    const frame = encodeMissionCount(1, 1, 2, 255, 190, 2);
    assertFrameEnvelope(frame, 44, 5, 255, 190);
    expect(payloadView(frame).getUint8(4)).toBe(2);
  });
});

describe('encodeMissionRequestInt (ID 51)', () => {
  it('encodes seq as little-endian uint16 and round-trips', () => {
    const frame = encodeMissionRequestInt(1, 1, 1000, 255, 190);
    assertFrameEnvelope(frame, 51, 4, 255, 190);
    expect(payloadView(frame).getUint16(0, true)).toBe(1000);

    const parsed = roundTrip(frame);
    expect(parsed).not.toBeNull();
    expect(decodeMissionRequestInt(parsed!.payload).seq).toBe(1000);
  });
});

describe('encodeMissionAck (ID 47)', () => {
  it('encodes target/type at the right offsets and round-trips', () => {
    const frame = encodeMissionAck(1, 1, 0, 255, 190);
    assertFrameEnvelope(frame, 47, 3, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getUint8(0)).toBe(1); // targetSys
    expect(dv.getUint8(1)).toBe(1); // targetComp
    expect(dv.getUint8(2)).toBe(0); // type (ACCEPTED)

    const parsed = roundTrip(frame);
    expect(parsed).not.toBeNull();
    expect(decodeMissionAck(parsed!.payload).type).toBe(0);
  });

  it('carries the missionType extension byte for rally acks', () => {
    const frame = encodeMissionAck(1, 1, 0, 255, 190, 2);
    assertFrameEnvelope(frame, 47, 4, 255, 190);
    expect(payloadView(frame).getUint8(3)).toBe(2);
  });
});

describe('encodeMissionClearAll (ID 45)', () => {
  it('encodes target system/component and round-trips through the parser', () => {
    const frame = encodeMissionClearAll(1, 1, 255, 190);
    assertFrameEnvelope(frame, 45, 2, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getUint8(0)).toBe(1);
    expect(dv.getUint8(1)).toBe(1);
    expect(roundTrip(frame)).not.toBeNull();
  });
});

// ── Byte-exact peripheral encoders ──

describe('encodeSetGpsGlobalOrigin (ID 48)', () => {
  it('encodes lat/lon/alt as int32 degE7/mm, target_system, and the zero time_usec extension', () => {
    const frame = encodeSetGpsGlobalOrigin(1, 128500000, 775000000, 920000, 255, 190);
    // 13 base + 8 time_usec extension = 21-byte payload.
    assertFrameEnvelope(frame, 48, 21, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getInt32(0, true)).toBe(128500000); // latitude (degE7)
    expect(dv.getInt32(4, true)).toBe(775000000); // longitude (degE7)
    expect(dv.getInt32(8, true)).toBe(920000);    // altitude (mm)
    expect(dv.getUint8(12)).toBe(1);              // target_system
    expect(dv.getBigUint64(13, true)).toBe(BigInt(0)); // time_usec extension (FC fills)
    expect(roundTrip(frame)).not.toBeNull();
  });

  it('preserves a negative longitude through the int32 encoding', () => {
    const frame = encodeSetGpsGlobalOrigin(1, -377000000, -1224000000, -5000, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getInt32(0, true)).toBe(-377000000);
    expect(dv.getInt32(4, true)).toBe(-1224000000);
    expect(dv.getInt32(8, true)).toBe(-5000);
    expect(roundTrip(frame)).not.toBeNull();
  });
});

describe('encodeCommandLong (ID 76) — confirmation byte on retry', () => {
  it('writes confirmation=0 on the first send', () => {
    const frame = encodeCommandLong(1, 1, 400, 1, 0, 0, 0, 0, 0, 0, 255, 190, 0);
    assertFrameEnvelope(frame, 76, 33, 255, 190);
    const dv = payloadView(frame);
    expect(dv.getUint16(28, true)).toBe(400); // command
    expect(dv.getUint8(30)).toBe(1);          // targetSys
    expect(dv.getUint8(31)).toBe(1);          // targetComp
    expect(dv.getUint8(32)).toBe(0);          // confirmation
    expect(roundTrip(frame)).not.toBeNull();
  });

  it('increments the confirmation count byte on a retried command', () => {
    const first = encodeCommandLong(1, 1, 400, 1, 0, 0, 0, 0, 0, 0, 255, 190, 0);
    const retry = encodeCommandLong(1, 1, 400, 1, 0, 0, 0, 0, 0, 0, 255, 190, 3);
    // Confirmation byte is the only payload difference; the CRC must track it.
    expect(payloadView(first).getUint8(32)).toBe(0);
    expect(payloadView(retry).getUint8(32)).toBe(3);
    // Each frame's CRC is internally consistent for its own payload.
    assertFrameEnvelope(retry, 76, 33, 255, 190);
    expect(roundTrip(retry)).not.toBeNull();
  });

  it('masks the confirmation count to a single byte', () => {
    const frame = encodeCommandLong(1, 1, 400, 0, 0, 0, 0, 0, 0, 0, 255, 190, 0x101);
    // 0x101 & 0xff = 0x01.
    expect(payloadView(frame).getUint8(32)).toBe(1);
  });
});
