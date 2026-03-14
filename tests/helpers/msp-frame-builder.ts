/**
 * MSP test frame builder.
 * Builds MSP response payloads as Uint8Array for decoder testing.
 * Pattern mirrors mavlink-frame-builder.ts.
 */

/** Build a raw payload Uint8Array with a DataView for setting values. */
function makePayload(size: number): { payload: Uint8Array; dv: DataView } {
  const payload = new Uint8Array(size);
  const dv = new DataView(payload.buffer);
  return { payload, dv };
}

/** MSP_API_VERSION (1): U8 protocol, U8 major, U8 minor */
export function buildMspApiVersionPayload(
  opts?: { protocol?: number; major?: number; minor?: number },
): Uint8Array {
  const { payload, dv } = makePayload(3);
  dv.setUint8(0, opts?.protocol ?? 0);
  dv.setUint8(1, opts?.major ?? 1);
  dv.setUint8(2, opts?.minor ?? 46);
  return payload;
}

/** MSP_FC_VARIANT (2): 4 ASCII bytes */
export function buildMspFcVariantPayload(variant = 'BTFL'): Uint8Array {
  const payload = new Uint8Array(4);
  for (let i = 0; i < 4; i++) payload[i] = variant.charCodeAt(i);
  return payload;
}

/** MSP_FC_VERSION (3): U8 major, U8 minor, U8 patch */
export function buildMspFcVersionPayload(
  opts?: { major?: number; minor?: number; patch?: number },
): Uint8Array {
  const { payload, dv } = makePayload(3);
  dv.setUint8(0, opts?.major ?? 4);
  dv.setUint8(1, opts?.minor ?? 5);
  dv.setUint8(2, opts?.patch ?? 0);
  return payload;
}

/** MSP_BOARD_INFO (4): 4 ASCII + U16 hw + U8 type */
export function buildMspBoardInfoPayload(
  opts?: { boardId?: string; hwRevision?: number; boardType?: number },
): Uint8Array {
  const { payload, dv } = makePayload(7);
  const id = opts?.boardId ?? 'S405';
  for (let i = 0; i < 4; i++) payload[i] = id.charCodeAt(i);
  dv.setUint16(4, opts?.hwRevision ?? 0, true);
  dv.setUint8(6, opts?.boardType ?? 0);
  return payload;
}

/** MSP_ATTITUDE (108): S16 roll (×10), S16 pitch (×10), S16 yaw */
export function buildMspAttitudePayload(
  opts?: { roll?: number; pitch?: number; yaw?: number },
): Uint8Array {
  const { payload, dv } = makePayload(6);
  dv.setInt16(0, Math.round((opts?.roll ?? 0) * 10), true);
  dv.setInt16(2, Math.round((opts?.pitch ?? 0) * 10), true);
  dv.setInt16(4, opts?.yaw ?? 0, true);
  return payload;
}

/** MSP_ANALOG (110): U8 legacyV, U16 mAh, U16 rssi, S16 amps(×100), U16 V(×100) */
export function buildMspAnalogPayload(
  opts?: { voltage?: number; mAhDrawn?: number; rssi?: number; amperage?: number },
): Uint8Array {
  const { payload, dv } = makePayload(9);
  dv.setUint8(0, Math.round((opts?.voltage ?? 11.1) * 10)); // legacy
  dv.setUint16(1, opts?.mAhDrawn ?? 0, true);
  dv.setUint16(3, opts?.rssi ?? 1023, true);
  dv.setInt16(5, Math.round((opts?.amperage ?? 0) * 100), true);
  dv.setUint16(7, Math.round((opts?.voltage ?? 11.1) * 100), true);
  return payload;
}

