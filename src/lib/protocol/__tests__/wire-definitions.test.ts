/**
 * @module protocol/wire-definitions.test
 * @description Cross-checks every hand-written MAVLink wire constant against a
 * fixture generated from the MAVLink XML message definitions
 * (`scripts/mavlink-wire/generate.mjs`), never against our own tables:
 *
 * - CRC_EXTRA seed and full payload length of every message in the tables;
 * - the diagnostic name table;
 * - the wire offset of every field every decoder reads;
 * - the MAV_CMD number every command sender puts on the wire;
 * - the MAV_RESULT, MAV_PARAM_TYPE and GPS_FIX_TYPE values the code names.
 *
 * A wrong id, seed, length, offset or command number in a table edit fails
 * here instead of silently discarding frames or commanding the wrong thing.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import definitions from "./fixtures/mavlink-definitions.json";
import { CRC_EXTRA, PAYLOAD_LENGTHS } from "../mavlink-crc-extra";
import { MSG_NAMES } from "../mavlink-adapter-frame-handlers";
import * as decoders from "../mavlink-messages";
import * as cmds from "../mavlink-adapter-commands";
import { setCurrentMissionItem, type MissionContext } from "../mavlink-adapter-missions";
import { CommandQueue, MAV_RESULT } from "../command-queue";
import { MAV_PARAM_TYPE } from "../param-value-codec";
import { mspGpsFixToMavlink } from "../msp/msp-mavlink-semantics";
import type { CommandResult, FirmwareType } from "../types";

interface FieldDef {
  name: string;
  type: string;
  offset: number;
  arrayLength: number;
  extension: boolean;
}
interface MessageDef {
  name: string;
  crcExtra: number;
  length: number;
  baseLength: number;
  fields: FieldDef[];
}

const MESSAGES = definitions.messages as Record<string, MessageDef>;
const ENUMS = definitions.enums as Record<string, Record<string, number>>;
const MAV_CMD = ENUMS.MAV_CMD;

function def(id: number): MessageDef {
  const m = MESSAGES[String(id)];
  if (!m) throw new Error(`message ${id} is not in the definitions`);
  return m;
}

describe("CRC_EXTRA and PAYLOAD_LENGTHS", () => {
  it.each([...CRC_EXTRA])("message %i seeds its CRC with the defined CRC_EXTRA", (id, seed) => {
    expect(seed, def(id).name).toBe(def(id).crcExtra);
  });

  it.each([...PAYLOAD_LENGTHS])("message %i restores to its full length, extensions included", (id, len) => {
    expect(len, def(id).name).toBe(def(id).length);
  });

  it("every seeded message has a length and every length has a seed", () => {
    expect([...CRC_EXTRA.keys()].sort()).toEqual([...PAYLOAD_LENGTHS.keys()].sort());
  });

  it("ADSB_VEHICLE is decoded, so ADS-B traffic frames are not dropped", () => {
    expect(CRC_EXTRA.get(246)).toBe(def(246).crcExtra);
  });
});

describe("diagnostic message names", () => {
  it("every named id carries the defined message name", () => {
    const wrong = Object.entries(MSG_NAMES)
      .filter(([id]) => MESSAGES[id] !== undefined)
      .filter(([id, name]) => MESSAGES[id].name !== name)
      .map(([id, name]) => `${id}: ${name} (defined ${MESSAGES[id].name})`);
    expect(wrong).toEqual([]);
  });
});

// ── Decoder field offsets ───────────────────────────────────

const ELEMENT_SIZE: Record<string, number> = {
  char: 1, int8_t: 1, uint8_t: 1, int16_t: 2, uint16_t: 2,
  int32_t: 4, uint32_t: 4, float: 4, int64_t: 8, uint64_t: 8, double: 8,
};

const camel = (name: string) => name.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (name: string) => name.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

/** Decoded keys that are not the camelCase wire name, per message. */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  SERVO_OUTPUT_RAW: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`servo${i + 1}`, `servo${i + 1}_raw`])),
  FENCE_POINT: { lon: "lng" },
  HOME_POSITION: { lat: "latitude", lon: "longitude", alt: "altitude" },
  AIS_VESSEL: { MMSI: "MMSI", COG: "COG" },
  CAMERA_IMAGE_CAPTURED: { timeUtcUs: "time_utc" },
};

