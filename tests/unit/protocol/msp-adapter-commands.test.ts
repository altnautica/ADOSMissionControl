/**
 * MSP command-translation layer tests.
 *
 * The MSP codec (frame encode/decode) and the serial queue are covered
 * elsewhere. This file pins the layer between them: the functions that
 * turn a high-level command (arm, disarm, motor test, kill switch, reboot,
 * calibrate) into a concrete MSP command id plus payload bytes. A wrong
 * AUX-channel index, a wrong throttle byte, or a swapped command id is a
 * real-flight hazard, so each case asserts the exact id and the exact
 * bytes, then round-trips the captured frame through the real codec +
 * parser to prove the bytes survive the wire.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  mspArm,
  mspDisarm,
  mspSetFlightMode,
  mspMotorTest,
  mspKillSwitch,
  mspReboot,
  mspRebootToBootloader,
  mspStartCalibration,
  mspCommitParamsToFlash,
  mspSendManualControl,
  type MspCommandContext,
} from '@/lib/protocol/msp-adapter-commands';
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue';
import { MSP } from '@/lib/protocol/msp/msp-constants';
import type { ModeRange } from '@/lib/protocol/msp/msp-mode-map';
import { MspRcOverride } from '@/lib/protocol/msp/msp-rc-override';
import { RC_THROTTLE_CUT } from '@/lib/protocol/msp/msp-rc-channels';
import { encodeMsp } from '@/lib/protocol/msp/msp-codec';
import { MspParser } from '@/lib/protocol/msp/msp-parser';

// ── Capturing fake queue ───────────────────────────────────

interface CapturedFrame {
  command: number;
  payload: Uint8Array;
  awaited: boolean; // true for send(), false for sendNoReply()
}

/**
 * Records every command + payload the translation layer emits without
 * touching a transport. send() resolves with an empty response frame so
 * the caller's success branch runs (none of the tested commands read the
 * response payload).
 */
function createCapturingQueue() {
  const frames: CapturedFrame[] = [];
  const queue = {
    send(command: number, payload?: Uint8Array) {
      frames.push({ command, payload: payload ?? new Uint8Array(0), awaited: true });
      return Promise.resolve({
        version: 1 as const,
        command,
        payload: new Uint8Array(0),
        direction: 'response' as const,
      });
    },
    sendNoReply(command: number, payload?: Uint8Array) {
      frames.push({ command, payload: payload ?? new Uint8Array(0), awaited: false });
    },
  };
  return { queue: queue as unknown as MspSerialQueue, frames };
}

/** Read a little-endian 16-bit value from a payload at byte offset. */
function readU16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

/**
 * Re-encode a captured frame, feed it through the real streaming parser,
 * and return the decoded command + payload. Proves the captured bytes
 * survive a codec round-trip unchanged.
 */
function roundTrip(frame: CapturedFrame): { command: number; payload: Uint8Array } {
  const parser = new MspParser();
  let decoded: { command: number; payload: Uint8Array } | null = null;
  parser.onFrame((f) => {
    decoded = { command: f.command, payload: f.payload };
  });
  // The codec emits a request ($M< / $X<); the parser accepts the
  // direction byte regardless, so we route the encoded request back in.
  parser.feed(encodeMsp(frame.command, frame.payload));
  if (!decoded) throw new Error(`frame for command ${frame.command} failed to round-trip`);
  return decoded;
}

const ARM_RANGE: ModeRange = {
  boxId: 0, // ARM
  auxChannel: 1, // AUX2
  rangeStart: 1700,
  rangeEnd: 2100,
};

/**
 * Build a command context around a capturing queue and a real RC override, so
 * every MSP_SET_RAW_RC assertion runs through the production channel model.
 * `rxMspEnabled` defaults to true because most cases are about the frame
 * contents; the cases that are about the receiver gate pass it explicitly.
 */
function ctxWith(
  ranges: ModeRange[],
  { rxMspEnabled = true }: { rxMspEnabled?: boolean } = {},
): { ctx: MspCommandContext; frames: CapturedFrame[]; rc: MspRcOverride } {
  const { queue, frames } = createCapturingQueue();
  const rc = new MspRcOverride({
    send: (payload) => queue.sendNoReply(MSP.MSP_SET_RAW_RC, payload),
    modeRanges: ranges,
    rxMspEnabled,
  });
  return { ctx: { queue, modeRanges: ranges, rc }, frames, rc };
}

