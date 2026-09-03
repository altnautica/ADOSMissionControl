/**
 * Core MAVLink v2 message decoders: Heartbeat, SysStatus, SystemTime,
 * CommandAck, CommandLong, ParamValue, StatusText, Timesync.
 *
 * @module protocol/messages/core
 */

// Shared UTF-8 decoder reused across all string-bearing decoders in this
// module. Avoids per-message allocation at telemetry rates (10-30 Hz).
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

// ── HEARTBEAT (ID 0) ───────────────────────────────────────

export interface HeartbeatMsg {
  customMode: number;
  type: number;
  autopilot: number;
  baseMode: number;
  systemStatus: number;
  mavlinkVersion: number;
}

/**
 * Decode HEARTBEAT (msg ID 0).
 *
 * | Offset | Type   | Field           |
 * |--------|--------|-----------------|
 * | 0      | uint32 | customMode      |
 * | 4      | uint8  | type            |
 * | 5      | uint8  | autopilot       |
 * | 6      | uint8  | baseMode        |
 * | 7      | uint8  | systemStatus    |
 * | 8      | uint8  | mavlinkVersion  |
 */
export function decodeHeartbeat(dv: DataView): HeartbeatMsg {
  return {
    customMode: dv.getUint32(0, true),
    type: dv.getUint8(4),
    autopilot: dv.getUint8(5),
    baseMode: dv.getUint8(6),
    systemStatus: dv.getUint8(7),
    mavlinkVersion: dv.getUint8(8),
  };
}

// ── SYS_STATUS (ID 1) ──────────────────────────────────────

export interface SysStatusMsg {
  onboardControlSensorsPresent: number;
  onboardControlSensorsEnabled: number;
  onboardControlSensorsHealth: number;
  load: number;
  voltageBattery: number;
  currentBattery: number;
  batteryRemaining: number;
  dropRateComm: number;
  errorsComm: number;
}

/**
 * Decode SYS_STATUS (msg ID 1).
 *
 * Wire order (uint32 → uint16/int16 → int8):
 * | Offset | Type   | Field                          |
 * |--------|--------|--------------------------------|
 * | 0      | uint32 | onboardControlSensorsPresent   |
 * | 4      | uint32 | onboardControlSensorsEnabled   |
 * | 8      | uint32 | onboardControlSensorsHealth    |
 * | 12     | uint16 | load                           |
 * | 14     | uint16 | voltageBattery (mV)            |
 * | 16     | int16  | currentBattery (cA, 10*mA)     |
 * | 18     | uint16 | dropRateComm                   |
 * | 20     | uint16 | errorsComm                     |
 * | 22     | uint16 | errorsCount1                   |
 * | 24     | uint16 | errorsCount2                   |
 * | 26     | uint16 | errorsCount3                   |
 * | 28     | uint16 | errorsCount4                   |
 * | 30     | int8   | batteryRemaining (%)           |
 */
export function decodeSysStatus(dv: DataView): SysStatusMsg {
  return {
    onboardControlSensorsPresent: dv.getUint32(0, true),
    onboardControlSensorsEnabled: dv.getUint32(4, true),
    onboardControlSensorsHealth: dv.getUint32(8, true),
    load: dv.getUint16(12, true),
    voltageBattery: dv.getUint16(14, true),
    currentBattery: dv.getInt16(16, true),
    batteryRemaining: dv.getInt8(30),
    dropRateComm: dv.getUint16(18, true),
    errorsComm: dv.getUint16(20, true),
  };
}

// ── SYSTEM_TIME (ID 2) ──────────────────────────────────────

export interface SystemTimeMsg {
  timeUnixUsec: number;
  timeBootMs: number;
}

/**
 * Decode SYSTEM_TIME (msg ID 2).
 *
 * | Offset | Type   | Field         |
 * |--------|--------|---------------|
 * | 0      | uint64 | timeUnixUsec  |
 * | 8      | uint32 | timeBootMs    |
 */