/** Decoded keys the decoder deliberately converts to display units. */
const KEY_SCALES: Record<string, Record<string, number>> = {
  CAMERA_IMAGE_CAPTURED: { lat: 1e-7, lon: 1e-7, alt: 1e-3, relativeAlt: 1e-3 },
};

/** Keys assembled from several wire fields, checked by their own tests. */
const COMPOSITE_KEYS: Record<string, string[]> = {
  RC_CHANNELS: ["channels"],
  // Whether the text field held a NUL, i.e. the last chunk of a long message.
  STATUSTEXT: ["terminated"],
};

/** Messages whose payload is itself a protocol (FTP), with its own decoder test. */
const OPAQUE_PAYLOAD = new Set(["FILE_TRANSFER_PROTOCOL"]);

function writeElement(dv: DataView, type: string, offset: number, v: number): void {
  switch (type) {
    case "char": case "uint8_t": dv.setUint8(offset, v); break;
    case "int8_t": dv.setInt8(offset, v); break;
    case "uint16_t": dv.setUint16(offset, v, true); break;
    case "int16_t": dv.setInt16(offset, v, true); break;
    case "uint32_t": dv.setUint32(offset, v, true); break;
    case "int32_t": dv.setInt32(offset, v, true); break;
    case "float": dv.setFloat32(offset, v, true); break;
    case "double": dv.setFloat64(offset, v, true); break;
    // Low word only: a small value reads the same through every uint64 path.
    case "uint64_t": case "int64_t": dv.setUint32(offset, v, true); break;
  }
}

/**
 * A full-length payload where every field holds a value distinct from its
 * neighbours, and the value each field must decode to (keyed by wire name).
 */
function distinctPayload(m: MessageDef): { dv: DataView; expected: Map<string, number | number[] | string> } {
  const dv = new DataView(new ArrayBuffer(m.length));
  const expected = new Map<string, number | number[] | string>();
  m.fields.forEach((f, k) => {
    const count = Math.max(1, f.arrayLength);
    if (f.type === "char") {
      let text = "";
      for (let i = 0; i < count - 1; i++) {
        const c = 65 + ((k + i) % 26);
        dv.setUint8(f.offset + i, c);
        text += String.fromCharCode(c);
      }
      expected.set(f.name, text);
      return;
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      // Floats get exactly representable halves; integers stay in 1..100 so
      // they fit every width and sign.
      const v = f.type === "float" || f.type === "double" ? k + i + 1.5 : ((k * 7 + i) % 100) + 1;
      writeElement(dv, f.type, f.offset + i * ELEMENT_SIZE[f.type], v);
      values.push(v);
    }
    expected.set(f.name, f.arrayLength ? values : values[0]);
  });
  return { dv, expected };
}

function asComparable(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v as unknown as ArrayLike<number>);
  return v;
}

type Decoder = (dv: DataView) => Record<string, unknown>;
const DECODED: Array<[string, MessageDef, Decoder]> = Object.values(MESSAGES).flatMap((m) => {
  const fn = (decoders as Record<string, unknown>)[`decode${pascal(m.name)}`];
  return typeof fn === "function" && !OPAQUE_PAYLOAD.has(m.name) ? [[m.name, m, fn as Decoder]] : [];
});