// ── Arm / Disarm without an arm mode range ─────────────────

describe('mspArm / mspDisarm with no arm ModeRange', () => {
  it('arm sends MSP_ARMING_DISABLE with payload[0]===0 (enable arming)', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspArm(ctx);
    expect(result.success).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(MSP.MSP_ARMING_DISABLE);
    expect(frames[0].awaited).toBe(true);
    expect(frames[0].payload[0]).toBe(0);

    const rt = roundTrip(frames[0]);
    expect(rt.command).toBe(MSP.MSP_ARMING_DISABLE);
    expect(rt.payload[0]).toBe(0);
  });

  it('disarm sends MSP_ARMING_DISABLE with payload[0]===1 (disable arming)', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspDisarm(ctx);
    expect(result.success).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(MSP.MSP_ARMING_DISABLE);
    expect(frames[0].payload[0]).toBe(1);

    const rt = roundTrip(frames[0]);
    expect(rt.payload[0]).toBe(1);
  });
});

// ── Arm / Disarm WITH an arm mode range (AUX path) ─────────

describe('mspArm / mspDisarm with an arm ModeRange (AUX channel path)', () => {
  it('arm writes MSP_SET_RAW_RC putting AUX(auxChannel) at the range midpoint', async () => {
    const { ctx, frames } = ctxWith([ARM_RANGE]);
    const result = await mspArm(ctx);
    expect(result.success).toBe(true);
    expect(frames).toHaveLength(1);

    const frame = frames[0];
    expect(frame.command).toBe(MSP.MSP_SET_RAW_RC);
    expect(frame.awaited).toBe(false); // fire-and-forget RC
    // 8 channels * 2 bytes
    expect(frame.payload).toHaveLength(16);

    // The arm range is auxChannel=1, so the activated RC channel is
    // index auxChannel + 4 = 5 (the first four channels are roll/pitch/
    // throttle/yaw). The PWM is the midpoint of [1700, 2100] = 1900.
    const channelIndex = ARM_RANGE.auxChannel + 4;
    const mid = Math.round((ARM_RANGE.rangeStart + ARM_RANGE.rangeEnd) / 2);
    expect(mid).toBe(1900);
    expect(readU16(frame.payload, channelIndex * 2)).toBe(1900);

    // Throttle (channel index 2) is held at the disarmed-safe 1000.
    expect(readU16(frame.payload, 2 * 2)).toBe(1000);
    // Roll / pitch / yaw centered.
    expect(readU16(frame.payload, 0)).toBe(1500);
    expect(readU16(frame.payload, 1 * 2)).toBe(1500);
    expect(readU16(frame.payload, 3 * 2)).toBe(1500);

    const rt = roundTrip(frame);
    expect(rt.command).toBe(MSP.MSP_SET_RAW_RC);
    expect(readU16(rt.payload, channelIndex * 2)).toBe(1900);
  });

  it('disarm writes MSP_SET_RAW_RC putting the same AUX channel low (1000)', async () => {
    const { ctx, frames } = ctxWith([ARM_RANGE]);
    const result = await mspDisarm(ctx);
    expect(result.success).toBe(true);

    const frame = frames[0];
    expect(frame.command).toBe(MSP.MSP_SET_RAW_RC);
    const channelIndex = ARM_RANGE.auxChannel + 4;
    expect(readU16(frame.payload, channelIndex * 2)).toBe(1000);
  });
});

// ── Motor test ─────────────────────────────────────────────

