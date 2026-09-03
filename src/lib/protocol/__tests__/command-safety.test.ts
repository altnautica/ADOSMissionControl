/**
 * @module protocol/command-safety.test
 * @description Pins the gates on the four command paths that could act on a
 * vehicle they were not meant for, or act at all without being asked:
 *
 * - ArduPilot's vendor calibration range (424xx / 42006) was sent
 *   unconditionally. PX4 and the MSP firmwares answer UNSUPPORTED at best;
 *   the refusal now names the connected firmware instead of the operator
 *   watching a silent no-op.
 * - CompassMot rode PREFLIGHT_CALIBRATION param6, an ArduPilot-only slot, and
 *   had a second entry point that bypassed even the type switch.
 * - `killSwitch` is DO_FLIGHTTERMINATION: irreversible in flight. The protocol
 *   layer refuses unless the caller states the operator confirmed it.
 * - `guidedGoto` was a raw transport write that reported success for reaching
 *   the socket, and squeezed lat/lon through COMMAND_LONG float32 params.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  cmdStartCalibration,
  cmdAcceptCompassCal,
  cmdCancelCompassCal,
  cmdStartGnssMagCal,
  cmdConfirmAccelCalPos,
  cmdCancelCalibration,
  cmdKillSwitch,
  cmdGuidedGoto,
  type CommandContext,
} from "../mavlink-adapter-commands";
import { CommandQueue } from "../command-queue";
import type { CommandResult, FirmwareType } from "../types";

const MAV_CMD = {
  PREFLIGHT_CALIBRATION: 241,
  DO_FLIGHTTERMINATION: 185,
  DO_REPOSITION: 192,
  ARDUPILOT_ACCEPT_MAG_CAL: 42425,
  ARDUPILOT_CANCEL_MAG_CAL: 42426,
  ARDUPILOT_START_MAG_CAL: 42424,
  ARDUPILOT_FIXED_MAG_CAL: 42006,
  ARDUPILOT_ACCEL_CAL_POS: 42429,
} as const;

/** MAV_FRAME_GLOBAL_RELATIVE_ALT_INT. */
const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;

type SentLong = { command: number; params: number[] };
type SentInt = {
  command: number;
  params: number[];
  x: number;
  y: number;
  z: number;
  frame: number;
};

