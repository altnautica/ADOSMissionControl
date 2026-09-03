/**
 * @module protocol/message-ids.test
 * @description Pins the message id, CRC_EXTRA seed and canonical payload
 * length of five messages that were keyed to the WRONG id, so every frame of
 * each was silently discarded: EKF_STATUS_REPORT, GIMBAL_DEVICE_ATTITUDE_STATUS,
 * GIMBAL_MANAGER_INFORMATION, GIMBAL_MANAGER_STATUS and AIS_VESSEL.
 *
 * The triples below are transcribed from the MAVLink message definitions
 * (`MAVLINK_MSG_ID_<NAME>`, `_CRC` and `_LEN` in the generated headers), NOT
 * read back out of our own table — a test that asserts the table against
 * itself proves only self-consistency, which is exactly what was true while
 * the ids were wrong.
 *
 * Frames are then built with the transcribed seed and fed through the real
 * parser and the real routing switch. A frame decodes only if the id, the seed
 * and the routing case all agree with the definition, and the same frame at the
 * previously-configured id must decode nothing at all.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  MAVLinkParser,
  crc16,
  crc16Accumulate,
  CRC_EXTRA,
  PAYLOAD_LENGTHS,
} from "../mavlink-parser";
import { MSG_NAMES } from "../mavlink-adapter-frame-handlers";

/** id / CRC_EXTRA / canonical length, from the MAVLink message definitions. */
const DEFS = {
  EKF_STATUS_REPORT: { id: 193, crc: 71, len: 26, wrongId: 335 },
  GIMBAL_DEVICE_ATTITUDE_STATUS: { id: 285, crc: 137, len: 49, wrongId: 284 },
  GIMBAL_MANAGER_INFORMATION: { id: 280, crc: 70, len: 33, wrongId: 285 },
  GIMBAL_MANAGER_STATUS: { id: 281, crc: 48, len: 13, wrongId: 286 },
  AIS_VESSEL: { id: 301, crc: 243, len: 58, wrongId: 246 },
} as const;

/** What each previously-configured id actually is in the definitions. */
const WRONG_ID_REAL_MEANING = {
  335: "ISBD_LINK_STATUS",
  284: "GIMBAL_DEVICE_SET_ATTITUDE",
  286: "AUTOPILOT_STATE_FOR_GIMBAL_DEVICE",
  246: "ADSB_VEHICLE",
} as const;

/**
 * Build a MAVLink v2 frame carrying `payload` for `msgId`, sealed with an
 * explicitly-supplied CRC_EXTRA rather than one looked up in our table.
 */
function frameWithSeed(msgId: number, crcExtra: number, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(10 + payload.length + 2);
  buf[0] = 0xfd;
  buf[1] = payload.length;
  buf[7] = msgId & 0xff;
  buf[8] = (msgId >> 8) & 0xff;
  buf[9] = (msgId >> 16) & 0xff;
  buf[5] = 1; // system id
  buf[6] = 1; // component id
  buf.set(payload, 10);
  const crc = crc16Accumulate(crcExtra, crc16(buf, 1, 9 + payload.length));
  buf[10 + payload.length] = crc & 0xff;
  buf[10 + payload.length + 1] = (crc >> 8) & 0xff;
  return buf;
}

function parseOne(bytes: Uint8Array): { msgId: number; payload: DataView } | null {
  const parser = new MAVLinkParser();
  let seen: { msgId: number; payload: DataView } | null = null;
  parser.onFrame((f) => {
    seen = { msgId: f.msgId, payload: f.payload };
  });
  parser.feed(bytes);
  return seen;
}

describe("message ids that were wrong", () => {
  for (const [name, def] of Object.entries(DEFS)) {
    describe(name, () => {
      it(`is registered at id ${def.id} with seed ${def.crc}`, () => {
        expect(CRC_EXTRA.get(def.id)).toBe(def.crc);
      });

      it(`restores to its canonical ${def.len}-byte payload`, () => {
        expect(PAYLOAD_LENGTHS.get(def.id)).toBe(def.len);
      });

      it(`is named correctly in the diagnostic table`, () => {
        expect(MSG_NAMES[def.id]).toBe(name);
      });

      it("decodes a real frame at the correct id", () => {
        const payload = new Uint8Array(def.len).fill(7);
        const seen = parseOne(frameWithSeed(def.id, def.crc, payload));
        expect(seen?.msgId).toBe(def.id);
        // The parser restores a trimmed payload up to the canonical length.
        expect(seen?.payload.byteLength).toBe(def.len);
      });

      it(`does not decode the same frame at the previously-configured id ${def.wrongId}`, () => {
        // A frame sealed with THIS message's seed but sent under the id the
        // table used to carry: either the id is now unregistered, or it is
        // registered for a different message whose seed will not match. Both
        // must fail, and the failure must be silent rather than a mis-decode.
        const payload = new Uint8Array(def.len).fill(7);
        const seen = parseOne(frameWithSeed(def.wrongId, def.crc, payload));
        expect(seen).toBeNull();
      });
    });
  }

  it("no longer claims a wrong id belongs to one of these messages", () => {
    for (const [id, realName] of Object.entries(WRONG_ID_REAL_MEANING)) {
      const claimed = MSG_NAMES[Number(id)];
      // Either absent from the diagnostic table, or named for what it is.
      if (claimed !== undefined) {
        expect(claimed).toBe(realName);
      }
    }
  });

  it("registers every corrected id exactly once across both tables", () => {
    const ids = Object.values(DEFS).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(CRC_EXTRA.has(id)).toBe(true);
      expect(PAYLOAD_LENGTHS.has(id)).toBe(true);
    }
  });
});

describe("payload lengths that truncated extension fields", () => {
  // Each of these was pinned to its pre-extension size, so the parser's
  // zero-restore stopped short and the decoder read past nothing: the fields
  // simply had no source. Lengths are the canonical `_LEN` from the definitions.
  const CANONICAL = {
    24: { name: "GPS_RAW_INT", len: 52, wasTruncatingAt: 30 },
    77: { name: "COMMAND_ACK", len: 10, wasTruncatingAt: 3 },
    132: { name: "DISTANCE_SENSOR", len: 39, wasTruncatingAt: 14 },
    147: { name: "BATTERY_STATUS", len: 54, wasTruncatingAt: 36 },
  } as const;

  for (const [id, def] of Object.entries(CANONICAL)) {
    it(`${def.name} restores ${def.len} bytes, not ${def.wasTruncatingAt}`, () => {
      expect(PAYLOAD_LENGTHS.get(Number(id))).toBe(def.len);
    });
  }

  it("a full-length COMMAND_ACK survives the restore with its extension fields intact", () => {
    const payload = new Uint8Array(10);
    const dv = new DataView(payload.buffer);
    dv.setUint16(0, 400, true); // command: MAV_CMD_COMPONENT_ARM_DISARM
    dv.setUint8(2, 0); // result: MAV_RESULT_ACCEPTED
    dv.setUint8(3, 42); // progress
    dv.setInt32(4, -7, true); // result_param2
    dv.setUint8(8, 255); // target_system
    dv.setUint8(9, 190); // target_component
    const seen = parseOne(frameWithSeed(77, CRC_EXTRA.get(77)!, payload));
    expect(seen?.payload.byteLength).toBe(10);
    expect(seen?.payload.getUint8(3)).toBe(42);
    expect(seen?.payload.getInt32(4, true)).toBe(-7);
    expect(seen?.payload.getUint8(8)).toBe(255);
    expect(seen?.payload.getUint8(9)).toBe(190);
  });
});
