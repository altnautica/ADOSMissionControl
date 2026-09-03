/**
 * @module protocol/command-numbers.test
 * @description Pins the MAV_CMD numbers and load-bearing parameters of four
 * senders that commanded the wrong thing:
 *
 * - "bind receiver" sent 243 (PREFLIGHT_UAVCAN), whose param1 = 1 triggers a
 *   one-time DroneCAN actuator ID assignment, instead of 500 (START_RX_PAIR).
 * - fence enable sent 217, which is not in the MAV_CMD enum at all, while a
 *   sibling function sent the real 207 (DO_FENCE_ENABLE) for the same intent.
 * - gimbal angle sent DO_MOUNT_CONTROL with param7 = 0, which is
 *   MAV_MOUNT_MODE_RETRACT, so commanding an angle stowed the gimbal.
 * - parameter reset passed -1 as PREFLIGHT_STORAGE's MISSION storage action,
 *   outside the enum, where 0 means "no action".
 *
 * Command numbers are transcribed from the MAVLink MAV_CMD enum. The no-ack
 * senders are asserted on the bytes they actually put on the wire, decoded
 * back out of a real COMMAND_LONG frame.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  cmdStartRxPair,
  cmdEnableFence,
  cmdSetGeoFenceEnabled,
  cmdSetGimbalAngle,
  cmdResetParametersToDefault,
  cmdCommitParamsToFlash,
  type CommandContext,
} from "../mavlink-adapter-commands";
import { CommandQueue } from "../command-queue";
import { buildFrame, resetSequences } from "../encoders/frame";
import type { CommandResult } from "../types";

/** From the MAVLink MAV_CMD enum. */
const MAV_CMD = {
  DO_FENCE_ENABLE: 207,
  DO_MOUNT_CONTROL: 205,
  PREFLIGHT_STORAGE: 245,
  PREFLIGHT_UAVCAN: 243,
  START_RX_PAIR: 500,
} as const;

const MAV_MOUNT_MODE_RETRACT = 0;
const MAV_MOUNT_MODE_MAVLINK_TARGETING = 2;

type Sent = { command: number; params: number[] };

