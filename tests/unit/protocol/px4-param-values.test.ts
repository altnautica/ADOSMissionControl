/**
 * The 4-byte value field of PARAM_VALUE / PARAM_SET for integer parameters.
 *
 * PX4 copies an integer parameter's bytes into the float field; ArduPilot casts
 * the integer to a float. Reading PX4's INT32 5 as a float gives a denormal
 * near 7e-45, and writing 3 as the float 3.0 stores 0x40400000 (1077936128) in
 * a PX4 int param. These tests drive the frame handler and the write path with
 * the real firmware handlers and check the bytes on the wire.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeFrame, type FrameHandlerState } from "@/lib/protocol/mavlink-adapter-frame-handlers";
import { setParameter, type ParamContext } from "@/lib/protocol/mavlink-adapter-params";
import { createCallbackStore } from "@/lib/protocol/mavlink-adapter-callbacks";
import { createFirmwareHandlerByType } from "@/lib/protocol/firmware/ardupilot";
import type { MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import type { FirmwareType, ParameterValue } from "@/lib/protocol/types";

const MAV_PARAM_TYPE_INT32 = 6;
const MAV_PARAM_TYPE_INT8 = 2;

type Ctx = ParamContext & FrameHandlerState & { sent: Uint8Array[] };

function makeContext(firmwareType: FirmwareType): Ctx {
  const sent: Uint8Array[] = [];
  const cbs = createCallbackStore();
  const onParameter = (cb: (p: ParameterValue) => void) => {
    cbs.parameterCallbacks.push(cb);
    return () => {
      const i = cbs.parameterCallbacks.indexOf(cb);
      if (i >= 0) cbs.parameterCallbacks.splice(i, 1);
    };
  };
  return {
    sent,
    transport: { isConnected: true, send: (d: Uint8Array) => sent.push(d) } as never,
    firmwareHandler: createFirmwareHandlerByType(firmwareType),
    vehicleInfo: { firmwareType } as never,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    commandQueue: { handleAck: vi.fn() } as never,
    cbs,
    paramCache: new Map(),
    PARAM_CACHE_TTL_MS: 300000,
    parameterDownload: null,
    downloadedParamNames: null,
    onParameter,
    missionUpload: null,
    missionDownload: null,
    rallyUpload: null,
    rallyDownload: null,
    fenceUpload: null,
    fenceDownload: null,
    logListDownload: null,
    logDataDownload: null,
    lastVehicleHeartbeat: Date.now(),
    linkIsLost: false,
    HEARTBEAT_TIMEOUT_MS: 5000,
  };
}

/** Deliver a PARAM_VALUE whose 4-byte value field is exactly `valueBytes`. */
function deliverParamValue(ctx: Ctx, paramId: string, valueBytes: number[], type: number): void {
  const dv = new DataView(new ArrayBuffer(25));
  new Uint8Array(dv.buffer).set(valueBytes, 0);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, 0, true);
  new Uint8Array(dv.buffer).set(new TextEncoder().encode(paramId), 8);
  dv.setUint8(24, type);
  const frame: MAVLinkFrame = { msgId: 22, systemId: 1, componentId: 1, sequence: 0, payload: dv, timestamp: Date.now() };
  routeFrame(ctx, frame, dv);
}

function received(ctx: Ctx): ParameterValue[] {
  const seen: ParameterValue[] = [];
  ctx.onParameter((p) => seen.push(p));
  return seen;
}

/** PARAM_SET frames sent so far: [value field bytes, param_id, param_type]. */
function paramSets(ctx: Ctx): Array<{ value: number[]; id: string; type: number }> {
  return ctx.sent
    .filter((f) => f[7] === 23)
    .map((f) => {
      const payload = f.subarray(10, 10 + f[1]);
      const id = new TextDecoder().decode(payload.subarray(6, 22)).replace(/\0+$/, "");
      return { value: Array.from(payload.subarray(0, 4)), id, type: payload[22] };
    });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("PARAM_VALUE integer decode", () => {
  it("reads a PX4 INT32 from its bytes", () => {
    const ctx = makeContext("px4");
    const seen = received(ctx);
    deliverParamValue(ctx, "COM_FLTMODE1", [0x05, 0x00, 0x00, 0x00], MAV_PARAM_TYPE_INT32);
    expect(seen).toHaveLength(1);
    expect(seen[0].value).toBe(5);
    expect(ctx.paramCache.get("FLTMODE1")).toMatchObject({ value: 5, type: MAV_PARAM_TYPE_INT32 });
  });

  it("reads a PX4 INT32 of -1 from its bytes, not as a NaN float", () => {
    const ctx = makeContext("px4");
    const seen = received(ctx);
    deliverParamValue(ctx, "COM_FLTMODE2", [0xff, 0xff, 0xff, 0xff], MAV_PARAM_TYPE_INT32);
    expect(seen[0].value).toBe(-1);
  });

  it("still reads an ArduPilot integer param as the float it was cast to", () => {
    const ctx = makeContext("ardupilot-copter");
    const seen = received(ctx);
    // 5.0f = 0x40A00000, little-endian.
    deliverParamValue(ctx, "FLTMODE1", [0x00, 0x00, 0xa0, 0x40], MAV_PARAM_TYPE_INT8);
    expect(seen[0].value).toBe(5);
  });
});

describe("PARAM_SET integer encode", () => {
  it("sends a PX4 INT32 as its bytes with the cached type", () => {
    const ctx = makeContext("px4");
    deliverParamValue(ctx, "COM_FLTMODE1", [0x00, 0x00, 0x00, 0x00], MAV_PARAM_TYPE_INT32);
    void setParameter(ctx, "COM_FLTMODE1", 3);
    expect(paramSets(ctx)).toEqual([
      { value: [0x03, 0x00, 0x00, 0x00], id: "COM_FLTMODE1", type: MAV_PARAM_TYPE_INT32 },
    ]);
  });

  it("sends -1 as ff ff ff ff and confirms the write from the bytewise echo", async () => {
    const ctx = makeContext("px4");
    deliverParamValue(ctx, "COM_FLTMODE2", [0x00, 0x00, 0x00, 0x00], MAV_PARAM_TYPE_INT32);
    // The canonical name maps to COM_FLTMODE2 on PX4.
    const write = setParameter(ctx, "FLTMODE2", -1);
    expect(paramSets(ctx)[0]).toEqual({ value: [0xff, 0xff, 0xff, 0xff], id: "COM_FLTMODE2", type: MAV_PARAM_TYPE_INT32 });
    deliverParamValue(ctx, "COM_FLTMODE2", [0xff, 0xff, 0xff, 0xff], MAV_PARAM_TYPE_INT32);
    const result = await write;
    expect(result.success).toBe(true);
    expect(paramSets(ctx)).toHaveLength(1);
  });

  it("refuses a PX4 write whose type has never been read", async () => {
    const ctx = makeContext("px4");
    const result = await setParameter(ctx, "COM_FLTMODE1", 3);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/type is unknown/);
    expect(paramSets(ctx)).toHaveLength(0);
  });

  it("still sends an ArduPilot integer param as a float", () => {
    const ctx = makeContext("ardupilot-copter");
    deliverParamValue(ctx, "FLTMODE1", [0x00, 0x00, 0xa0, 0x40], MAV_PARAM_TYPE_INT8);
    void setParameter(ctx, "FLTMODE1", 3);
    // 3.0f = 0x40400000.
    expect(paramSets(ctx)).toEqual([{ value: [0x00, 0x00, 0x40, 0x40], id: "FLTMODE1", type: MAV_PARAM_TYPE_INT8 }]);
  });
});
