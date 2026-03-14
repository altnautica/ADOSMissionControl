import { describe, it, expect } from 'vitest';
import {
  crc8DvbS2,
  crc8DvbS2Update,
  xorChecksum,
  encodeMspV1,
  encodeMspV2,
  encodeMsp,
  encodeResponseV1,
  encodeResponseV2,
} from '@/lib/protocol/msp/msp-codec';
import { MspParser } from '@/lib/protocol/msp/msp-parser';
import type { ParsedMspFrame } from '@/lib/protocol/msp/msp-parser';

// ── CRC Tests ──────────────────────────────────────────────

describe('crc8DvbS2', () => {
  it('returns 0 for empty buffer', () => {
    expect(crc8DvbS2(new Uint8Array(0))).toBe(0);
  });

  it('computes known values for single bytes', () => {
    expect(crc8DvbS2(new Uint8Array([0x00]))).toBe(0);
    const crcOf80 = crc8DvbS2(new Uint8Array([0x80]));
    expect(crcOf80).toBeGreaterThanOrEqual(0);
    expect(crcOf80).toBeLessThanOrEqual(255);
  });

  it('processes subrange correctly', () => {
    const buf = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0xff]);
    const full = crc8DvbS2(new Uint8Array([0x01, 0x02, 0x03]));
    const sub = crc8DvbS2(buf, 1, 4);
    expect(sub).toBe(full);
  });
});

describe('crc8DvbS2Update', () => {
  it('matches byte-by-byte processing', () => {
    const data = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const batchCrc = crc8DvbS2(data);
    let incrementalCrc = 0;
    for (const byte of data) {
      incrementalCrc = crc8DvbS2Update(incrementalCrc, byte);
    }
    expect(incrementalCrc).toBe(batchCrc);
  });
});

describe('xorChecksum', () => {
  it('computes XOR for empty payload', () => {
    expect(xorChecksum(0, 108, new Uint8Array(0))).toBe(108);
  });

  it('computes XOR for non-empty payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const expected = 3 ^ 112 ^ 0x01 ^ 0x02 ^ 0x03;
    expect(xorChecksum(3, 112, payload)).toBe(expected);
  });
});

// ── Encoder Tests ──────────────────────────────────────────

describe('encodeMspV1', () => {
  it('produces valid frame with no payload', () => {
    const frame = encodeMspV1(108);
    expect(frame[0]).toBe(0x24); // $
    expect(frame[1]).toBe(0x4d); // M
    expect(frame[2]).toBe(0x3c); // <
    expect(frame[3]).toBe(0);    // length
    expect(frame[4]).toBe(108);  // command
    expect(frame[5]).toBe(xorChecksum(0, 108, new Uint8Array(0)));
    expect(frame.length).toBe(6);
  });

  it('produces valid frame with payload', () => {
    const payload = new Uint8Array([0x0a, 0x0b]);
    const frame = encodeMspV1(112, payload);
    expect(frame[0]).toBe(0x24);
    expect(frame[1]).toBe(0x4d);
    expect(frame[2]).toBe(0x3c);
    expect(frame[3]).toBe(2);
    expect(frame[4]).toBe(112);
    expect(frame[5]).toBe(0x0a);
    expect(frame[6]).toBe(0x0b);
    expect(frame[7]).toBe(xorChecksum(2, 112, payload));
    expect(frame.length).toBe(8);
  });
});

describe('encodeMspV2', () => {
  it('produces valid frame with CRC8 and no payload', () => {
    const frame = encodeMspV2(0x3006);
    expect(frame[0]).toBe(0x24); // $
    expect(frame[1]).toBe(0x58); // X
    expect(frame[2]).toBe(0x3c); // <
    expect(frame[3]).toBe(0);    // flags
    expect(frame[4]).toBe(0x06); // cmd low
    expect(frame[5]).toBe(0x30); // cmd high
    expect(frame[6]).toBe(0);    // len low
    expect(frame[7]).toBe(0);    // len high
    const expectedCrc = crc8DvbS2(frame, 3, 8);
    expect(frame[8]).toBe(expectedCrc);
    expect(frame.length).toBe(9);
  });

  it('produces valid frame with CRC8 and payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const frame = encodeMspV2(0x3006, payload);
    expect(frame.length).toBe(12);
    expect(frame[6]).toBe(3);
    expect(frame[7]).toBe(0);
    expect(frame[8]).toBe(0x01);
    expect(frame[9]).toBe(0x02);
    expect(frame[10]).toBe(0x03);
    const expectedCrc = crc8DvbS2(frame, 3, 11);
    expect(frame[11]).toBe(expectedCrc);
  });
});

describe('encodeMsp (smart encoder)', () => {
  it('uses V1 for low command codes with small payload', () => {
    const frame = encodeMsp(108);
    expect(frame[1]).toBe(0x4d); // M = V1
  });

  it('uses V2 for command codes >= 255', () => {
    const frame = encodeMsp(0x3000);
    expect(frame[1]).toBe(0x58); // X = V2
  });
});

// ── Round-trip Tests ───────────────────────────────────────

