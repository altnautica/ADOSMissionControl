/**
 * Demo receiver config for the Betaflight mock vehicle: answers the
 * MSP_RX_CONFIG / MSP_RX_MAP reads and keeps writes in memory, so the
 * Receiver panel shows a real config in demo instead of "not available".
 *
 * @license GPL-3.0-only
 */

import type { CommandResult } from "@/lib/protocol/types";
import type { DroneProtocolMspExtensions } from "@/lib/protocol/types/protocol/msp-extensions";
import { decodeMspRxConfig, type BfRxConfig } from "@/lib/protocol/msp/decoders/config/rx";

type RxMethods = Required<Pick<DroneProtocolMspExtensions, "getRxConfig" | "setRxConfig" | "getRxMap" | "setRxMap">>;

/** A 32-byte MSP_RX_CONFIG payload: CRSF provider, 1100..1900 sticks, 885..2115 µs. */
function defaultRxPayload(): DataView {
  const dv = new DataView(new ArrayBuffer(32));
  dv.setUint8(0, 9); // serialrx provider: CRSF
  dv.setUint16(1, 1900, true); // maxcheck
  dv.setUint16(3, 1500, true); // midrc
  dv.setUint16(5, 1100, true); // mincheck
  dv.setUint16(8, 885, true); // rx min µs
  dv.setUint16(10, 2115, true); // rx max µs
  dv.setUint16(14, 1250, true); // air mode threshold 25 %
  dv.setUint8(27, 30);
  dv.setUint8(30, 30);
  dv.setUint8(31, 1);
  return dv;
}

const OK: CommandResult = { success: true, resultCode: 0, message: "OK" };

/** In-memory receiver config + AETR channel map for one demo vehicle. */
export function createMockBfRx(): RxMethods {
  let cfg: BfRxConfig = decodeMspRxConfig(defaultRxPayload());
  let map = [0, 1, 3, 2, 4, 5, 6, 7];
  return {
    getRxConfig: async () => ({ ...cfg, raw: cfg.raw.slice() }),
    setRxConfig: async (next) => { cfg = { ...next, raw: next.raw.slice() }; return OK; },
    getRxMap: async () => map.slice(),
    setRxMap: async (next) => { map = next.slice(); return OK; },
  };
}