function ctxCapturing(
  sent: Sent[],
  sink?: Uint8Array[],
  connected = true,
): CommandContext {
  const transport = connected
    ? ({
        isConnected: true,
        send: (data: Uint8Array) => sink?.push(data),
      } as unknown as CommandContext["transport"]) // test double for the two members these senders touch
    : null;
  return {
    transport,
    firmwareHandler: null,
    commandQueue: new CommandQueue(),
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    sendCommandLong: (command, params): Promise<CommandResult> => {
      sent.push({ command, params: [...params] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
    sendCommandInt: (command, params, x, y, z, frame): Promise<CommandResult> => {
      sent.push({ command, params: [...params, x, y, z, frame] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
  };
}

/** Pull the command id and seven params back out of a COMMAND_LONG frame. */
function decodeCommandLongFrame(frame: Uint8Array): { command: number; params: number[] } {
  const payloadLen = frame[1];
  const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16);
  expect(msgId).toBe(76); // COMMAND_LONG
  const dv = new DataView(frame.buffer, frame.byteOffset + 10, payloadLen);
  const params: number[] = [];
  for (let i = 0; i < 7; i++) params.push(dv.getFloat32(i * 4, true));
  return { command: dv.getUint16(28, true), params };
}

describe("MAV_CMD numbers", () => {
  it("startRxPair sends START_RX_PAIR, not PREFLIGHT_UAVCAN", async () => {
    const sent: Sent[] = [];
    await cmdStartRxPair(ctxCapturing(sent), 1);
    expect(sent).toHaveLength(1);
    expect(sent[0].command).toBe(MAV_CMD.START_RX_PAIR);
    expect(sent[0].command).not.toBe(MAV_CMD.PREFLIGHT_UAVCAN);
  });

  it("enableFence sends DO_FENCE_ENABLE and agrees with setGeoFenceEnabled", async () => {
    const viaEnable: Sent[] = [];
    const viaGeo: Sent[] = [];
    await cmdEnableFence(ctxCapturing(viaEnable), true);
    await cmdSetGeoFenceEnabled(ctxCapturing(viaGeo), true);
    expect(viaEnable[0].command).toBe(MAV_CMD.DO_FENCE_ENABLE);
    // Two entry points for one operator intent must not disagree on the wire.
    expect(viaEnable).toEqual(viaGeo);
  });

  it("setGimbalAngle points the gimbal instead of retracting it", async () => {
    const sent: Sent[] = [];
    await cmdSetGimbalAngle(ctxCapturing(sent), -30, 0, 90);
    expect(sent[0].command).toBe(MAV_CMD.DO_MOUNT_CONTROL);
    expect(sent[0].params.slice(0, 3)).toEqual([-30, 0, 90]);
    expect(sent[0].params[6]).toBe(MAV_MOUNT_MODE_MAVLINK_TARGETING);
    expect(sent[0].params[6]).not.toBe(MAV_MOUNT_MODE_RETRACT);
  });
});

describe("fire-and-forget senders", () => {
  it("resetParametersToDefault leaves mission storage alone with an in-enum 0", () => {
    const frames: Uint8Array[] = [];
    const result = cmdResetParametersToDefault(ctxCapturing([], frames));
    expect(frames).toHaveLength(1);
    const { command, params } = decodeCommandLongFrame(frames[0]);
    expect(command).toBe(MAV_CMD.PREFLIGHT_STORAGE);
    expect(params[0]).toBe(2); // parameter storage: reset to defaults
    expect(params[1]).toBe(0); // mission storage: no action (was -1)
    expect(result.acknowledged).toBe(false);
  });

  it("commitParamsToFlash reports that nothing acknowledged it", () => {
    const frames: Uint8Array[] = [];
    const result = cmdCommitParamsToFlash(ctxCapturing([], frames));
    const { command, params } = decodeCommandLongFrame(frames[0]);
    expect(command).toBe(MAV_CMD.PREFLIGHT_STORAGE);
    expect(params[0]).toBe(1); // parameter storage: write to flash
    // It stays fire-and-forget by design; only the reported result changes.
    expect(result.success).toBe(true);
    expect(result.acknowledged).toBe(false);
    expect(result.message).toMatch(/unacknowledged/i);
  });

  it("refuses cleanly when the transport is down", () => {
    const result = cmdCommitParamsToFlash(ctxCapturing([], undefined, false));
    expect(result.success).toBe(false);
    expect(result.acknowledged).toBeUndefined();
    expect(result.message).toBe("Not connected");
  });
});

describe("frame builder", () => {
  it("keeps a separate sequence stream per sending identity", () => {
    resetSequences();
    // ArduPilot computes GCS-to-FC packet loss from the sequence byte of the
    // sending (sysid, compid). One global counter shared by two senders makes
    // each receiver see a stream with holes where the other sender's frames
    // went, so the reported loss rate is fiction.
    const seqOf = (frame: Uint8Array) => frame[4];
    const a1 = seqOf(buildFrame(0, new Uint8Array(9), 255, 190));
    const b1 = seqOf(buildFrame(0, new Uint8Array(9), 254, 190));
    const a2 = seqOf(buildFrame(0, new Uint8Array(9), 255, 190));
    const b2 = seqOf(buildFrame(0, new Uint8Array(9), 254, 190));
    expect([a1, a2]).toEqual([0, 1]);
    expect([b1, b2]).toEqual([0, 1]);
  });

  it("wraps at 255 rather than emitting an out-of-range sequence byte", () => {
    resetSequences();
    let last = 0;
    for (let i = 0; i < 257; i++) {
      last = buildFrame(0, new Uint8Array(9), 7, 7)[4];
      expect(last).toBeGreaterThanOrEqual(0);
      expect(last).toBeLessThanOrEqual(255);
    }
    expect(last).toBe(0); // 257 sends: 0..255 then 0
  });

  it("throws for a message with no CRC_EXTRA seed instead of emitting a dead frame", () => {
    // A frame with no seed carries a CRC the receiver cannot match, so it is
    // silently rejected on arrival and the caller is told nothing.
    expect(() => buildFrame(0xfffff, new Uint8Array(4))).toThrow(/no CRC_EXTRA seed/);
  });
});
