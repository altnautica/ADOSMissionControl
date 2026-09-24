/**
 * @license GPL-3.0-only
 *
 * MSP link behaviour on imperfect links and full-featured boards:
 *
 * - a transport write that throws fails that request only; the queue keeps
 *   serving the ones behind it;
 * - a stray byte between frames never hides the following reply, and a
 *   request frame echoed back by the link is not taken for a reply;
 * - Betaflight flight-mode boxes past bit 31 decode, so GPS Rescue does not
 *   read as ACRO.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MspParser, type ParsedMspFrame } from "../msp-parser";
import { MspSerialQueue } from "../msp-serial-queue";
import { encodeMsp } from "../msp-codec";
import { dispatchMspTelemetry, createMspTelemetryState } from "../../msp-adapter-telemetry";
import { createCallbackStore } from "../../mavlink-adapter-callbacks";
import type { VehicleInfo } from "../../types";

/** An MSPv1 frame with the given direction byte ('>' reply, '<' request). */
function v1(direction: string, command: number, payload: number[]): Uint8Array {
  let checksum = payload.length ^ command;
  for (const b of payload) checksum ^= b;
  return Uint8Array.from([0x24, 0x4d, direction.charCodeAt(0), payload.length, command, ...payload, checksum]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MSP request queue", () => {
  it("keeps serving requests after a write throws", async () => {
    vi.useFakeTimers();
    const parser = new MspParser();
    const sent: Uint8Array[] = [];
    let fail = true;
    const queue = new MspSerialQueue((data) => {
      if (fail) {
        fail = false;
        throw new Error("write failed");
      }
      sent.push(data);
    }, parser);

    await expect(queue.send(108)).rejects.toThrow("write failed");
    const next = queue.send(105);
    expect(sent).toEqual([encodeMsp(105)]);
    parser.feed(v1(">", 105, [0xdc, 0x05]));
    expect(Array.from((await next).payload)).toEqual([0xdc, 0x05]);
  });
});

describe("MSP parser resync", () => {
  function frames(bytes: Uint8Array): ParsedMspFrame[] {
    const parser = new MspParser();
    const out: ParsedMspFrame[] = [];
    parser.onFrame((f) => out.push(f));
    parser.feed(bytes);
    return out;
  }

  it("parses the reply that follows a stray 0x02 byte", () => {
    const reply = v1(">", 108, [1, 2, 3, 4, 5, 6]);
    expect(frames(Uint8Array.from([0x02, ...reply])).map((f) => f.command)).toEqual([108]);
  });

  it("does not emit a request frame echoed back by the link", () => {
    expect(frames(v1("<", 108, []))).toEqual([]);
  });
});

describe("Betaflight flight-mode flags past bit 31", () => {
  it("decodes GPS Rescue from the extended flag bytes", () => {
    const GPS_RESCUE = 46;
    // 40 boxes; GPS Rescue is list index 35, beyond the first 32-bit word.
    const boxIds = Array.from({ length: 40 }, (_, i) => (i === 35 ? GPS_RESCUE : 100 + i));
    boxIds[0] = 0; // ARM
    const payload = new Uint8Array(22);
    payload[6] = 0x01; // ARM (index 0) active
    payload[15] = 1; // one extra flag byte follows
    payload[16] = 1 << (35 - 32);
    payload[17] = 25; // arming-disable flag count, then a zero word

    const cbs = createCallbackStore();
    const modes: string[] = [];
    cbs.heartbeatCallbacks.push((hb) => modes.push(hb.mode));
    const info = { firmwareType: "betaflight" } as VehicleInfo;
    dispatchMspTelemetry(150, payload, cbs, info, boxIds, createMspTelemetryState());
    expect(modes).toEqual(["RTL"]);
  });
});