describe("decoder field offsets", () => {
  it("finds the decoders by their message name", () => {
    expect(DECODED.length).toBeGreaterThan(60);
  });

  it.each(DECODED)("%s reads every field from its defined offset", (name, m, decode) => {
    const { dv, expected } = distinctPayload(m);
    const decoded = decode(dv);
    const aliases = KEY_ALIASES[name] ?? {};
    const scales = KEY_SCALES[name] ?? {};
    const composite = new Set(COMPOSITE_KEYS[name] ?? []);
    const byKey = new Map([...expected].map(([wire, v]) => [camel(wire), [wire, v] as const]));
    for (const [key, wire] of Object.entries(aliases)) byKey.set(key, [wire, expected.get(wire)!]);

    const unaccounted: string[] = [];
    const wrong: string[] = [];
    for (const [key, raw] of Object.entries(decoded)) {
      if (composite.has(key)) continue;
      const entry = byKey.get(key);
      if (!entry) {
        unaccounted.push(key);
        continue;
      }
      const [wire, want] = entry;
      const got = asComparable(raw);
      if (Array.isArray(want)) {
        // A decoder may keep only the populated prefix (e.g. `count` bytes).
        const ok = Array.isArray(got) && got.length <= want.length && got.every((g, i) => g === want[i]);
        if (!ok) wrong.push(`${key} <- ${wire}`);
      } else if (typeof want === "string") {
        if (got !== want) wrong.push(`${key} <- ${wire}: ${String(got)} != ${want}`);
      } else {
        const scaled = want * (scales[key] ?? 1);
        if (typeof got !== "number" || Math.abs(got - scaled) > Math.abs(scaled) * 1e-9) {
          wrong.push(`${key} <- ${wire}: ${String(got)} != ${scaled}`);
        }
      }
    }
    expect(wrong, "fields read from the wrong offset or type").toEqual([]);
    expect(unaccounted, "decoded keys with no wire field of that name").toEqual([]);
  });
});

// ── Command numbers ─────────────────────────────────────────

type Sent = { command: number; params: number[] };