/** MSP_RAW_IMU (102): 9 × S16 */
export function buildMspRawImuPayload(
  opts?: Partial<{ accX: number; accY: number; accZ: number; gyrX: number; gyrY: number; gyrZ: number; magX: number; magY: number; magZ: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(18);
  dv.setInt16(0, opts?.accX ?? 0, true);
  dv.setInt16(2, opts?.accY ?? 0, true);
  dv.setInt16(4, opts?.accZ ?? 512, true);
  dv.setInt16(6, opts?.gyrX ?? 0, true);
  dv.setInt16(8, opts?.gyrY ?? 0, true);
  dv.setInt16(10, opts?.gyrZ ?? 0, true);
  dv.setInt16(12, opts?.magX ?? 0, true);
  dv.setInt16(14, opts?.magY ?? 0, true);
  dv.setInt16(16, opts?.magZ ?? 0, true);
  return payload;
}

/** MSP_ALTITUDE (109): S32 alt(×100), S16 vario */
export function buildMspAltitudePayload(
  opts?: { altitude?: number; vario?: number },
): Uint8Array {
  const { payload, dv } = makePayload(6);
  dv.setInt32(0, Math.round((opts?.altitude ?? 0) * 100), true);
  dv.setInt16(4, opts?.vario ?? 0, true);
  return payload;
}

/** MSP_RC (105): variable U16 channels */
export function buildMspRcPayload(channels: number[]): Uint8Array {
  const { payload, dv } = makePayload(channels.length * 2);
  for (let i = 0; i < channels.length; i++) {
    dv.setUint16(i * 2, channels[i], true);
  }
  return payload;
}

/** MSP_MOTOR (104): variable U16 motors */
export function buildMspMotorPayload(motors: number[]): Uint8Array {
  const { payload, dv } = makePayload(motors.length * 2);
  for (let i = 0; i < motors.length; i++) {
    dv.setUint16(i * 2, motors[i], true);
  }
  return payload;
}

/** MSP_PID (112): 3 bytes per axis */
export function buildMspPidPayload(pids: Array<{ p: number; i: number; d: number }>): Uint8Array {
  const payload = new Uint8Array(pids.length * 3);
  for (let ax = 0; ax < pids.length; ax++) {
    payload[ax * 3] = pids[ax].p;
    payload[ax * 3 + 1] = pids[ax].i;
    payload[ax * 3 + 2] = pids[ax].d;
  }
  return payload;
}

/** MSP_MOTOR_CONFIG (131): U16×3 + U8×4 */
export function buildMspMotorConfigPayload(
  opts?: Partial<{ minThrottle: number; maxThrottle: number; minCommand: number; motorCount: number; motorPoles: number; useDshotTelemetry: boolean; useEscSensor: boolean }>,
): Uint8Array {
  const { payload, dv } = makePayload(10);
  dv.setUint16(0, opts?.minThrottle ?? 1070, true);
  dv.setUint16(2, opts?.maxThrottle ?? 2000, true);
  dv.setUint16(4, opts?.minCommand ?? 1000, true);
  dv.setUint8(6, opts?.motorCount ?? 4);
  dv.setUint8(7, opts?.motorPoles ?? 14);
  dv.setUint8(8, opts?.useDshotTelemetry ? 1 : 0);
  dv.setUint8(9, opts?.useEscSensor ? 1 : 0);
  return payload;
}

/** MSP_BATTERY_CONFIG (32): 3 legacy U8 + U16 cap + U8 voltSrc + U8 currSrc + 3 U16 (÷100) */
export function buildMspBatteryConfigPayload(
  opts?: Partial<{ minCell: number; maxCell: number; warningCell: number; capacity: number; voltSource: number; currSource: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(13);
  const min = opts?.minCell ?? 3.3;
  const max = opts?.maxCell ?? 4.3;
  const warn = opts?.warningCell ?? 3.5;
  dv.setUint8(0, Math.round(min * 10));
  dv.setUint8(1, Math.round(max * 10));
  dv.setUint8(2, Math.round(warn * 10));
  dv.setUint16(3, opts?.capacity ?? 1300, true);
  dv.setUint8(5, opts?.voltSource ?? 0);
  dv.setUint8(6, opts?.currSource ?? 0);
  dv.setUint16(7, Math.round(min * 100), true);
  dv.setUint16(9, Math.round(max * 100), true);
  dv.setUint16(11, Math.round(warn * 100), true);
  return payload;
}

/** MSP_FAILSAFE_CONFIG (75) */
export function buildMspFailsafeConfigPayload(
  opts?: Partial<{ delay: number; offDelay: number; throttle: number; switchMode: number; throttleLowDelay: number; procedure: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(8);
  dv.setUint8(0, opts?.delay ?? 10);
  dv.setUint8(1, opts?.offDelay ?? 10);
  dv.setUint16(2, opts?.throttle ?? 1000, true);
  dv.setUint8(4, opts?.switchMode ?? 0);
  dv.setUint16(5, opts?.throttleLowDelay ?? 100, true);
  dv.setUint8(7, opts?.procedure ?? 0);
  return payload;
}

/** MSP_STATUS_EX (150) — simplified */
export function buildMspStatusExPayload(
  opts?: Partial<{ cycleTime: number; i2cErrors: number; sensors: number; modeFlags: number; cpuLoad: number; armDisableFlags: number; configStateFlags: number }>,
): Uint8Array {
  // 16 bytes header + 0 flight mode flag bytes + 1 armDisableCount + 4 armDisableFlags + 1 configStateFlags
  const byteCount = 0;
  const { payload, dv } = makePayload(16 + byteCount + 6);
  dv.setUint16(0, opts?.cycleTime ?? 125, true);
  dv.setUint16(2, opts?.i2cErrors ?? 0, true);
  dv.setUint16(4, opts?.sensors ?? 0x3f, true);
  dv.setUint32(6, opts?.modeFlags ?? 0, true);
  dv.setUint8(10, 0); // currentProfile
  dv.setUint16(11, opts?.cpuLoad ?? 50, true);
  dv.setUint8(13, 3); // profileCount
  dv.setUint8(14, 0); // rateProfile
  dv.setUint8(15, byteCount); // byteCount
  // afterFlags = 16
  dv.setUint8(16, 1); // armDisableCount
  dv.setUint32(17, opts?.armDisableFlags ?? 0, true);
  dv.setUint8(21, opts?.configStateFlags ?? 0);
  return payload;
}

/** MSP_VTX_CONFIG (88) */
export function buildMspVtxConfigPayload(
  opts?: Partial<{ type: number; band: number; channel: number; power: number; pitMode: boolean; frequency: number; deviceReady: boolean; lowPowerDisarm: number; pitModeFrequency: number; vtxTableAvailable: boolean; vtxTableBands: number; vtxTableChannels: number; vtxTablePowerLevels: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(15);
  dv.setUint8(0, opts?.type ?? 1);
  dv.setUint8(1, opts?.band ?? 4);
  dv.setUint8(2, opts?.channel ?? 1);
  dv.setUint8(3, opts?.power ?? 3);
  dv.setUint8(4, opts?.pitMode ? 1 : 0);
  dv.setUint16(5, opts?.frequency ?? 5740, true);
  dv.setUint8(7, opts?.deviceReady ? 1 : 0);
  dv.setUint8(8, opts?.lowPowerDisarm ?? 0);
  dv.setUint16(9, opts?.pitModeFrequency ?? 0, true);
  dv.setUint8(11, opts?.vtxTableAvailable ? 1 : 0);
  dv.setUint8(12, opts?.vtxTableBands ?? 5);
  dv.setUint8(13, opts?.vtxTableChannels ?? 8);
  dv.setUint8(14, opts?.vtxTablePowerLevels ?? 5);
  return payload;
}

/** MSP_GPS_CONFIG (132) */
export function buildMspGpsConfigPayload(
  opts?: Partial<{ provider: number; sbasMode: number; autoConfig: number; autoBaud: number; homePointOnce: number; ubloxUseGalileo: number }>,
): Uint8Array {
  const payload = new Uint8Array(6);
  payload[0] = opts?.provider ?? 1;
  payload[1] = opts?.sbasMode ?? 0;
  payload[2] = opts?.autoConfig ?? 1;
  payload[3] = opts?.autoBaud ?? 1;
  payload[4] = opts?.homePointOnce ?? 0;
  payload[5] = opts?.ubloxUseGalileo ?? 0;
  return payload;
}

/** MSP_BLACKBOX_CONFIG (80) */
export function buildMspBlackboxConfigPayload(
  opts?: Partial<{ supported: boolean; device: number; rateNum: number; rateDenom: number; pDenom: number; sampleRate: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(7);
  dv.setUint8(0, (opts?.supported ?? true) ? 1 : 0);
  dv.setUint8(1, opts?.device ?? 1);
  dv.setUint8(2, opts?.rateNum ?? 1);
  dv.setUint8(3, opts?.rateDenom ?? 1);
  dv.setUint16(4, opts?.pDenom ?? 32, true);
  dv.setUint8(6, opts?.sampleRate ?? 0);
  return payload;
}

/** MSP_BEEPER_CONFIG (184) */
export function buildMspBeeperConfigPayload(
  opts?: Partial<{ disabledMask: number; dshotBeaconTone: number; dshotBeaconConditionsMask: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(9);
  dv.setUint32(0, opts?.disabledMask ?? 0, true);
  dv.setUint8(4, opts?.dshotBeaconTone ?? 1);
  dv.setUint32(5, opts?.dshotBeaconConditionsMask ?? 0, true);
  return payload;
}

/** MSP_RAW_GPS (106) */
export function buildMspRawGpsPayload(
  opts?: Partial<{ fixType: number; numSat: number; lat: number; lon: number; alt: number; speed: number; groundCourse: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(16);
  dv.setUint8(0, opts?.fixType ?? 3);
  dv.setUint8(1, opts?.numSat ?? 12);
  dv.setInt32(2, Math.round((opts?.lat ?? 12.9716) * 1e7), true);
  dv.setInt32(6, Math.round((opts?.lon ?? 77.5946) * 1e7), true);
  dv.setUint16(10, opts?.alt ?? 100, true);
  dv.setUint16(12, opts?.speed ?? 500, true);
  dv.setUint16(14, Math.round((opts?.groundCourse ?? 90.0) * 10), true);
  return payload;
}

/** MSP_BATTERY_STATE (130) */
export function buildMspBatteryStatePayload(
  opts?: Partial<{ cellCount: number; capacity: number; voltage: number; mAhDrawn: number; amperage: number; state: number }>,
): Uint8Array {
  const { payload, dv } = makePayload(11);
  dv.setUint8(0, opts?.cellCount ?? 3);
  dv.setUint16(1, opts?.capacity ?? 1300, true);
  dv.setUint8(3, Math.round((opts?.voltage ?? 11.1) * 10)); // legacy
  dv.setUint16(4, opts?.mAhDrawn ?? 0, true);
  dv.setUint16(6, Math.round((opts?.amperage ?? 0) * 100), true);
  dv.setUint8(8, opts?.state ?? 0);
  dv.setUint16(9, Math.round((opts?.voltage ?? 11.1) * 100), true);
  return payload;
}
