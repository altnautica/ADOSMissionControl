/**
 * @module protocol/command-altitude-and-shell.test
 * @description Command parameters whose meaning differs by firmware, and the
 * MAVLink shell line framing:
 *
 * - PX4 reads NAV_TAKEOFF param7 as AMSL and refuses to descend to one below
 *   the vehicle, so a height above home must be converted with the home
 *   altitude; ArduPilot reads param7 as the height itself.
 * - PX4 accepts DO_SET_HOME at an explicit location, and reads param4 as the
 *   home yaw, where NaN means unset.
 * - SERIAL_CONTROL carries 70 data bytes; a longer shell line must arrive
 *   whole, newline included.
 * - PX4 failsafe states decode to what they are, not UNKNOWN.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  cmdTakeoff,
  cmdSetHome,
  cmdSendSerialData,
  type CommandContext,
} from "../mavlink-adapter-commands";
import { CommandQueue } from "../command-queue";
import { createPX4Handler } from "../firmware/px4";
import type { CommandResult, FirmwareType } from "../types";

type SentLong = { command: number; params: number[] };
type SentInt = { command: number; params: number[]; x: number; y: number; z: number; frame: number };

function ctxWith(firmwareType: FirmwareType, homeAltitudeAmsl: number | null) {
  const longs: SentLong[] = [];
  const ints: SentInt[] = [];
  const frames: Uint8Array[] = [];
  const ctx: CommandContext = {
    transport: {
      isConnected: true,
      send: (data: Uint8Array) => frames.push(data),
    } as unknown as CommandContext["transport"], // the two members these senders touch
    firmwareHandler: { firmwareType } as unknown as CommandContext["firmwareHandler"],
    commandQueue: new CommandQueue(),
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    homeAltitudeAmsl,
    sendCommandLong: (command, params): Promise<CommandResult> => {
      longs.push({ command, params: [...params] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
    sendCommandInt: (command, params, x, y, z, frame): Promise<CommandResult> => {
      ints.push({ command, params: [...params], x, y, z, frame });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
  };
  return { ctx, longs, ints, frames };
}

describe("NAV_TAKEOFF altitude", () => {
  it("sends PX4 the requested height above home as an AMSL altitude", async () => {
    const { ctx, longs } = ctxWith("px4", 312.5);
    await cmdTakeoff(ctx, 10);
    expect(longs).toHaveLength(1);
    expect(longs[0].command).toBe(22);
    expect(longs[0].params[6]).toBeCloseTo(322.5);
    // No yaw and "take off where you are", not a target at 0,0.
    expect(longs[0].params.slice(3, 6).every(Number.isNaN)).toBe(true);
  });

  it("refuses a PX4 takeoff before the home altitude is known", async () => {
    const { ctx, longs } = ctxWith("px4", null);
    const result = await cmdTakeoff(ctx, 10);
    expect(result.success).toBe(false);
    expect(longs).toHaveLength(0);
  });

  it("keeps ArduPilot's height above home", async () => {
    const { ctx, longs } = ctxWith("ardupilot-copter", 312.5);
    await cmdTakeoff(ctx, 10);
    expect(longs[0].params[6]).toBe(10);
  });
});

describe("DO_SET_HOME", () => {
  it("sets an explicit PX4 home as COMMAND_INT with an unset yaw", async () => {
    const { ctx, ints } = ctxWith("px4", null);
    const result = await cmdSetHome(ctx, false, 47.3977419, 8.5455938, 488);
    expect(result.success).toBe(true);
    expect(ints).toHaveLength(1);
    expect(ints[0]).toMatchObject({ command: 179, x: 473977419, y: 85455938, z: 488, frame: 0 });
    expect(ints[0].params[0]).toBe(0);
    expect(Number.isNaN(ints[0].params[3])).toBe(true);
  });

  it("sets home to the current position with param1 = 1", async () => {
    const { ctx, ints } = ctxWith("ardupilot-copter", null);
    await cmdSetHome(ctx, true);
    expect(ints[0].command).toBe(179);
    expect(ints[0].params[0]).toBe(1);
  });
});

describe("MAVLink shell lines", () => {
  /** The data bytes of each SERIAL_CONTROL frame, in send order. */
  function shellData(frames: Uint8Array[]): Uint8Array[] {
    return frames.map((f) => {
      expect(f[7] | (f[8] << 8) | (f[9] << 16)).toBe(126);
      const payload = f.subarray(10, 10 + f[1]);
      return payload.subarray(9, 9 + payload[8]);
    });
  }

  it("delivers a line longer than one frame whole, newline included", () => {
    const { ctx, frames } = ctxWith("px4", null);
    const line = "listener vehicle_global_position -n 5 -r 10 && echo " + "x".repeat(60);
    cmdSendSerialData(ctx, line);
    const chunks = shellData(frames);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 70)).toBe(true);
    const joined = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((c) => Array.from(c))));
    expect(joined).toBe(line + "\n");
  });

  it("sends a short line as one frame", () => {
    const { ctx, frames } = ctxWith("px4", null);
    cmdSendSerialData(ctx, "ls");
    expect(shellData(frames).map((c) => new TextDecoder().decode(c))).toEqual(["ls\n"]);
  });
});

describe("PX4 failsafe and newer modes", () => {
  const px4 = createPX4Handler("copter");
  const custom = (main: number, sub: number) => ((sub << 24) | (main << 16)) >>> 0;

  it.each([
    [custom(4, 20), "DESCEND"],
    [custom(10, 0), "TERMINATION"],
    [custom(11, 0), "ALTITUDE_CRUISE"],
    [custom(3, 2), "POSITION_SLOW"],
  ])("custom_mode %i decodes to %s", (customMode, mode) => {
    expect(px4.decodeFlightMode(customMode)).toBe(mode);
  });

  it("never encodes a failsafe state as a mode request", () => {
    expect(() => px4.encodeFlightMode("DESCEND")).toThrow();
    expect(() => px4.encodeFlightMode("TERMINATION")).toThrow();
  });
});
