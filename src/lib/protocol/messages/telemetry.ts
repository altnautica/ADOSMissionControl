/**
 * Telemetry MAVLink v2 message decoders: Attitude, GPS, GlobalPosition,
 * VfrHud, RcChannels, BatteryStatus, RadioStatus, LocalPositionNed,
 * ScaledImu, PowerStatus.
 *
 * @module protocol/messages/telemetry
 */

// ── ATTITUDE (ID 30) ───────────────────────────────────────

export interface AttitudeMsg {
  timeBootMs: number;
  roll: number;
  pitch: number;
  yaw: number;
  rollspeed: number;
  pitchspeed: number;
  yawspeed: number;
}

/**
 * Decode ATTITUDE (msg ID 30).
 *
 * | Offset | Type    | Field       |
 * |--------|---------|-------------|
 * | 0      | uint32  | timeBootMs  |
 * | 4      | float32 | roll (rad)  |
 * | 8      | float32 | pitch (rad) |
 * | 12     | float32 | yaw (rad)   |
 * | 16     | float32 | rollspeed   |
 * | 20     | float32 | pitchspeed  |
 * | 24     | float32 | yawspeed    |
 */
export function decodeAttitude(dv: DataView): AttitudeMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    roll: dv.getFloat32(4, true),
    pitch: dv.getFloat32(8, true),
    yaw: dv.getFloat32(12, true),
    rollspeed: dv.getFloat32(16, true),
    pitchspeed: dv.getFloat32(20, true),
    yawspeed: dv.getFloat32(24, true),
  };
}

// ── GPS_RAW_INT (ID 24) ────────────────────────────────────

export interface GpsRawIntMsg {
  timeUsec: number;
  fixType: number;
  lat: number;
  lon: number;
  alt: number;
  eph: number;
  epv: number;
  vel: number;
  cog: number;
  satellitesVisible: number;
}

/**
 * Decode GPS_RAW_INT (msg ID 24).
 *
 * | Offset | Type   | Field             |
 * |--------|--------|-------------------|
 * | 0      | uint64 | timeUsec          |
 * | 8      | int32  | lat (degE7)       |
 * | 12     | int32  | lon (degE7)       |
 * | 16     | int32  | alt (mm MSL)      |
 * | 20     | uint16 | eph (cm)          |
 * | 22     | uint16 | epv (cm)          |
 * | 24     | uint16 | vel (cm/s)        |
 * | 26     | uint16 | cog (cdeg)        |
 * | 28     | uint8  | fixType           |
 * | 29     | uint8  | satellitesVisible |
 */
export function decodeGpsRawInt(dv: DataView): GpsRawIntMsg {
  // timeUsec is uint64 — read as two uint32 and combine (safe up to 2^53)
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUsec: high * 0x100000000 + low,
    lat: dv.getInt32(8, true),
    lon: dv.getInt32(12, true),
    alt: dv.getInt32(16, true),
    eph: dv.getUint16(20, true),
    epv: dv.getUint16(22, true),
    vel: dv.getUint16(24, true),
    cog: dv.getUint16(26, true),
    fixType: dv.getUint8(28),
    satellitesVisible: dv.getUint8(29),
  };
}

// ── GLOBAL_POSITION_INT (ID 33) ────────────────────────────

export interface GlobalPositionIntMsg {
  timeBootMs: number;
  lat: number;
  lon: number;
  alt: number;
  relativeAlt: number;
  vx: number;
  vy: number;
  vz: number;
  hdg: number;
}

/**
 * Decode GLOBAL_POSITION_INT (msg ID 33).
 *
 * | Offset | Type   | Field       |
 * |--------|--------|-------------|
 * | 0      | uint32 | timeBootMs  |
 * | 4      | int32  | lat (degE7) |
 * | 8      | int32  | lon (degE7) |
 * | 12     | int32  | alt (mm)    |
 * | 16     | int32  | relativeAlt |
 * | 20     | int16  | vx (cm/s)   |
 * | 22     | int16  | vy (cm/s)   |
 * | 24     | int16  | vz (cm/s)   |
 * | 26     | uint16 | hdg (cdeg)  |
 */
export function decodeGlobalPositionInt(dv: DataView): GlobalPositionIntMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    lat: dv.getInt32(4, true),
    lon: dv.getInt32(8, true),
    alt: dv.getInt32(12, true),
    relativeAlt: dv.getInt32(16, true),
    vx: dv.getInt16(20, true),
    vy: dv.getInt16(22, true),
    vz: dv.getInt16(24, true),
    hdg: dv.getUint16(26, true),
  };
}

// ── RC_CHANNELS (ID 65) ────────────────────────────────────

export interface RcChannelsMsg {
  timeBootMs: number;
  chancount: number;
  channels: number[];
  rssi: number;
}

/**
 * Decode RC_CHANNELS (msg ID 65).
 *
 * | Offset | Type   | Field       |
 * |--------|--------|-------------|
 * Wire order (uint32 → uint16 → uint8):
 * | Offset | Type   | Field       |
 * |--------|--------|-------------|
 * | 0      | uint32 | timeBootMs  |
 * | 4      | uint16 | chan1_raw    |
 * | 6      | uint16 | chan2_raw    |
 * | ...    | ...    | ...         |
 * | 38     | uint16 | chan18_raw   |
 * | 40     | uint8  | chancount   |
 * | 41     | uint8  | rssi        |
 */