export function decodeSystemTime(dv: DataView): SystemTimeMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUnixUsec: high * 0x100000000 + low,
    timeBootMs: dv.getUint32(8, true),
  };
}

// ── PARAM_VALUE (ID 22) ────────────────────────────────────

export interface ParamValueMsg {
  paramValue: number;
  paramCount: number;
  paramIndex: number;
  paramId: string;
  paramType: number;
}

/**
 * Decode PARAM_VALUE (msg ID 22).
 *
 * | Offset | Type     | Field      |
 * |--------|----------|------------|
 * | 0      | float32  | paramValue |
 * | 4      | uint16   | paramCount |
 * | 6      | uint16   | paramIndex |
 * | 8      | char[16] | paramId    |
 * | 24     | uint8    | paramType  |
 */
export function decodeParamValue(dv: DataView): ParamValueMsg {
  // Extract null-terminated param ID
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + 8, 16);
  let end = bytes.indexOf(0);
  if (end === -1) end = 16;
  const paramId = TEXT_DECODER.decode(bytes.subarray(0, end));

  return {
    paramValue: dv.getFloat32(0, true),
    paramCount: dv.getUint16(4, true),
    paramIndex: dv.getUint16(6, true),
    paramId,
    paramType: dv.getUint8(24),
  };
}

// ── COMMAND_LONG (ID 76) — Decode ───────────────────────────

export interface CommandLongMsg {
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  param5: number;
  param6: number;
  param7: number;
  command: number;
  targetSystem: number;
  targetComponent: number;
  confirmation: number;
}

/**
 * Decode COMMAND_LONG (msg ID 76).
 *
 * MAVLink wire order (largest type first):
 * | Offset | Type    | Field           |
 * |--------|---------|-----------------|
 * | 0      | float32 | param1          |
 * | 4      | float32 | param2          |
 * | 8      | float32 | param3          |
 * | 12     | float32 | param4          |
 * | 16     | float32 | param5          |
 * | 20     | float32 | param6          |
 * | 24     | float32 | param7          |
 * | 28     | uint16  | command         |
 * | 30     | uint8   | targetSystem    |
 * | 31     | uint8   | targetComponent |
 * | 32     | uint8   | confirmation    |
 */
export function decodeCommandLong(dv: DataView): CommandLongMsg {
  return {
    param1: dv.getFloat32(0, true),
    param2: dv.getFloat32(4, true),
    param3: dv.getFloat32(8, true),
    param4: dv.getFloat32(12, true),
    param5: dv.getFloat32(16, true),
    param6: dv.getFloat32(20, true),
    param7: dv.getFloat32(24, true),
    command: dv.getUint16(28, true),
    targetSystem: dv.getUint8(30),
    targetComponent: dv.getUint8(31),
    confirmation: dv.getUint8(32),
  };
}

// ── COMMAND_ACK (ID 77) ────────────────────────────────────

export interface CommandAckMsg {
  command: number;
  result: number;
  /** 0-100 for a long-running command, 255 when the sender reports none. */
  progress: number;
  /** Command-specific detail; for MAV_RESULT_FAILED it carries the reason. */
  resultParam2: number;
  /** The GCS this ack is addressed to. 0 means "any". */
  targetSystem: number;
  /** The component this ack is addressed to. 0 means "any". */
  targetComponent: number;
}

/**
 * Decode COMMAND_ACK (msg ID 77).
 *
 * | Offset | Type   | Field            |
 * |--------|--------|------------------|
 * | 0      | uint16 | command          |
 * | 2      | uint8  | result           |
 * | 3      | uint8  | progress         |
 * | 4      | int32  | result_param2    |
 * | 8      | uint8  | target_system    |
 * | 9      | uint8  | target_component |
 *
 * Everything from offset 3 is a MAVLink extension field. The canonical length
 * was pinned at 3 for a long time, which truncated the payload before the
 * parser's zero-restore could reach these, so `progress` had no source and an
 * ack addressed to a different GCS on a shared link resolved our own pending
 * command. Reads are guarded on byteLength so a genuinely short frame from an
 * old sender still decodes its base fields.
 */