function ctxWith(firmwareType: FirmwareType | undefined) {
  const longs: SentLong[] = [];
  const ints: SentInt[] = [];
  const rawWrites: Uint8Array[] = [];
  const ctx: CommandContext = {
    transport: {
      isConnected: true,
      send: (data: Uint8Array) => rawWrites.push(data),
    } as unknown as CommandContext["transport"], // the two members these senders touch
    firmwareHandler: firmwareType
      ? ({ firmwareType } as unknown as CommandContext["firmwareHandler"])
      : null,
    commandQueue: new CommandQueue(),
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    sendCommandLong: (command, params): Promise<CommandResult> => {
      longs.push({ command, params: [...params] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
    sendCommandInt: (command, params, x, y, z, frame): Promise<CommandResult> => {
      ints.push({ command, params: [...params], x, y, z, frame });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
  };
  return { ctx, longs, ints, rawWrites };
}

describe("ArduPilot vendor calibration gating", () => {
  const vendorCalls: Array<[string, (ctx: CommandContext) => Promise<CommandResult>]> = [
    ["accept compass cal", (ctx) => cmdAcceptCompassCal(ctx)],
    ["cancel compass cal", (ctx) => cmdCancelCompassCal(ctx)],
    ["fixed mag cal", (ctx) => cmdStartGnssMagCal(ctx)],
    ["compassmot", (ctx) => cmdStartCalibration(ctx, "compassmot")],
  ];

  it.each(vendorCalls)("%s reaches the wire on ArduPilot", async (_label, call) => {
    const { ctx, longs } = ctxWith("ardupilot-copter");
    const result = await call(ctx);
    expect(result.success).toBe(true);
    expect(longs).toHaveLength(1);
  });

  it.each(vendorCalls)("%s is refused on PX4, sending nothing", async (_label, call) => {
    const { ctx, longs } = ctxWith("px4");
    const result = await call(ctx);
    expect(result.success).toBe(false);
    // MAV_RESULT_UNSUPPORTED, and the message names the firmware so the
    // operator is not left watching a command that quietly did nothing.
    expect(result.resultCode).toBe(3);
    expect(result.message).toContain("px4");
    expect(longs).toHaveLength(0);
  });

  it.each(vendorCalls)("%s is refused on Betaflight", async (_label, call) => {
    const { ctx, longs } = ctxWith("betaflight");
    const result = await call(ctx);
    expect(result.success).toBe(false);
    expect(longs).toHaveLength(0);
  });

  it("the accel-cal position no-ack sender writes no frame off ArduPilot", () => {
    const armed = ctxWith("px4");
    cmdConfirmAccelCalPos(armed.ctx, 1);
    expect(armed.rawWrites).toHaveLength(0);

    const ap = ctxWith("ardupilot-copter");
    cmdConfirmAccelCalPos(ap.ctx, 1);
    expect(ap.rawWrites).toHaveLength(1);
  });

  it("every ardupilot vehicle class passes the gate, not just copter", async () => {
    for (const fw of ["ardupilot-copter", "ardupilot-plane", "ardupilot-rover", "ardupilot-sub"] as const) {
      const { ctx, longs } = ctxWith(fw);
      const result = await cmdStartGnssMagCal(ctx);
      expect(result.success, fw).toBe(true);
      expect(longs, fw).toHaveLength(1);
    }
  });

  it("the standard cancel is not gated: all-zero PREFLIGHT_CALIBRATION is universal", async () => {
    const { ctx, longs } = ctxWith("px4");
    const result = await cmdCancelCalibration(ctx);
    expect(result.success).toBe(true);
    expect(longs[0].command).toBe(MAV_CMD.PREFLIGHT_CALIBRATION);
    expect(longs[0].params.every((p) => p === 0)).toBe(true);
  });

  it("compass calibration still routes per firmware rather than being refused", async () => {
    const px4 = ctxWith("px4");
    await cmdStartCalibration(px4.ctx, "compass");
    expect(px4.longs[0].command).toBe(MAV_CMD.PREFLIGHT_CALIBRATION);

    const ap = ctxWith("ardupilot-copter");
    await cmdStartCalibration(ap.ctx, "compass");
    expect(ap.longs[0].command).toBe(MAV_CMD.ARDUPILOT_START_MAG_CAL);
  });
});

describe("flight termination requires a stated confirmation", () => {
  it("refuses and sends nothing when the caller did not confirm", async () => {
    const { ctx, longs } = ctxWith("ardupilot-copter");
    const result = await cmdKillSwitch(ctx, false);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/confirm/i);
    expect(longs).toHaveLength(0);
  });

  it("sends DO_FLIGHTTERMINATION with param1 = 1 once confirmed", async () => {
    const { ctx, longs } = ctxWith("ardupilot-copter");
    const result = await cmdKillSwitch(ctx, true);
    expect(result.success).toBe(true);
    expect(longs).toHaveLength(1);
    expect(longs[0].command).toBe(MAV_CMD.DO_FLIGHTTERMINATION);
    expect(longs[0].params[0]).toBe(1);
  });
});

describe("guidedGoto is ack-tracked and keeps 1e7 precision", () => {
  it("goes out as an ack-tracked COMMAND_INT, not a raw transport write", async () => {
    const { ctx, ints, rawWrites } = ctxWith("ardupilot-copter");
    const result = await cmdGuidedGoto(ctx, 12.9716, 77.5946, 60);

    expect(result.success).toBe(true);
    // The old implementation wrote the frame itself and reported success for
    // reaching the socket.
    expect(rawWrites).toHaveLength(0);
    expect(ints).toHaveLength(1);
    expect(ints[0].command).toBe(MAV_CMD.DO_REPOSITION);
    expect(ints[0].frame).toBe(MAV_FRAME_GLOBAL_RELATIVE_ALT_INT);
  });

  it("carries lat/lon as 1e7 integers, which float32 params cannot hold", async () => {
    const { ctx, ints } = ctxWith("ardupilot-copter");
    const lat = 12.9715987;
    const lon = 77.5945627;
    await cmdGuidedGoto(ctx, lat, lon, 60);

    expect(ints[0].x).toBe(129715987);
    expect(ints[0].y).toBe(775945627);
    expect(ints[0].z).toBe(60);

    // The precision claim: the same value through a float32 param loses
    // roughly a metre, which is why this is a COMMAND_INT.
    const throughFloat32 = new Float32Array([129715987])[0];
    expect(throughFloat32).not.toBe(129715987);
  });

  it("refuses cleanly when the transport is down", async () => {
    const { ctx, ints } = ctxWith("ardupilot-copter");
    const offline: CommandContext = { ...ctx, transport: null };
    const result = await cmdGuidedGoto(offline, 1, 2, 3);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Not connected");
    expect(ints).toHaveLength(0);
  });
});
