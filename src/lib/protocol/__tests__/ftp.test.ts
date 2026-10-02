/**
 * @module protocol/ftp.test
 * @description Unit tests for the MAVLink FILE_TRANSFER_PROTOCOL (msg 110)
 * encoder/decoder round trip, the independently-derived CRC_EXTRA seed, and the
 * read-only FTP session state machine (burst-append/offset sequencing, EOF, and
 * the CalcFileCRC32 -> Terminate teardown).
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { encodeFileTransferProtocol, FTP_MAX_DATA } from "../mavlink-encoder";
import { decodeFileTransferProtocol, FtpOpcode, FtpError } from "../mavlink-messages";
import { MAVLinkParser, crc16Accumulate, CRC_EXTRA, PAYLOAD_LENGTHS, type MAVLinkFrame } from "../mavlink-parser";
import { downloadFileViaFtp, cancelFtp, handleFileTransferProtocolAck, type FtpContext } from "../mavlink-adapter-ftp";
import type { Transport } from "../types";

/** Extract the payload DataView from a built MAVLink v2 frame (len at byte 1). */
function payloadOf(frame: Uint8Array): DataView {
  const payloadLen = frame[1];
  const payload = frame.subarray(10, 10 + payloadLen);
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

/** Build a synthetic FTP response (ACK/NAK) frame payload as the FC would send. */
function ftpResponse(o: {
  session: number;
  opcode: number;
  reqOpcode: number;
  size: number;
  offset?: number;
  burstComplete?: number;
  seq?: number;
  data?: Uint8Array;
}): MAVLinkFrame {
  const p = new Uint8Array(254);
  const dv = new DataView(p.buffer);
  p[0] = 0; // target_network
  p[1] = 255; // target_system (GCS)
  p[2] = 190; // target_component
  const base = 3;
  dv.setUint16(base + 0, o.seq ?? 0, true);
  p[base + 2] = o.session;
  p[base + 3] = o.opcode;
  p[base + 4] = o.size;
  p[base + 5] = o.reqOpcode;
  p[base + 6] = o.burstComplete ?? 0;
  p[base + 7] = 0;
  dv.setUint32(base + 8, (o.offset ?? 0) >>> 0, true);
  if (o.data) p.set(o.data.subarray(0, FTP_MAX_DATA), base + 12);
  return { msgId: 110, systemId: 1, componentId: 1, sequence: 0, payload: dv, timestamp: 0 };
}

/** u32 LE helper for a size / crc value carried in the FTP data field. */
function u32le(value: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return b;
}

/** Standard IEEE 802.3 (zlib) CRC-32, matching the FTP client's advisory check. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mockTransport(sent: Uint8Array[]): Transport {
  return { isConnected: true, send: (f: Uint8Array) => { sent.push(f); } } as unknown as Transport;
}

describe("FILE_TRANSFER_PROTOCOL CRC_EXTRA + payload length", () => {
  it("derives CRC_EXTRA = 84 from the message signature (independent of the table)", () => {
    // MAVLink CRC_EXTRA: X.25 CRC over "NAME " then, per field in wire order,
    // "type " "name ", plus the array-length byte for array fields; folded to 8 bits.
    const accStr = (s: string, crc: number) => {
      for (let i = 0; i < s.length; i++) crc = crc16Accumulate(s.charCodeAt(i), crc);
      return crc;
    };
    let crc = 0xffff;
    crc = accStr("FILE_TRANSFER_PROTOCOL ", crc);
    // All four fields are uint8_t, so declared order == wire order.
    crc = accStr("uint8_t target_network ", crc);
    crc = accStr("uint8_t target_system ", crc);
    crc = accStr("uint8_t target_component ", crc);
    crc = accStr("uint8_t payload ", crc);
    crc = crc16Accumulate(251, crc); // payload is uint8_t[251]
    const extra = (crc ^ (crc >> 8)) & 0xff;
    expect(extra).toBe(84);
    expect(CRC_EXTRA.get(110)).toBe(84);
  });

  it("registers the canonical payload length (254 bytes)", () => {
    expect(PAYLOAD_LENGTHS.get(110)).toBe(254);
  });
});

describe("encodeFileTransferProtocol / decodeFileTransferProtocol", () => {
  it("round-trips an OpenFileRO request through the real parser (CRC valid)", () => {
    const path = new TextEncoder().encode("/APM/LOGS/1.BIN");
    const frame = encodeFileTransferProtocol(1, 1, 0, FtpOpcode.OpenFileRO, 3, 0, path.length, path);

    // Feed the full frame through the parser: emission proves the CRC (seed 84) is right.
    const parser = new MAVLinkParser();
    const frames: MAVLinkFrame[] = [];
    parser.onFrame((f) => frames.push(f));
    parser.feed(frame);

    expect(frames).toHaveLength(1);
    expect(frames[0].msgId).toBe(110);

    const m = decodeFileTransferProtocol(frames[0].payload);
    expect(m.targetSystem).toBe(1);
    expect(m.targetComponent).toBe(1);
    expect(m.seq).toBe(3);
    expect(m.session).toBe(0);
    expect(m.opcode).toBe(FtpOpcode.OpenFileRO);
    expect(m.size).toBe(path.length);
    expect(m.offset).toBe(0);
    expect(m.data.subarray(0, path.length)).toEqual(path);
  });

  it("preserves 32-bit offset and burst fields on decode", () => {
    // Build directly so we can exercise reqOpcode / burst_complete like an ACK.
    const data = new Uint8Array([1, 2, 3, 4]);
    const frame = ftpResponse({
      session: 5, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0xdeadbeef, burstComplete: 1, seq: 42, data,
    });
    const m = decodeFileTransferProtocol(frame.payload);
    expect(m.session).toBe(5);
    expect(m.opcode).toBe(FtpOpcode.Ack);
    expect(m.reqOpcode).toBe(FtpOpcode.BurstReadFile);
    expect(m.size).toBe(4);
    expect(m.offset).toBe(0xdeadbeef);
    expect(m.burstComplete).toBe(1);
    expect(m.seq).toBe(42);
    expect(m.data.subarray(0, 4)).toEqual(data);
  });
});

describe("FTP read session state machine", () => {
  it("opens, streams bursts by offset, verifies CRC, and terminates", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const progress: Array<[number, number]> = [];

    const fileSize = 500;
    const expected = new Uint8Array(fileSize);
    for (let i = 0; i < fileSize; i++) expected[i] = (i * 7) & 0xff;

    const promise = downloadFileViaFtp(ctx, "/log.bin", (r, t) => progress.push([r, t]));

    // First frame out = OpenFileRO with the path.
    expect(sent).toHaveLength(1);
    const open = decodeFileTransferProtocol(payloadOf(sent[0]));
    expect(open.opcode).toBe(FtpOpcode.OpenFileRO);
    expect(new TextDecoder().decode(open.data.subarray(0, open.size))).toBe("/log.bin");

    // Server acks OpenFileRO with session 7 and the file size.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 7, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(fileSize),
    }));

    // Client issues a BurstReadFile at offset 0 on the new session.
    expect(sent).toHaveLength(2);
    const burst = decodeFileTransferProtocol(payloadOf(sent[1]));
    expect(burst.opcode).toBe(FtpOpcode.BurstReadFile);
    expect(burst.session).toBe(7);
    expect(burst.offset).toBe(0);

    // Stream the file in three burst packets keyed by offset.
    const chunks: Array<[number, number]> = [[0, 239], [239, 239], [478, 22]];
    for (const [ofs, len] of chunks) {
      handleFileTransferProtocolAck(ctx, ftpResponse({
        session: 7, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
        size: len, offset: ofs, burstComplete: ofs + len >= fileSize ? 1 : 0,
        data: expected.subarray(ofs, ofs + len),
      }));
    }

    // Reaching fileSize triggers CalcFileCRC32.
    const crcReq = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(crcReq.opcode).toBe(FtpOpcode.CalcFileCRC32);

    // Answer the CRC with the matching value, then the client terminates + resolves.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 7, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32,
      size: 4, data: u32le(crc32(expected)),
    }));

    const terminate = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(terminate.opcode).toBe(FtpOpcode.TerminateSession);

    const result = await promise;
    expect(result).toEqual(expected);
    expect(progress[progress.length - 1]).toEqual([fileSize, fileSize]);
    expect(ctx.ftpDownload).toBeNull();
  });

  it("re-requests on burst_complete when the size is unknown and ends on NAK EOF", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };

    const promise = downloadFileViaFtp(ctx, "/x.bin");

    // OpenFileRO ack WITHOUT a size (size < 4) -> fileSize unknown.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO, size: 0,
    }));
    expect(sent).toHaveLength(2); // OpenFileRO + first BurstReadFile

    const part = new Uint8Array([10, 20, 30, 40]);
    // A completed burst that is not EOF must trigger a fresh BurstReadFile.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: part.length, offset: 0, burstComplete: 1, data: part,
    }));
    expect(sent).toHaveLength(3);
    const nextBurst = decodeFileTransferProtocol(payloadOf(sent[2]));
    expect(nextBurst.opcode).toBe(FtpOpcode.BurstReadFile);
    expect(nextBurst.offset).toBe(part.length); // continues from receivedBytes

    // Server reports end-of-file -> read completes -> CalcFileCRC32 fires.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Nak, reqOpcode: FtpOpcode.BurstReadFile,
      size: 1, data: new Uint8Array([FtpError.EndOfFile]),
    }));
    const afterEof = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(afterEof.opcode).toBe(FtpOpcode.CalcFileCRC32);

    // CRC unsupported (NAK) is non-fatal: still terminates + resolves the data.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Nak, reqOpcode: FtpOpcode.CalcFileCRC32,
      size: 1, data: new Uint8Array([FtpError.Fail]),
    }));

    const result = await promise;
    expect(result).toEqual(part);
    expect(ctx.ftpDownload).toBeNull();
  });

  it("rejects on a non-EOF NAK during the read", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/missing.bin");

    // The FC refuses the open with FileNotFound.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 0, opcode: FtpOpcode.Nak, reqOpcode: FtpOpcode.OpenFileRO,
      size: 1, data: new Uint8Array([FtpError.FileNotFound]),
    }));

    await expect(promise).rejects.toThrow(/FileNotFound/);
    expect(ctx.ftpDownload).toBeNull();
  });

  it("ignores responses from a different session once one is established", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/a.bin");

    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 9, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(4),
    }));
    const beforeStray = sent.length;

    // A stray data packet for a different session must not append or advance.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 88, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, data: new Uint8Array([9, 9, 9, 9]),
    }));
    expect(sent.length).toBe(beforeStray); // no new request emitted

    // The correct session delivers the real bytes and completes.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 9, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, burstComplete: 1, data: new Uint8Array([1, 2, 3, 4]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 9, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32,
      size: 0,
    }));

    const result = await promise;
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("cancelFtp terminates the session and resolves partial data", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/b.bin");
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(1000),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 3, offset: 0, data: new Uint8Array([7, 8, 9]),
    }));

    cancelFtp(ctx);
    const terminate = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(terminate.opcode).toBe(FtpOpcode.TerminateSession);

    const result = await promise;
    expect(result).toEqual(new Uint8Array([7, 8, 9]));
    expect(ctx.ftpDownload).toBeNull();
  });

  it("guards against a concurrent second download", async () => {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const first = downloadFileViaFtp(ctx, "/first.bin");
    await expect(downloadFileViaFtp(ctx, "/second.bin")).rejects.toThrow(/already in progress/);

    // Finish the first so the shared slot clears and a later download is allowed.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 1, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(2),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 1, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 2, offset: 0, burstComplete: 1, data: new Uint8Array([1, 2]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 1, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32, size: 0,
    }));
    await first;
    expect(ctx.ftpDownload).toBeNull();
  });
});

describe("FTP read session — robustness against a hostile/lossy FC", () => {
  it("still isolates a foreign session when the established session id is 0", async () => {
    // Many FCs (and PX4's first session) allocate session id 0, so a filter that
    // exempts session 0 provides no isolation. A stray frame from session 5 while
    // ours is 0 must be rejected, not processed.
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/z.bin");

    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 0, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(4),
    }));
    const beforeStray = sent.length;

    // A foreign-session (5) burst must be ignored even though our session is 0.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 5, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, burstComplete: 1, data: new Uint8Array([8, 8, 8, 8]),
    }));
    expect(sent.length).toBe(beforeStray); // no request, no append

    // Our own session-0 data still flows and completes with the real bytes.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 0, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, burstComplete: 1, data: new Uint8Array([1, 2, 3, 4]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 0, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32, size: 0,
    }));
    expect(await promise).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does not attempt a huge allocation on an implausible reported file size", async () => {
    // A garbage size field (0xFFFFFFFF) must not force a ~4 GB pre-allocation;
    // the read loop grows the buffer as bytes actually arrive.
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/huge.bin");

    // Open reports the maximum uint32 as the size; must not throw.
    expect(() => handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(0xffffffff),
    }))).not.toThrow();
    expect(sent).toHaveLength(2); // OpenFileRO + first BurstReadFile still issued

    // A short read then an EOF NAK completes the (actually tiny) file cleanly.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 3, offset: 0, data: new Uint8Array([1, 2, 3]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Nak, reqOpcode: FtpOpcode.BurstReadFile,
      size: 1, data: new Uint8Array([FtpError.EndOfFile]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32, size: 0,
    }));
    expect(await promise).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("re-fetches a gap instead of zero-filling a lost/reordered chunk", () => {
    // A burst arriving beyond the contiguous marker (an earlier chunk was lost)
    // must not advance the marker past the hole; the next request re-fetches the
    // gap rather than leaving those bytes silently zero.
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    void downloadFileViaFtp(ctx, "/gap.bin");

    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 4, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(12),
    }));

    // Contiguous first chunk 0..4.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 4, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, burstComplete: 0, data: new Uint8Array([1, 2, 3, 4]),
    }));
    // A chunk at offset 8 skips the 4..8 window (that packet was lost).
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 4, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 8, burstComplete: 1, data: new Uint8Array([9, 9, 9, 9]),
    }));

    // The follow-up burst must ask for the gap (offset 4), NOT jump to EOF.
    const nextBurst = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(nextBurst.opcode).toBe(FtpOpcode.BurstReadFile);
    expect(nextBurst.offset).toBe(4);
  });

  it("bounds a server that keeps completing bursts without progress", async () => {
    // A server that repeatedly returns burst_complete with zero new data must not
    // be re-requested forever; the download fails once the no-progress rounds
    // exceed the retry bound.
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    const promise = downloadFileViaFtp(ctx, "/stall.bin");

    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 6, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO,
      size: 4, data: u32le(100),
    }));

    // Ten zero-data burst completions; the client must give up well before that.
    for (let i = 0; i < 10; i++) {
      handleFileTransferProtocolAck(ctx, ftpResponse({
        session: 6, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
        size: 0, offset: 0, burstComplete: 1,
      }));
    }

    await expect(promise).rejects.toThrow(/stalled/);
    expect(ctx.ftpDownload).toBeNull();
  });
});

describe("FTP read session — completeness", () => {
  function session() {
    const sent: Uint8Array[] = [];
    const ctx: FtpContext = {
      transport: mockTransport(sent), targetSysId: 1, targetCompId: 1,
      sysId: 255, compId: 190, ftpDownload: null,
    };
    return { sent, ctx };
  }

  it("re-reads the hole when the burst's EOF NAK follows a lost packet", () => {
    const { sent, ctx } = session();
    void downloadFileViaFtp(ctx, "/script.lua");
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO, size: 0,
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 0, data: new Uint8Array([1, 2, 3, 4]),
    }));
    // The chunk at 4..8 was lost; 8..12 arrived, then the burst ends with EOF.
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 4, offset: 8, data: new Uint8Array([9, 10, 11, 12]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 2, opcode: FtpOpcode.Nak, reqOpcode: FtpOpcode.BurstReadFile,
      size: 1, data: new Uint8Array([FtpError.EndOfFile]),
    }));
    const next = decodeFileTransferProtocol(payloadOf(sent[sent.length - 1]));
    expect(next.opcode).toBe(FtpOpcode.BurstReadFile);
    expect(next.offset).toBe(4);
  });

  it("rejects a read whose CRC does not match the server's", async () => {
    const { ctx } = session();
    const promise = downloadFileViaFtp(ctx, "/x.bin");
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.OpenFileRO, size: 4, data: u32le(2),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.BurstReadFile,
      size: 2, offset: 0, burstComplete: 1, data: new Uint8Array([1, 2]),
    }));
    handleFileTransferProtocolAck(ctx, ftpResponse({
      session: 3, opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CalcFileCRC32, size: 4, data: u32le(0xdeadbeef),
    }));
    await expect(promise).rejects.toThrow(/CRC-32 mismatch/);
  });

  it("rejects an open that never gets a reply instead of returning an empty file", async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = session();
      const outcome = downloadFileViaFtp(ctx, "/none.bin").then(() => "resolved", (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await outcome).toMatch(/got no reply/);
      expect(ctx.ftpDownload).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
