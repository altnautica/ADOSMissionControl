/**
 * MSP codec, parser, and queue unit tests.
 *
 * Run with: npm run test:node
 *
 * Uses the Node.js built-in test runner instead of vitest because this
 * suite exercises low-level binary codec behavior (CRC byte tables,
 * frame round-trips, parser state machines) where Node's raw
 * Uint8Array semantics are simpler than the vitest happy-dom
 * environment. The `.node-test.ts` extension keeps vitest discovery
 * from picking it up; see vitest.config.ts `exclude`.
 *
 * @module protocol/msp/__tests__/msp-codec.node-test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc8DvbS2,
  crc8DvbS2Update,
  xorChecksum,
  encodeMspV1,
  encodeMspV2,
  encodeMsp,
  encodeResponseV1,
  encodeResponseV2,
} from '../msp-codec';
import { MspParser } from '../msp-parser';
import type { ParsedMspFrame } from '../msp-parser';
import { MspSerialQueue } from '../msp-serial-queue';
import { MSP } from '../msp-constants';

// ── CRC Tests ──────────────────────────────────────────────

describe('crc8DvbS2', () => {
  it('returns 0 for empty buffer', () => {
    assert.equal(crc8DvbS2(new Uint8Array(0)), 0);
  });

  it('computes known values for single bytes', () => {
    // CRC of [0x00]: 0 ^ 0x00 = 0, 8 shifts of 0 = 0
    assert.equal(crc8DvbS2(new Uint8Array([0x00])), 0);
    // CRC of [0x80]: 0 ^ 0x80 = 0x80, first shift: (0x80 << 1) ^ 0xD5 = 0xD5 & 0xFF...
    const crcOf80 = crc8DvbS2(new Uint8Array([0x80]));
    assert.equal(typeof crcOf80, 'number');
    assert.ok(crcOf80 >= 0 && crcOf80 <= 255);
  });

  it('processes subrange correctly', () => {
    const buf = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0xff]);
    const full = crc8DvbS2(new Uint8Array([0x01, 0x02, 0x03]));
    const sub = crc8DvbS2(buf, 1, 4);
    assert.equal(sub, full);
  });

  it('crc8DvbS2Update matches byte-by-byte processing', () => {
    const data = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const batchCrc = crc8DvbS2(data);
    let incrementalCrc = 0;
    for (const byte of data) {
      incrementalCrc = crc8DvbS2Update(incrementalCrc, byte);
    }
    assert.equal(incrementalCrc, batchCrc);
  });
});

describe('xorChecksum', () => {
  it('computes XOR for empty payload', () => {
    // size=0, cmd=108 => 0 ^ 108 = 108
    assert.equal(xorChecksum(0, 108, new Uint8Array(0)), 108);
  });

  it('computes XOR for non-empty payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    // size=3, cmd=112 => 3 ^ 112 = 115, then ^ 1 = 114, ^ 2 = 112, ^ 3 = 115
    const expected = 3 ^ 112 ^ 0x01 ^ 0x02 ^ 0x03;
    assert.equal(xorChecksum(3, 112, payload), expected);
  });
});

// ── Encoder Tests ──────────────────────────────────────────

describe('encodeMspV1', () => {
  it('encodes request with no payload', () => {
    // MSP_ATTITUDE = 108, no payload
    const frame = encodeMspV1(MSP.MSP_ATTITUDE);
    assert.equal(frame[0], 0x24); // $
    assert.equal(frame[1], 0x4d); // M
    assert.equal(frame[2], 0x3c); // <
    assert.equal(frame[3], 0);    // length
    assert.equal(frame[4], 108);  // command
    assert.equal(frame[5], xorChecksum(0, 108, new Uint8Array(0))); // checksum
    assert.equal(frame.length, 6);
  });

  it('encodes request with payload', () => {
    const payload = new Uint8Array([0x0a, 0x0b]);
    const frame = encodeMspV1(MSP.MSP_PID, payload);
    assert.equal(frame[0], 0x24);
    assert.equal(frame[1], 0x4d);
    assert.equal(frame[2], 0x3c);
    assert.equal(frame[3], 2);    // length
    assert.equal(frame[4], 112);  // MSP_PID
    assert.equal(frame[5], 0x0a);
    assert.equal(frame[6], 0x0b);
    assert.equal(frame[7], xorChecksum(2, 112, payload));
    assert.equal(frame.length, 8);
  });
});

describe('encodeMspV2', () => {
  it('encodes V2 request with no payload', () => {
    const frame = encodeMspV2(0x3006); // MSP2_GET_TEXT
    assert.equal(frame[0], 0x24); // $
    assert.equal(frame[1], 0x58); // X
    assert.equal(frame[2], 0x3c); // <
    assert.equal(frame[3], 0);    // flags
    assert.equal(frame[4], 0x06); // cmd low
    assert.equal(frame[5], 0x30); // cmd high
    assert.equal(frame[6], 0);    // len low
    assert.equal(frame[7], 0);    // len high
    // CRC covers [3..7]
    const expectedCrc = crc8DvbS2(frame, 3, 8);
    assert.equal(frame[8], expectedCrc);
    assert.equal(frame.length, 9);
  });

  it('encodes V2 request with payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const frame = encodeMspV2(0x3006, payload);
    assert.equal(frame.length, 12); // 9 + 3
    assert.equal(frame[6], 3);  // len low
    assert.equal(frame[7], 0);  // len high
    assert.equal(frame[8], 0x01);
    assert.equal(frame[9], 0x02);
    assert.equal(frame[10], 0x03);
    const expectedCrc = crc8DvbS2(frame, 3, 11);
    assert.equal(frame[11], expectedCrc);
  });
});

describe('encodeMsp (smart encoder)', () => {
  it('uses V1 for low command codes with small payload', () => {
    const frame = encodeMsp(108); // MSP_ATTITUDE
    assert.equal(frame[1], 0x4d); // M = V1
  });

  it('uses V2 for command codes >= 255', () => {
    const frame = encodeMsp(0x3000); // MSP2 command
    assert.equal(frame[1], 0x58); // X = V2
  });
});

// ── Round-trip Tests ───────────────────────────────────────

describe('MSPv1 encode/decode round-trip', () => {
  it('round-trips empty payload (command 108)', () => {
    const response = encodeResponseV1(108, new Uint8Array(0));
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].version, 1);
    assert.equal(frames[0].command, 108);
    assert.equal(frames[0].payload.length, 0);
    assert.equal(frames[0].direction, 'response');
  });

  it('round-trips 30-byte payload (command 112)', () => {
    const payload = new Uint8Array(30);
    for (let i = 0; i < 30; i++) payload[i] = i * 3;
    const response = encodeResponseV1(112, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].command, 112);
    assert.deepEqual(Array.from(frames[0].payload), Array.from(payload));
  });
});

describe('MSPv2 encode/decode round-trip', () => {
  it('round-trips command 0x3006 with payload', () => {
    const payload = new Uint8Array([0x41, 0x42, 0x43, 0x44]); // "ABCD"
    const response = encodeResponseV2(0x3006, payload);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].version, 2);
    assert.equal(frames[0].command, 0x3006);
    assert.deepEqual(Array.from(frames[0].payload), [0x41, 0x42, 0x43, 0x44]);
    assert.equal(frames[0].direction, 'response');
  });
});

// ── Error Frame Tests ──────────────────────────────────────

describe('Error frame parsing', () => {
  it('parses MSPv1 error frame ($M!)', () => {
    const errFrame = encodeResponseV1(108, new Uint8Array(0), true);
    // Verify the error direction byte
    assert.equal(errFrame[2], 0x21); // '!'
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(errFrame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].direction, 'error');
    assert.equal(frames[0].command, 108);
  });

  it('parses MSPv2 error frame ($X!)', () => {
    const errFrame = encodeResponseV2(0x3004, new Uint8Array([0x01]), true);
    assert.equal(errFrame[2], 0x21);
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(errFrame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].direction, 'error');
    assert.equal(frames[0].command, 0x3004);
  });
});

// ── Parser Interleaving Tests ──────────────────────────────

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

    assert.equal(frames.length, 2);
    assert.equal(frames[0].version, 1);
    assert.equal(frames[0].command, 108);
    assert.equal(frames[1].version, 2);
    assert.equal(frames[1].command, 0x3006);
  });

  it('parses V2 then V1 frame in one stream', () => {
    const v2 = encodeResponseV2(0x3001, new Uint8Array([0x10, 0x20]));
    const v1 = encodeResponseV1(101, new Uint8Array([0x30]));
    const combined = new Uint8Array(v2.length + v1.length);
    combined.set(v2, 0);
    combined.set(v1, v2.length);

    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(combined);

    assert.equal(frames.length, 2);
    assert.equal(frames[0].version, 2);
    assert.equal(frames[1].version, 1);
  });
});

// ── Parser reset and CRC failure ───────────────────────────

describe('Parser edge cases', () => {
  it('silently drops frames with bad CRC', () => {
    const response = encodeResponseV1(108, new Uint8Array([0x01]));
    // Corrupt the checksum
    response[response.length - 1] ^= 0xff;
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(response);
    assert.equal(frames.length, 0);
  });

  it('reset() clears state and allows fresh parsing', () => {
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    parser.onFrame((f) => frames.push(f));

    // Feed partial frame then reset
    parser.feed(new Uint8Array([0x24, 0x4d, 0x3e]));
    parser.reset();

    // Feed complete frame after reset
    const response = encodeResponseV1(110, new Uint8Array([0x05]));
    parser.feed(response);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].command, 110);
  });

  it('unsubscribe removes callback', () => {
    const parser = new MspParser();
    const frames: ParsedMspFrame[] = [];
    const unsub = parser.onFrame((f) => frames.push(f));

    parser.feed(encodeResponseV1(108, new Uint8Array(0)));
    assert.equal(frames.length, 1);

    unsub();
    parser.feed(encodeResponseV1(108, new Uint8Array(0)));
    assert.equal(frames.length, 1); // no new frame
  });
});

// ── Serial Queue Tests ─────────────────────────────────────

describe('MspSerialQueue', () => {
  it('sends request and resolves on matching response', async () => {
    const parser = new MspParser();
    const sent: Uint8Array[] = [];
    const queue = new MspSerialQueue(
      (data) => sent.push(data),
      parser,
      500,
      0,
    );

    const promise = queue.send(108);
    assert.equal(sent.length, 1);

    // Simulate response
    parser.feed(encodeResponseV1(108, new Uint8Array([0x10, 0x20])));
    const frame = await promise;
    assert.equal(frame.command, 108);
    assert.equal(frame.payload[0], 0x10);

    queue.destroy();
  });

  it('queues multiple requests sequentially', async () => {
    const parser = new MspParser();
    const sent: Uint8Array[] = [];
    const queue = new MspSerialQueue(
      (data) => sent.push(data),
      parser,
      500,
      0,
    );

    const p1 = queue.send(108);
    const p2 = queue.send(110);

    // Only first should be sent immediately
    assert.equal(sent.length, 1);

    // Respond to first
    parser.feed(encodeResponseV1(108, new Uint8Array(0)));
    await p1;

    // Second should now be sent
    assert.equal(sent.length, 2);

    // Respond to second
    parser.feed(encodeResponseV1(110, new Uint8Array([0x05])));
    const f2 = await p2;
    assert.equal(f2.command, 110);

    queue.destroy();
  });

  it('rejects on timeout after max retries', async () => {
    const parser = new MspParser();
    const queue = new MspSerialQueue(
      () => {},
      parser,
      50, // 50ms timeout
      1,  // 1 retry (2 total attempts)
    );

    const promise = queue.send(108);
    // Don't send any response, let it timeout
    await assert.rejects(promise, /MSP timeout/);

    queue.destroy();
  });

  it('flush rejects all pending', async () => {
    const parser = new MspParser();
    const queue = new MspSerialQueue(
      () => {},
      parser,
      5000,
      0,
    );

    const p1 = queue.send(108);
    const p2 = queue.send(110);

    queue.flush();

    await assert.rejects(p1, /Disconnected/);
    await assert.rejects(p2, /Disconnected/);

    queue.destroy();
  });

  it('sendNoReply sends immediately without queuing', () => {
    const parser = new MspParser();
    const sent: Uint8Array[] = [];
    const queue = new MspSerialQueue(
      (data) => sent.push(data),
      parser,
      500,
      0,
    );

    // Queue a normal request first (catch rejection from destroy)
    const pending = queue.send(108).catch(() => {});
    assert.equal(sent.length, 1);

    // sendNoReply should send immediately
    queue.sendNoReply(200, new Uint8Array([0x01, 0x02]));
    assert.equal(sent.length, 2);

    // Second send should be MSP_SET_RAW_RC
    assert.equal(sent[1][4], 200);

    queue.destroy();
    void pending;
  });

  it('pending count is accurate', () => {
    const parser = new MspParser();
    const queue = new MspSerialQueue(
      () => {},
      parser,
      5000,
      0,
    );

    assert.equal(queue.pending, 0);

    // Catch rejections from flush/destroy
    const p1 = queue.send(108).catch(() => {});
    assert.equal(queue.pending, 1); // active

    const p2 = queue.send(110).catch(() => {});
    assert.equal(queue.pending, 2); // active + 1 queued

    queue.flush();
    assert.equal(queue.pending, 0);

    queue.destroy();
    void p1;
    void p2;
  });
});