export function decodeRcChannels(dv: DataView): RcChannelsMsg {
  const channels: number[] = [];
  for (let i = 0; i < 18; i++) {
    channels.push(dv.getUint16(4 + i * 2, true));
  }
  return {
    timeBootMs: dv.getUint32(0, true),
    chancount: dv.getUint8(40),
    channels,
    rssi: dv.getUint8(41),
  };
}

// ── VFR_HUD (ID 74) ────────────────────────────────────────

export interface VfrHudMsg {
  airspeed: number;
  groundspeed: number;
  heading: number;
  throttle: number;
  alt: number;
  climb: number;
}

/**
 * Decode VFR_HUD (msg ID 74).
 *
 * Wire order (float32 → int16/uint16):
 * | Offset | Type    | Field       |
 * |--------|---------|-------------|
 * | 0      | float32 | airspeed    |
 * | 4      | float32 | groundspeed |
 * | 8      | float32 | alt         |
 * | 12     | float32 | climb       |
 * | 16     | int16   | heading     |
 * | 18     | uint16  | throttle    |
 */
export function decodeVfrHud(dv: DataView): VfrHudMsg {
  return {
    airspeed: dv.getFloat32(0, true),
    groundspeed: dv.getFloat32(4, true),
    heading: dv.getInt16(16, true),
    throttle: dv.getUint16(18, true),
    alt: dv.getFloat32(8, true),
    climb: dv.getFloat32(12, true),
  };
}

// ── RADIO_STATUS (ID 109) ──────────────────────────────────

export interface RadioStatusMsg {
  rxerrors: number;
  fixed: number;
  rssi: number;
  remrssi: number;
  txbuf: number;
  noise: number;
  remnoise: number;
}

/**
 * Decode RADIO_STATUS (msg ID 109).
 *
 * | Offset | Type   | Field     |
 * |--------|--------|-----------|
 * | 0      | uint16 | rxerrors  |
 * | 2      | uint16 | fixed     |
 * | 4      | uint8  | rssi      |
 * | 5      | uint8  | remrssi   |
 * | 6      | uint8  | txbuf     |
 * | 7      | uint8  | noise     |
 * | 8      | uint8  | remnoise  |
 */
export function decodeRadioStatus(dv: DataView): RadioStatusMsg {
  return {
    rxerrors: dv.getUint16(0, true),
    fixed: dv.getUint16(2, true),
    rssi: dv.getUint8(4),
    remrssi: dv.getUint8(5),
    txbuf: dv.getUint8(6),
    noise: dv.getUint8(7),
    remnoise: dv.getUint8(8),
  };
}

// ── BATTERY_STATUS (ID 147) ────────────────────────────────

export interface BatteryStatusMsg {
  id: number;
  batteryFunction: number;
  type: number;
  temperature: number;
  voltages: number[];
  /** Cells 11-14 (extension field); 0 means no cell. */
  voltagesExt: number[];
  currentBattery: number;
  currentConsumed: number;
  energyConsumed: number;
  batteryRemaining: number;
}

/**
 * Decode BATTERY_STATUS (msg ID 147).
 *
 * Wire order (int32 → int16/uint16 → uint8/int8):
 * | Offset | Type        | Field            |
 * |--------|-------------|------------------|
 * | 0      | int32       | currentConsumed  |
 * | 4      | int32       | energyConsumed   |
 * | 8      | int16       | temperature (cC) |
 * | 10     | uint16[10]  | voltages (mV)    |
 * | 30     | int16       | currentBattery   |
 * | 32     | uint8       | id               |
 * | 33     | uint8       | batteryFunction  |
 * | 34     | uint8       | type             |
 * | 35     | int8        | batteryRemaining |
 * | 36     | int32       | timeRemaining    | (extension)
 * | 40     | uint8       | chargeState      | (extension)
 * | 41     | uint16[4]   | voltagesExt (mV) | (extension)
 *
 * The parser zero-extends truncated payloads to the full 54-byte length, so
 * extension fields read 0 when the sender omits them.
 */
export function decodeBatteryStatus(dv: DataView): BatteryStatusMsg {
  const voltages: number[] = [];
  for (let i = 0; i < 10; i++) {
    voltages.push(dv.getUint16(10 + i * 2, true));
  }
  const voltagesExt: number[] = [];
  for (let i = 0; i < 4; i++) {
    voltagesExt.push(dv.byteLength >= 43 + i * 2 ? dv.getUint16(41 + i * 2, true) : 0);
  }

  return {
    id: dv.getUint8(32),
    batteryFunction: dv.getUint8(33),
    type: dv.getUint8(34),
    temperature: dv.getInt16(8, true),
    voltages,
    voltagesExt,
    currentBattery: dv.getInt16(30, true),
    currentConsumed: dv.getInt32(0, true),
    energyConsumed: dv.getInt32(4, true),
    batteryRemaining: dv.getInt8(35),
  };
}