describe('mspMotorTest', () => {
  it('sends MSP_SET_MOTOR scaling only the selected motor, others at 1000', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspMotorTest(ctx, 2, 50, 0);
    expect(result.success).toBe(true);
    expect(frames).toHaveLength(1);

    const frame = frames[0];
    expect(frame.command).toBe(MSP.MSP_SET_MOTOR);
    expect(frame.awaited).toBe(true);
    expect(frame.payload).toHaveLength(16); // 8 motors * 2 bytes

    // Motor index 2 at 50% => 1000 + (50/100)*1000 = 1500.
    expect(readU16(frame.payload, 2 * 2)).toBe(1500);
    // Every other motor sits at the stop value 1000.
    for (let i = 0; i < 8; i++) {
      if (i === 2) continue;
      expect(readU16(frame.payload, i * 2)).toBe(1000);
    }

    const rt = roundTrip(frame);
    expect(rt.command).toBe(MSP.MSP_SET_MOTOR);
    expect(readU16(rt.payload, 2 * 2)).toBe(1500);
  });

  it('100% throttle on motor 0 maps to the full 2000 PWM', async () => {
    const { ctx, frames } = ctxWith([]);
    await mspMotorTest(ctx, 0, 100, 0);
    expect(readU16(frames[0].payload, 0)).toBe(2000);
  });

  it('0% throttle leaves the selected motor at the 1000 stop value', async () => {
    const { ctx, frames } = ctxWith([]);
    await mspMotorTest(ctx, 5, 0, 0);
    expect(readU16(frames[0].payload, 5 * 2)).toBe(1000);
  });

  it('idles every output once the duration elapses', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, frames } = ctxWith([]);
      await mspMotorTest(ctx, 3, 40, 2);
      expect(frames).toHaveLength(1);

      // MSP_SET_MOTOR is a level, not a pulse, so nothing stops the motor
      // before the duration is up.
      await vi.advanceTimersByTimeAsync(1_900);
      expect(frames).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(frames).toHaveLength(2);
      expect(frames[1].command).toBe(MSP.MSP_SET_MOTOR);
      for (let i = 0; i < 8; i++) {
        expect(readU16(frames[1].payload, i * 2)).toBe(1000);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses while the vehicle is armed and writes no outputs', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspMotorTest({ ...ctx, isArmed: () => true }, 1, 60, 2);
    expect(result.success).toBe(false);
    expect(result.message).toContain('armed');
    expect(frames).toHaveLength(0);
  });

  it('a second test cancels the first stop timer instead of idling mid-test', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, frames } = ctxWith([]);
      await mspMotorTest(ctx, 1, 50, 4);
      await vi.advanceTimersByTimeAsync(3_000);
      await mspMotorTest(ctx, 1, 50, 4);

      // The first schedule would have fired here; it was replaced.
      await vi.advanceTimersByTimeAsync(1_500);
      expect(frames).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(2_600);
      expect(frames).toHaveLength(3);
      expect(readU16(frames[2].payload, 1 * 2)).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Kill switch ────────────────────────────────────────────

describe('mspKillSwitch', () => {
  it('sends MSP_SET_RAW_RC dropping throttle to the 885 cut value', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspKillSwitch(ctx);
    expect(result.success).toBe(true);
    expect(frames).toHaveLength(1);

    const frame = frames[0];
    expect(frame.command).toBe(MSP.MSP_SET_RAW_RC);
    expect(frame.awaited).toBe(false); // fire-and-forget, no ACK wait
    expect(frame.payload).toHaveLength(16);

    // Channel 2 is throttle; the kill drops it below the arm threshold.
    expect(readU16(frame.payload, 2 * 2)).toBe(885);
    // Roll / pitch / yaw stay centered.
    expect(readU16(frame.payload, 0)).toBe(1500);
    expect(readU16(frame.payload, 1 * 2)).toBe(1500);
    expect(readU16(frame.payload, 3 * 2)).toBe(1500);
    // AUX channels low.
    for (let i = 4; i < 8; i++) {
      expect(readU16(frame.payload, i * 2)).toBe(1000);
    }

    const rt = roundTrip(frame);
    expect(readU16(rt.payload, 2 * 2)).toBe(885);
  });

  it('holds the cut on the wire instead of lasting a single frame', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, frames, rc } = ctxWith([]);
      await mspKillSwitch(ctx);
      expect(frames).toHaveLength(1);

      vi.advanceTimersByTime(500);
      expect(frames.length).toBeGreaterThan(5);
      for (const f of frames) {
        expect(f.command).toBe(MSP.MSP_SET_RAW_RC);
        expect(readU16(f.payload, 2 * 2)).toBe(RC_THROTTLE_CUT);
      }
      rc.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses stick frames while the cut is latched', async () => {
    const { ctx, frames, rc } = ctxWith([]);
    await mspKillSwitch(ctx);
    const afterCut = frames.length;

    mspSendManualControl(ctx, 1, 1, 1, 1);
    expect(frames).toHaveLength(afterCut);
    rc.destroy();
  });

  it('drops the arm channel with the cut, and arming is what releases it', async () => {
    const { ctx, frames, rc } = ctxWith([ARM_RANGE]);
    const armChannel = ARM_RANGE.auxChannel + 4;

    await mspArm(ctx);
    expect(readU16(frames[frames.length - 1].payload, armChannel * 2)).toBe(1900);

    await mspKillSwitch(ctx);
    const cutFrame = frames[frames.length - 1];
    expect(readU16(cutFrame.payload, 2 * 2)).toBe(RC_THROTTLE_CUT);
    expect(readU16(cutFrame.payload, armChannel * 2)).toBe(1000);
    expect(rc.isCut).toBe(true);

    await mspArm(ctx);
    expect(rc.isCut).toBe(false);
    const rearmed = frames[frames.length - 1];
    expect(readU16(rearmed.payload, 2 * 2)).toBe(1000);
    expect(readU16(rearmed.payload, armChannel * 2)).toBe(1900);
    rc.destroy();
  });

  it('reports failure rather than success when the receiver is not MSP', async () => {
    const { ctx, frames } = ctxWith([], { rxMspEnabled: false });
    const result = await mspKillSwitch(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('MSP receiver');
    expect(frames).toHaveLength(0);
  });
});

