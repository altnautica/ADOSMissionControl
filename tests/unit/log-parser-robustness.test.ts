/**
 * Binary log decoding:
 * - ULog parameters decode by the type in their key and are stored by name;
 * - a DataFlash FMT record whose length is zero, or disagrees with its
 *   format string, is rejected so the parse always advances and finishes;
 * - the int16[32] (`a`) and float16 (`g`) field types decode with their
 *   real sizes, so the fields after them stay aligned.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { parseUlog } from "@/lib/ulog/parser";
import { parseDataFlashLog } from "@/lib/dataflash-parser";
import { parseDataFlashLogStreaming } from "@/lib/dataflash-streaming";

// ── ULog ─────────────────────────────────────────────────────

function ulogWithParams(params: { key: string; value: (dv: DataView, at: number) => void }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [new Uint8Array([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35, 0x01, 0, 0, 0, 0, 0, 0, 0, 0])];
  for (const p of params) {
    const key = enc.encode(p.key);
    const payload = new Uint8Array(1 + key.length + 4);
    payload[0] = key.length;
    payload.set(key, 1);
    p.value(new DataView(payload.buffer), 1 + key.length);
    const header = new Uint8Array(3);
    new DataView(header.buffer).setUint16(0, payload.length, true);
    header[2] = 0x50; // 'P'
    parts.push(header, payload);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

describe("ULog parameters", () => {
  it("decodes int32 and float parameters by their declared type, keyed by bare name", () => {
    const log = parseUlog(
      ulogWithParams([
        { key: "int32_t SYS_AUTOSTART", value: (dv, at) => dv.setInt32(at, 4001, true) },
        { key: "float MPC_XY_VEL_MAX", value: (dv, at) => dv.setFloat32(at, 12.5, true) },
      ]),
    );
    expect(log.params.get("SYS_AUTOSTART")).toBe(4001);
    expect(log.params.get("MPC_XY_VEL_MAX")).toBeCloseTo(12.5);
  });
});

// ── DataFlash ────────────────────────────────────────────────

const FMT_LENGTH = 89;

function fmtRecord(type: number, length: number, name: string, format: string, columns: string): Uint8Array {
  const rec = new Uint8Array(FMT_LENGTH);
  rec[0] = 0xa3;
  rec[1] = 0x95;
  rec[2] = 128;
  rec[3] = type;
  rec[4] = length;
  const enc = new TextEncoder();
  rec.set(enc.encode(name), 5);
  rec.set(enc.encode(format), 9);
  rec.set(enc.encode(columns), 25);
  return rec;
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

describe("DataFlash FMT validation", () => {
  it("rejects a zero-length FMT, so a message of that type cannot stall the parse", async () => {
    const buffer = concat([
      fmtRecord(200, 0, "BAD", "I", "TimeUS"),
      new Uint8Array([0xa3, 0x95, 200, 0, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    expect(parseDataFlashLog(buffer).messages.get("BAD")).toBeUndefined();
    const streamed = await parseDataFlashLogStreaming(buffer, { chunkSize: 16 });
    expect(streamed.messages.get("BAD")).toBeUndefined();
  });

  it("decodes int16[32] and float16 fields with their real sizes", () => {
    // Header 3 + a 64 + g 2 + H 2 = 71 bytes.
    const msg = new Uint8Array(71);
    const dv = new DataView(msg.buffer);
    msg[0] = 0xa3;
    msg[1] = 0x95;
    msg[2] = 201;
    for (let i = 0; i < 32; i++) dv.setInt16(3 + i * 2, i - 16, true);
    dv.setUint16(67, 0x3e00, true); // 1.5 as float16
    dv.setUint16(69, 777, true);
    const log = parseDataFlashLog(concat([fmtRecord(201, 71, "ISBD", "agH", "X,G,Z"), msg]));
    const [row] = log.messages.get("ISBD") ?? [];
    expect(row.fields.X).toEqual(Array.from({ length: 32 }, (_, i) => i - 16));
    expect(row.fields.G).toBe(1.5);
    expect(row.fields.Z).toBe(777);
  });
});
