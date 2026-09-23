/**
 * MSP payload encoders for FC configuration: feature mask, serial ports,
 * failsafe, arming, mode ranges, and beeper.
 *
 * @module protocol/msp/encoders/config
 */

import { makeBuffer, push8, push16, push32 } from "./helpers";
import type { BfRxConfig } from "../decoders/config/rx";

/**
 * MSP_SET_FEATURE_CONFIG (37)
 * U32 featureMask
 */
export function encodeMspSetFeatureConfig(mask: number): Uint8Array {
  const { buf, dv } = makeBuffer(4);
  push32(dv, 0, mask);
  return buf;
}


/**
 * MSP_SET_CF_SERIAL_CONFIG (55)
 * Per port: U8 identifier, U16 functionMask, U8 msp, U8 gps, U8 telem, U8 blackbox
 */
export function encodeMspSetSerialConfig(
  ports: Array<{
    identifier: number;
    functions: number;
    mspBaudRate: number;
    gpsBaudRate: number;
    telemetryBaudRate: number;
    blackboxBaudRate: number;
  }>,
): Uint8Array {
  const { buf, dv } = makeBuffer(ports.length * 7);
  for (let i = 0; i < ports.length; i++) {
    const off = i * 7;
    push8(dv, off, ports[i].identifier);
    push16(dv, off + 1, ports[i].functions);
    push8(dv, off + 3, ports[i].mspBaudRate);
    push8(dv, off + 4, ports[i].gpsBaudRate);
    push8(dv, off + 5, ports[i].telemetryBaudRate);
    push8(dv, off + 6, ports[i].blackboxBaudRate);
  }
  return buf;
}

/**
 * MSP2_SEND_DSHOT_COMMAND (0x3003) — send DShot special commands to an ESC.
 * U8 commandType (0 INLINE / 1 BLOCKING), U8 motorIndex (255 = all), U8 count,
 * then `count` command bytes (dshotCommands_e). Disarmed-only; no reply.
 */
export function encodeMspSendDshotCommand(
  commandType: number,
  motorIndex: number,
  commands: number[],
): Uint8Array {
  const { buf, dv } = makeBuffer(3 + commands.length);
  push8(dv, 0, commandType);
  push8(dv, 1, motorIndex);
  push8(dv, 2, commands.length);
  for (let i = 0; i < commands.length; i++) push8(dv, 3 + i, commands[i] & 0xff);
  return buf;
}

/**
 * MSP2_COMMON_SET_SERIAL_CONFIG (0x100A) — U8 count, then per port (10 bytes):
 * U8 identifier, U32 functionMask, U8 msp, U8 gps, U8 telem, U8 blackbox.
 * The 32-bit mask carries function bits above 15 that the legacy U16 drops.
 */
export function encodeMspSetSerialConfig2(
  ports: Array<{
    identifier: number;
    functions: number;
    mspBaudRate: number;
    gpsBaudRate: number;
    telemetryBaudRate: number;
    blackboxBaudRate: number;
  }>,
): Uint8Array {
  const { buf, dv } = makeBuffer(1 + ports.length * 10);
  push8(dv, 0, ports.length);
  for (let i = 0; i < ports.length; i++) {
    const off = 1 + i * 10;
    push8(dv, off, ports[i].identifier);
    push32(dv, off + 1, ports[i].functions >>> 0);
    push8(dv, off + 5, ports[i].mspBaudRate);
    push8(dv, off + 6, ports[i].gpsBaudRate);
    push8(dv, off + 7, ports[i].telemetryBaudRate);
    push8(dv, off + 8, ports[i].blackboxBaudRate);
  }
  return buf;
}


/**
 * MSP_SET_RX_CONFIG (45)
 * Echo the raw MSP_RX_CONFIG payload with the edited leading fields patched, so
 * the version-dependent trailing bytes round-trip untouched.
 */