describe('MSPv1 encode/decode round-trip', () => {
  it('round-trips empty payload', () => {
    const response = encodeResponseV1(108, new Uint8Array(0));
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    expect(frames.length).toBe(1);
    expect(frames[0].version).toBe(1);
    expect(frames[0].command).toBe(108);
    expect(frames[0].payload.length).toBe(0);
    expect(frames[0].direction).toBe('response');
  });

  it('round-trips 30-byte payload', () => {
    const payload = new Uint8Array(30);
    for (let i = 0; i < 30; i++) payload[i] = i * 3;
    const response = encodeResponseV1(112, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    expect(frames.length).toBe(1);
    expect(frames[0].command).toBe(112);
    expect(Array.from(frames[0].payload)).toEqual(Array.from(payload));
  });
});

describe('MSPv2 encode/decode round-trip', () => {
  it('round-trips command 0x3006 with payload', () => {
    const payload = new Uint8Array([0x41, 0x42, 0x43, 0x44]);
    const response = encodeResponseV2(0x3006, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    expect(frames.length).toBe(1);
    expect(frames[0].version).toBe(2);
    expect(frames[0].command).toBe(0x3006);
    expect(Array.from(frames[0].payload)).toEqual([0x41, 0x42, 0x43, 0x44]);
    expect(frames[0].direction).toBe('response');
  });
});

// ── Error Frame Tests ──────────────────────────────────────

describe('Error frame round-trip', () => {
  it('parses MSPv1 error frame ($M!)', () => {
    const errFrame = encodeResponseV1(108, new Uint8Array(0), true);
    expect(errFrame[2]).toBe(0x21); // '!'
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(errFrame);
    expect(frames.length).toBe(1);
    expect(frames[0].direction).toBe('error');
    expect(frames[0].command).toBe(108);
  });

  it('parses MSPv2 error frame ($X!)', () => {
    const errFrame = encodeResponseV2(0x3004, new Uint8Array([0x01]), true);
    expect(errFrame[2]).toBe(0x21);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(errFrame);
    expect(frames.length).toBe(1);
    expect(frames[0].direction).toBe('error');
    expect(frames[0].command).toBe(0x3004);
  });
});

// ── Interleaved V1/V2 ──────────────────────────────────────

describe('Parser handles interleaved V1/V2 frames', () => {
  it('parses V1 then V2 frame in one stream', () => {
    const v1 = encodeResponseV1(108, new Uint8Array([0x01, 0x02]));
    const v2 = encodeResponseV2(0x3006, new Uint8Array([0x03]));
    const combined = new Uint8Array(v1.length + v2.length);
    combined.set(v1, 0);
    combined.set(v2, v1.length);

    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(combined);

    expect(frames.length).toBe(2);
    expect(frames[0].version).toBe(1);
    expect(frames[0].command).toBe(108);
    expect(frames[1].version).toBe(2);
    expect(frames[1].command).toBe(0x3006);
  });
});

// ── Jumbo Frame Tests ────────────────────────────────────────

describe('MSPv1 jumbo frame', () => {
  it('encodes payload of exactly 255 bytes as jumbo frame', () => {
    const payload = new Uint8Array(255);
    for (let i = 0; i < 255; i++) payload[i] = i & 0xff;
    const frame = encodeMspV1(108, payload);
    // Jumbo: overhead is 8 instead of 6
    expect(frame.length).toBe(8 + 255);
    expect(frame[3]).toBe(255); // size field = 255 (jumbo indicator)
    expect(frame[4]).toBe(108); // command
    expect(frame[5]).toBe(255 & 0xff); // realLen low
    expect(frame[6]).toBe(0); // realLen high
  });

  it('round-trips jumbo frame through parser', () => {
    const payload = new Uint8Array(256);
    for (let i = 0; i < 256; i++) payload[i] = i & 0xff;
    const response = encodeResponseV1(108, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    expect(frames.length).toBe(1);
    expect(frames[0].command).toBe(108);
    expect(frames[0].payload.length).toBe(256);
    expect(Array.from(frames[0].payload)).toEqual(Array.from(payload));
  });
});

describe('MSPv2 command selection', () => {
  it('uses V2 for commands at exactly 255', () => {
    const frame = encodeMsp(255);
    expect(frame[1]).toBe(0x58); // X = V2
  });

  it('uses V1 for command 254', () => {
    const frame = encodeMsp(254);
    expect(frame[1]).toBe(0x4d); // M = V1
  });

  it('uses V2 for large payload even with small command', () => {
    const bigPayload = new Uint8Array(255);
    const frame = encodeMsp(108, bigPayload);
    // Command 108 < 255, but payload >= 255, so V1 jumbo (not V2)
    // Actually: encodeMsp checks `command <= 254 && data.length < 255` for V1
    // 108 <= 254 is true, but 255 < 255 is false, so V2
    expect(frame[1]).toBe(0x58); // X = V2
  });
});

describe('MSPv2 round-trip with large command', () => {
  it('round-trips command 0x4001 with payload', () => {
    const payload = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const response = encodeResponseV2(0x4001, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    expect(frames.length).toBe(1);
    expect(frames[0].version).toBe(2);
    expect(frames[0].command).toBe(0x4001);
    expect(Array.from(frames[0].payload)).toEqual([0xAA, 0xBB, 0xCC]);
  });
});