function capture(firmwareType: FirmwareType = "ardupilot-copter") {
  const sent: Sent[] = [];
  const frames: Uint8Array[] = [];
  const ctx: cmds.CommandContext = {
    transport: {
      isConnected: true,
      send: (data: Uint8Array) => frames.push(data),
    } as unknown as cmds.CommandContext["transport"], // the two members the senders touch
    firmwareHandler: {
      firmwareType,
      encodeFlightMode: () => ({ baseMode: 1, customMode: 4 }),
    } as unknown as cmds.CommandContext["firmwareHandler"],
    commandQueue: new CommandQueue(),
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    homeAltitudeAmsl: null,
    sendCommandLong: (command, params): Promise<CommandResult> => {
      sent.push({ command, params: [...params] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
    sendCommandInt: (command, params): Promise<CommandResult> => {
      sent.push({ command, params: [...params] });
      return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
    },
  };
  /** The command id of the one command the sender issued, ack-tracked or not. */
  const command = (): number => {
    if (sent.length === 1 && frames.length === 0) return sent[0].command;
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame[7] | (frame[8] << 8) | (frame[9] << 16)).toBe(76); // COMMAND_LONG
    return new DataView(frame.buffer, frame.byteOffset + 10, frame[1]).getUint16(28, true);
  };
  return { ctx, command };
}

/** [exported sender, the MAV_CMD it must send, a call]. */
const SENDERS: Array<[string, string, (ctx: cmds.CommandContext) => unknown]> = [
  ["cmdArm", "MAV_CMD_COMPONENT_ARM_DISARM", (c) => cmds.cmdArm(c)],
  ["cmdDisarm", "MAV_CMD_COMPONENT_ARM_DISARM", (c) => cmds.cmdDisarm(c)],
  ["cmdSetFlightMode", "MAV_CMD_DO_SET_MODE", (c) => cmds.cmdSetFlightMode(c, "LOITER")],
  ["cmdReturnToLaunch", "MAV_CMD_NAV_RETURN_TO_LAUNCH", (c) => cmds.cmdReturnToLaunch(c)],
  ["cmdLand", "MAV_CMD_NAV_LAND", (c) => cmds.cmdLand(c)],
  ["cmdLand", "MAV_CMD_NAV_LAND", (c) => cmds.cmdLand(c, { lat: 1, lon: 2 })],
  ["cmdTakeoff", "MAV_CMD_NAV_TAKEOFF", (c) => cmds.cmdTakeoff(c, 10)],
  ["cmdStartCalibration", "MAV_CMD_PREFLIGHT_CALIBRATION", (c) => cmds.cmdStartCalibration(c, "gyro")],
  ["cmdStartCalibration", "MAV_CMD_DO_START_MAG_CAL", (c) => cmds.cmdStartCalibration(c, "compass")],
  ["cmdConfirmAccelCalPos", "MAV_CMD_ACCELCAL_VEHICLE_POS", (c) => cmds.cmdConfirmAccelCalPos(c, 1)],
  ["cmdAcceptCompassCal", "MAV_CMD_DO_ACCEPT_MAG_CAL", (c) => cmds.cmdAcceptCompassCal(c)],
  ["cmdCancelCompassCal", "MAV_CMD_DO_CANCEL_MAG_CAL", (c) => cmds.cmdCancelCompassCal(c)],
  ["cmdCancelCalibration", "MAV_CMD_PREFLIGHT_CALIBRATION", (c) => cmds.cmdCancelCalibration(c)],
  ["cmdStartGnssMagCal", "MAV_CMD_FIXED_MAG_CAL_YAW", (c) => cmds.cmdStartGnssMagCal(c, 90)],
  ["cmdMotorTest", "MAV_CMD_DO_MOTOR_TEST", (c) => cmds.cmdMotorTest(c, 1, 5, 2)],
  ["cmdRebootToBootloader", "MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN", (c) => cmds.cmdRebootToBootloader(c)],
  ["cmdReboot", "MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN", (c) => cmds.cmdReboot(c)],
  ["cmdResetParametersToDefault", "MAV_CMD_PREFLIGHT_STORAGE", (c) => cmds.cmdResetParametersToDefault(c)],
  ["cmdKillSwitch", "MAV_CMD_DO_FLIGHTTERMINATION", (c) => cmds.cmdKillSwitch(c, true)],
  ["cmdGuidedGoto", "MAV_CMD_DO_REPOSITION", (c) => cmds.cmdGuidedGoto(c, 1, 2, 30)],
  ["cmdPauseMission", "MAV_CMD_DO_PAUSE_CONTINUE", (c) => cmds.cmdPauseMission(c)],
  ["cmdResumeMission", "MAV_CMD_DO_PAUSE_CONTINUE", (c) => cmds.cmdResumeMission(c)],
  ["cmdCommitParamsToFlash", "MAV_CMD_PREFLIGHT_STORAGE", (c) => cmds.cmdCommitParamsToFlash(c)],
  ["cmdSetHome", "MAV_CMD_DO_SET_HOME", (c) => cmds.cmdSetHome(c, true)],
  ["cmdChangeSpeed", "MAV_CMD_DO_CHANGE_SPEED", (c) => cmds.cmdChangeSpeed(c, 1, 5)],
  ["cmdSetYaw", "MAV_CMD_CONDITION_YAW", (c) => cmds.cmdSetYaw(c, 90, 10, 1, false)],
  ["cmdSetGeoFenceEnabled", "MAV_CMD_DO_FENCE_ENABLE", (c) => cmds.cmdSetGeoFenceEnabled(c, true)],
  ["cmdEnableFence", "MAV_CMD_DO_FENCE_ENABLE", (c) => cmds.cmdEnableFence(c, true)],
  ["cmdSetServo", "MAV_CMD_DO_SET_SERVO", (c) => cmds.cmdSetServo(c, 9, 1500)],
  ["cmdCameraTrigger", "MAV_CMD_DO_DIGICAM_CONTROL", (c) => cmds.cmdCameraTrigger(c)],
  ["cmdSetGimbalAngle", "MAV_CMD_DO_MOUNT_CONTROL", (c) => cmds.cmdSetGimbalAngle(c, -30, 0, 0)],
  ["cmdSetGimbalMode", "MAV_CMD_DO_MOUNT_CONFIGURE", (c) => cmds.cmdSetGimbalMode(c, 2)],
  ["cmdDoPreArmCheck", "MAV_CMD_RUN_PREARM_CHECKS", (c) => cmds.cmdDoPreArmCheck(c)],
  ["cmdDoLandStart", "MAV_CMD_DO_LAND_START", (c) => cmds.cmdDoLandStart(c)],
  ["cmdControlVideo", "MAV_CMD_DO_CONTROL_VIDEO", (c) => cmds.cmdControlVideo(c, { cameraId: 0, transmission: 1, channel: 0, recording: 0 })],
  ["cmdSetRelay", "MAV_CMD_DO_SET_RELAY", (c) => cmds.cmdSetRelay(c, 0, true)],
  ["cmdStartRxPair", "MAV_CMD_START_RX_PAIR", (c) => cmds.cmdStartRxPair(c, 0)],
  ["cmdRequestMessage", "MAV_CMD_REQUEST_MESSAGE", (c) => cmds.cmdRequestMessage(c, 148)],
  ["cmdSetMessageInterval", "MAV_CMD_SET_MESSAGE_INTERVAL", (c) => cmds.cmdSetMessageInterval(c, 33, 200000)],
  ["cmdSetRoiLocation", "MAV_CMD_DO_SET_ROI_LOCATION", (c) => cmds.cmdSetRoiLocation(c, 1, 2, 3)],
  ["cmdSetRoiNone", "MAV_CMD_DO_SET_ROI_NONE", (c) => cmds.cmdSetRoiNone(c)],
  ["cmdOrbit", "MAV_CMD_DO_ORBIT", (c) => cmds.cmdOrbit(c, 30, 2, 0, 1, 2, 30)],
  ["setCurrentMissionItem", "MAV_CMD_DO_SET_MISSION_CURRENT", (c) => setCurrentMissionItem(c as unknown as MissionContext, 3)],
];

describe("MAV_CMD numbers", () => {
  it.each(SENDERS)("%s sends %s", async (_label, name, send) => {
    expect(MAV_CMD[name], `${name} is not in the MAV_CMD enum`).toBeTypeOf("number");
    const { ctx, command } = capture();
    await send(ctx);
    expect(command()).toBe(MAV_CMD[name]);
  });

  it("covers every exported command sender", () => {
    // Senders of MAVLink messages rather than MAV_CMDs, and the generic one.
    const notCommands = new Set([
      "cmdSendManualControl", "cmdSendSerialData", "cmdSendPositionTarget",
      "cmdSendAttitudeTarget", "cmdSetEkfOrigin", "cmdSendCommand",
    ]);
    const covered = new Set(SENDERS.map(([name]) => name));
    const missing = Object.keys(cmds).filter((k) => k.startsWith("cmd") && !notCommands.has(k) && !covered.has(k));
    expect(missing).toEqual([]);
  });
});

// ── Enum values ─────────────────────────────────────────────

describe("enum values", () => {
  it.each(Object.entries(MAV_RESULT))("MAV_RESULT.%s", (key, value) => {
    expect(value).toBe(ENUMS.MAV_RESULT[`MAV_RESULT_${key}`]);
  });

  it.each(Object.entries(MAV_PARAM_TYPE))("MAV_PARAM_TYPE.%s", (key, value) => {
    expect(value).toBe(ENUMS.MAV_PARAM_TYPE[`MAV_PARAM_TYPE_${key}`]);
  });

  it("MSP GPS fix states map onto GPS_FIX_TYPE", () => {
    const fix = ENUMS.GPS_FIX_TYPE;
    expect(mspGpsFixToMavlink(0, "inav")).toBe(fix.GPS_FIX_TYPE_NO_FIX);
    expect(mspGpsFixToMavlink(1, "inav")).toBe(fix.GPS_FIX_TYPE_2D_FIX);
    expect(mspGpsFixToMavlink(2, "inav")).toBe(fix.GPS_FIX_TYPE_3D_FIX);
    expect(mspGpsFixToMavlink(2, "betaflight")).toBe(fix.GPS_FIX_TYPE_3D_FIX);
  });
});
