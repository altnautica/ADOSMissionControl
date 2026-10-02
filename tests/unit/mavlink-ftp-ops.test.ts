/**
 * MAVLink FTP write/list/remove op-session tests. Drives the real state machine
 * with a fake transport that captures sent frames + lets the test inject the
 * FC's ACK/NAK responses, so upload chunking, directory-list accumulation, and
 * remove all exercise the actual request/response logic.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  uploadFileViaFtp,
  listDirectoryViaFtp,
  removeFileViaFtp,
  handleFtpOpAck,
  type FtpContext,
} from "@/lib/protocol/mavlink-adapter-ftp-ops";
import { FtpOpcode, FtpError } from "@/lib/protocol/mavlink-messages";

const FTP_INNER_OFFSET = 3;

/** Build a FILE_TRANSFER_PROTOCOL frame payload (as the decoder expects). */
function makeFrame(fields: {
  seq?: number;
  session?: number;
  opcode: number;
  reqOpcode?: number;
  size?: number;
  data?: Uint8Array;
}) {
  const buf = new Uint8Array(FTP_INNER_OFFSET + 12 + 239);
  const dv = new DataView(buf.buffer);
  const base = FTP_INNER_OFFSET;
  dv.setUint16(base, fields.seq ?? 0, true);
  dv.setUint8(base + 2, fields.session ?? 0);
  dv.setUint8(base + 3, fields.opcode);
  dv.setUint8(base + 4, fields.size ?? (fields.data?.length ?? 0));
  dv.setUint8(base + 5, fields.reqOpcode ?? 0);
  if (fields.data) buf.set(fields.data.subarray(0, 239), base + 12);
  return { payload: dv } as unknown as Parameters<typeof handleFtpOpAck>[1];
}

/** A fake transport + context. `sent` records each frame; the test replies. */
function makeCtx() {
  const sent: Uint8Array[] = [];
  const ctx: FtpContext = {
    transport: {
      isConnected: true,
      send: (f: Uint8Array) => sent.push(f),
    } as unknown as FtpContext["transport"],
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    ftpDownload: null,
    ftpOp: null,
  };
  return { ctx, sent };
}

describe("MAVLink FTP write ops", () => {
  it("upload: CreateFile → WriteFile per chunk → resolves", async () => {
    const { ctx, sent } = makeCtx();
    // 500 bytes → 3 chunks (239 + 239 + 22).
    const payload = new Uint8Array(500).map((_, i) => i & 0xff);
    const p = uploadFileViaFtp(ctx, "APM/scripts/x.lua", payload);

    expect(sent.length).toBe(1); // CreateFile
    // ACK CreateFile with session 7.
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CreateFile, session: 7 }));
    expect(sent.length).toBe(2); // first WriteFile

    // ACK each WriteFile until done; an ACK answers its request with seq + 1.
    for (let guard = 0; guard < 10 && ctx.ftpOp; guard++) {
      handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.WriteFile, session: 7, seq: ctx.ftpOp.seq }));
    }
    await expect(p).resolves.toBeUndefined();
    // 3 WriteFile + 1 CreateFile were sent (terminate is fire-and-forget after).
    expect(sent.length).toBeGreaterThanOrEqual(4);
  });

  it("upload: reports progress and writes all bytes", async () => {
    const { ctx } = makeCtx();
    const seen: Array<[number, number]> = [];
    const payload = new Uint8Array(300);
    const p = uploadFileViaFtp(ctx, "APM/scripts/y.lua", payload, (w, t) => seen.push([w, t]));
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.CreateFile, session: 3 }));
    for (let guard = 0; guard < 10 && ctx.ftpOp; guard++) {
      handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.WriteFile, session: 3, seq: ctx.ftpOp.seq }));
    }
    await p;
    expect(seen[seen.length - 1]).toEqual([300, 300]);
  });

  it("list: accumulates entries across ACKs until EndOfFile NAK", async () => {
    const { ctx } = makeCtx();
    const p = listDirectoryViaFtp(ctx, "APM/scripts");
    // One ACK carrying two file entries (null-terminated, F<name>\t<size>).
    const enc = new TextEncoder();
    const entries = "Frangefinder.lua\t1420\0Fhello.lua\t210\0";
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.ListDirectory, data: enc.encode(entries), size: enc.encode(entries).length }));
    // Then EndOfFile terminates the listing.
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Nak, data: new Uint8Array([FtpError.EndOfFile]), size: 1 }));
    const result = await p;
    expect(result).toEqual([
      { name: "rangefinder.lua", size: 1420, isDir: false },
      { name: "hello.lua", size: 210, isDir: false },
    ]);
  });

  it("remove: RemoveFile ACK resolves", async () => {
    const { ctx } = makeCtx();
    const p = removeFileViaFtp(ctx, "APM/scripts/x.lua");
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Ack, reqOpcode: FtpOpcode.RemoveFile }));
    await expect(p).resolves.toBeUndefined();
  });

  it("remove: NAK FileNotFound rejects", async () => {
    const { ctx } = makeCtx();
    const p = removeFileViaFtp(ctx, "APM/scripts/missing.lua");
    handleFtpOpAck(ctx, makeFrame({ opcode: FtpOpcode.Nak, data: new Uint8Array([FtpError.FileNotFound]), size: 1 }));
    await expect(p).rejects.toThrow(/FileNotFound/);
  });

  it("rejects a concurrent op", async () => {
    const { ctx } = makeCtx();
    void listDirectoryViaFtp(ctx, "APM/scripts");
    await expect(removeFileViaFtp(ctx, "APM/scripts/x.lua")).rejects.toThrow(/already in progress/);
  });
});