// ── AUX writes past the stock four ─────────────────────────

describe('AUX channel writes', () => {
  it('reaches AUX5 and beyond by widening the frame to cover the mode range', async () => {
    // AUX6 is RC channel index 9, past the eight-channel frame the old sender
    // built, so the write used to be dropped while still reporting success.
    const aux6Arm: ModeRange = { boxId: 0, auxChannel: 5, rangeStart: 1700, rangeEnd: 2100 };
    const { ctx, frames, rc } = ctxWith([aux6Arm]);

    const result = await mspArm(ctx);
    expect(result.success).toBe(true);
    expect(rc.channelCount).toBe(10);

    const frame = frames[0];
    expect(frame.payload).toHaveLength(20);
    expect(readU16(frame.payload, (aux6Arm.auxChannel + 4) * 2)).toBe(1900);
  });

  it('fails honestly when the AUX channel is past the widest frame the link carries', async () => {
    // AUX15 is RC channel index 18, past the 18-channel cap both firmwares
    // enforce on MSP_SET_RAW_RC.
    const outOfRange: ModeRange = { boxId: 0, auxChannel: 14, rangeStart: 1700, rangeEnd: 2100 };
    const { ctx, frames } = ctxWith([outOfRange]);

    const result = await mspArm(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('AUX15');
    expect(frames).toHaveLength(0);
  });

  it('fails honestly when the flight controller receiver is not MSP', async () => {
    const { ctx, frames } = ctxWith([ARM_RANGE], { rxMspEnabled: false });
    const result = await mspArm(ctx);
    expect(result.success).toBe(false);
    expect(result.message).toContain('MSP receiver');
    expect(frames).toHaveLength(0);
  });
});

// ── Reboot / bootloader ────────────────────────────────────

describe('mspReboot / mspRebootToBootloader', () => {
  it('reboot sends MSP_SET_REBOOT with payload[0]===0 (normal reboot)', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspReboot(ctx);
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_SET_REBOOT);
    expect(frames[0].payload[0]).toBe(0);

    const rt = roundTrip(frames[0]);
    expect(rt.command).toBe(MSP.MSP_SET_REBOOT);
    expect(rt.payload[0]).toBe(0);
  });

  it('bootloader reboot sends MSP_SET_REBOOT with payload[0]===1', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspRebootToBootloader(ctx);
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_SET_REBOOT);
    expect(frames[0].payload[0]).toBe(1);
  });
});

// ── Calibration ────────────────────────────────────────────