export function encodeMspSetRxConfig(cfg: BfRxConfig): Uint8Array {
  const buf = new Uint8Array(cfg.raw); // copy the echoed payload
  const dv = new DataView(buf.buffer);
  const len = buf.length;
  // Patch each field only when the echoed payload is long enough (version-safe).
  const s8 = (off: number, v: number) => { if (off < len) dv.setUint8(off, v & 0xff); };
  const s16 = (off: number, v: number) => { if (off + 1 < len) dv.setUint16(off, v & 0xffff, true); };
  s8(0, cfg.serialrxProvider);
  s16(1, cfg.maxcheck);
  s16(3, cfg.midrc);
  s16(5, cfg.mincheck);
  s8(7, cfg.spektrumSatBind);
  s16(8, cfg.rxMinUsec);
  s16(10, cfg.rxMaxUsec);
  s16(14, cfg.airModeThresholdPct * 10 + 1000); // wire is scaled
  s8(22, cfg.fpvCamAngle);
  s8(25, cfg.rcSmoothingSetpointCutoff);
  s8(26, cfg.rcSmoothingThrottleCutoff);
  s8(27, cfg.rcSmoothingAutoFactorThrottle);
  s8(29, cfg.usbCdcHidType);
  s8(30, cfg.rcSmoothingAutoFactorRpy);
  s8(31, cfg.rcSmoothing);
  return buf;
}

/**
 * MSP_SET_RX_MAP (65)
 * The RC channel map: one input channel index per position.
 */
export function encodeMspSetRxMap(map: number[]): Uint8Array {
  return Uint8Array.from(map.map((c) => c & 0xff));
}


/**
 * MSP_SET_FAILSAFE_CONFIG (76)
 *   U8  delay
 *   U8  offDelay
 *   U16 throttle
 *   U8  switchMode
 *   U16 throttleLowDelay
 *   U8  procedure
 */
export function encodeMspSetFailsafeConfig(config: {
  delay: number;
  offDelay: number;
  throttle: number;
  switchMode: number;
  throttleLowDelay: number;
  procedure: number;
}): Uint8Array {
  const { buf, dv } = makeBuffer(8);
  push8(dv, 0, config.delay);
  push8(dv, 1, config.offDelay);
  push16(dv, 2, config.throttle);
  push8(dv, 4, config.switchMode);
  push16(dv, 5, config.throttleLowDelay);
  push8(dv, 7, config.procedure);
  return buf;
}


/**
 * MSP_SET_ARMING_CONFIG (62)
 *   U8 autoDisarmDelay
 *   U8 0 (deprecated kill switch)
 *   U8 smallAngle
 */
export function encodeMspSetArmingConfig(config: {
  autoDisarmDelay: number;
  smallAngle: number;
}): Uint8Array {
  const { buf, dv } = makeBuffer(3);
  push8(dv, 0, config.autoDisarmDelay);
  push8(dv, 1, 0); // deprecated kill_switch
  push8(dv, 2, config.smallAngle);
  return buf;
}


/**
 * MSP_SET_MODE_RANGE (35)
 *
 *   U8 index (which mode range slot)
 *   U8 boxId (permanent id)
 *   U8 auxChannel
 *   U8 rangeStart ((pwm - 900) / 25)
 *   U8 rangeEnd ((pwm - 900) / 25)
 *   U8 modeLogic, U8 linkedTo  (only when `linked` is given: Betaflight
 *   reads them when present; iNav accepts only the 5-byte form)
 */
export function encodeMspSetModeRange(
  range: {
    index: number;
    boxId: number;
    auxChannel: number;
    rangeStart: number;
    rangeEnd: number;
  },
  linked?: { modeLogic: number; linkedTo: number },
): Uint8Array {
  const { buf, dv } = makeBuffer(linked ? 7 : 5);
  push8(dv, 0, range.index);
  push8(dv, 1, range.boxId);
  push8(dv, 2, range.auxChannel);
  push8(dv, 3, Math.round((range.rangeStart - 900) / 25));
  push8(dv, 4, Math.round((range.rangeEnd - 900) / 25));
  if (linked) {
    push8(dv, 5, linked.modeLogic);
    push8(dv, 6, linked.linkedTo);
  }
  return buf;
}


/**
 * MSP_SET_BEEPER_CONFIG (185)
 *   U32 disabledMask
 *   U8  dshotBeaconTone
 *   U32 dshotBeaconConditionsMask
 */
export function encodeMspSetBeeperConfig(
  disabledMask: number,
  dshotTone: number,
  dshotConditions: number,
): Uint8Array {
  const { buf, dv } = makeBuffer(9);
  push32(dv, 0, disabledMask);
  push8(dv, 4, dshotTone);
  push32(dv, 5, dshotConditions);
  return buf;
}