export function decodeCommandAck(dv: DataView): CommandAckMsg {
  return {
    command: dv.getUint16(0, true),
    result: dv.getUint8(2),
    progress: dv.byteLength >= 4 ? dv.getUint8(3) : 255,
    resultParam2: dv.byteLength >= 8 ? dv.getInt32(4, true) : 0,
    targetSystem: dv.byteLength >= 9 ? dv.getUint8(8) : 0,
    targetComponent: dv.byteLength >= 10 ? dv.getUint8(9) : 0,
  };
}

// ── TIMESYNC (ID 111) ───────────────────────────────────────

export interface TimesyncMsg {
  tc1: number;
  ts1: number;
  targetSystem: number;
}

/**
 * Decode TIMESYNC (msg ID 111).
 *
 * | Offset | Type  | Field        |
 * |--------|-------|--------------|
 * | 0      | int64 | tc1          |
 * | 8      | int64 | ts1          |
 * | 16     | uint8 | targetSystem |
 */
export function decodeTimesync(dv: DataView): TimesyncMsg {
  const tc1Lo = dv.getUint32(0, true);
  const tc1Hi = dv.getInt32(4, true);
  const ts1Lo = dv.getUint32(8, true);
  const ts1Hi = dv.getInt32(12, true);
  return {
    tc1: tc1Hi * 0x100000000 + tc1Lo,
    ts1: ts1Hi * 0x100000000 + ts1Lo,
    targetSystem: dv.byteLength > 16 ? dv.getUint8(16) : 0,
  };
}

// ── STATUSTEXT (ID 253) ────────────────────────────────────

export interface StatustextMsg {
  severity: number;
  text: string;
}

/**
 * Decode STATUSTEXT (msg ID 253).
 *
 * | Offset | Type     | Field    |
 * |--------|----------|----------|
 * | 0      | uint8    | severity |
 * | 1      | char[50] | text     |
 */
export function decodeStatustext(dv: DataView): StatustextMsg {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + 1, 50);
  let end = bytes.indexOf(0);
  if (end === -1) end = 50;
  const text = TEXT_DECODER.decode(bytes.subarray(0, end));

  return {
    severity: dv.getUint8(0),
    text,
  };
}

// ── EVENT (ID 410) ─────────────────────────────────────────

/** Number of bytes in the EVENT `arguments` field. */
const EVENT_ARGS_LEN = 40;

export interface EventMsg {
  /** Full event id: (componentId << 24) | subId. Keys the events metadata. */
  id: number;
  eventTimeBootMs: number;
  sequence: number;
  destinationComponent: number;
  destinationSystem: number;
  /** 4-bit MSB internal + 4-bit LSB external log level (external = display). */
  logLevels: number;
  /** Packed argument bytes, decoded per the event's metadata argument types. */
  arguments: Uint8Array;
}

/**
 * Decode EVENT (msg ID 410) — the PX4/MAVLink structured events interface.
 *
 * | Offset | Type       | Field                 |
 * |--------|------------|-----------------------|
 * | 0      | uint32     | id                    |
 * | 4      | uint32     | event_time_boot_ms    |
 * | 8      | uint16     | sequence              |
 * | 10     | uint8      | destination_component |
 * | 11     | uint8      | destination_system    |
 * | 12     | uint8      | log_levels            |
 * | 13     | uint8[40]  | arguments             |
 */
export function decodeEvent(dv: DataView): EventMsg {
  const argsStart = dv.byteOffset + 13;
  return {
    id: dv.getUint32(0, true),
    eventTimeBootMs: dv.getUint32(4, true),
    sequence: dv.getUint16(8, true),
    destinationComponent: dv.getUint8(10),
    destinationSystem: dv.getUint8(11),
    logLevels: dv.getUint8(12),
    // Copy the arg bytes so the callback can hold them past the frame's reuse.
    arguments: new Uint8Array(dv.buffer.slice(argsStart, argsStart + EVENT_ARGS_LEN)),
  };
}