describe('mspStartCalibration', () => {
  it('accel calibration sends MSP_ACC_CALIBRATION with no payload', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspStartCalibration(ctx, 'accel');
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_ACC_CALIBRATION);
    expect(frames[0].payload).toHaveLength(0);
  });

  it('level calibration also maps to MSP_ACC_CALIBRATION', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspStartCalibration(ctx, 'level');
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_ACC_CALIBRATION);
  });

  it('compass calibration sends MSP_MAG_CALIBRATION', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspStartCalibration(ctx, 'compass');
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_MAG_CALIBRATION);
  });

  it('an unsupported calibration type fails and sends nothing', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspStartCalibration(ctx, 'esc');
    expect(result.success).toBe(false);
    expect(result.message).toContain('esc');
    expect(frames).toHaveLength(0);
  });
});

// ── EEPROM commit ──────────────────────────────────────────

describe('mspCommitParamsToFlash', () => {
  it('sends MSP_EEPROM_WRITE', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspCommitParamsToFlash(ctx);
    expect(result.success).toBe(true);
    expect(frames[0].command).toBe(MSP.MSP_EEPROM_WRITE);
  });
});

// ── Manual control (RC override stream) ────────────────────

describe('mspSendManualControl', () => {
  it('maps the normalized stick contract to 1000..2000 PWM via MSP_SET_RAW_RC', () => {
    const { ctx, frames } = ctxWith([]);
    // The only production caller (the gamepad poller) emits roll/pitch/yaw in
    // -1..1 and throttle in 0..1, matching what the MAVLink adapter scales by
    // 1000. Full deflection must reach the rail, not sit at center.
    mspSendManualControl(ctx, 1, -1, 0.5, 0.5);
    expect(frames).toHaveLength(1);

    const frame = frames[0];
    expect(frame.command).toBe(MSP.MSP_SET_RAW_RC);
    expect(frame.awaited).toBe(false);

    expect(readU16(frame.payload, 0)).toBe(2000);        // roll +1 -> full right
    expect(readU16(frame.payload, 1 * 2)).toBe(1000);    // pitch -1 -> full down
    expect(readU16(frame.payload, 2 * 2)).toBe(1500);    // throttle 0.5 -> mid
    expect(readU16(frame.payload, 3 * 2)).toBe(1750);    // yaw +0.5 -> three quarters
  });

  it('throttle 0 is idle, not the 1500 mid-throttle center', () => {
    const { ctx, frames } = ctxWith([]);
    mspSendManualControl(ctx, 0, 0, 0, 0);
    expect(readU16(frames[0].payload, 2 * 2)).toBe(1000);
  });

  it('never parks an AUX channel inside a configured arm range', () => {
    // A 1300-2100 arm range is a common setup and it contains 1500. A stick
    // frame that writes center into every AUX channel therefore arms the
    // aircraft on the first frame of the override stream.
    const wideArm: ModeRange = { boxId: 0, auxChannel: 0, rangeStart: 1300, rangeEnd: 2100 };
    const { ctx, frames } = ctxWith([wideArm]);
    mspSendManualControl(ctx, 0, 0, 0, 0);

    const armChannel = wideArm.auxChannel + 4;
    const pwm = readU16(frames[0].payload, armChannel * 2);
    expect(pwm).toBeLessThan(wideArm.rangeStart);
  });
});

// ── Flight-mode switch is intentionally unsupported ────────

describe('mspSetFlightMode', () => {
  it('returns a not-supported result and never touches the queue (no bit mapping)', async () => {
    const { ctx, frames } = ctxWith([]);
    const result = await mspSetFlightMode(ctx, 'STABILIZE');
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(-1);
    expect(frames).toHaveLength(0);
  });
});

// ── Disconnected guard ─────────────────────────────────────

describe('not-connected guard', () => {
  it('every command returns "Not connected" when the queue is null and sends nothing', async () => {
    const ctx: MspCommandContext = { queue: null, modeRanges: [], rc: null };
    for (const result of [
      await mspArm(ctx),
      await mspDisarm(ctx),
      await mspMotorTest(ctx, 0, 50, 0),
      await mspKillSwitch(ctx),
      await mspReboot(ctx),
      await mspRebootToBootloader(ctx),
      await mspStartCalibration(ctx, 'accel'),
      await mspCommitParamsToFlash(ctx),
    ]) {
      expect(result.success).toBe(false);
      expect(result.message).toBe('Not connected');
    }
  });
});
