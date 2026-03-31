// inject-commands.ts — MAVLink v2 command injection for SITL testing
// SPDX-License-Identifier: GPL-3.0-only

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// MAVLink v2 constants
// ---------------------------------------------------------------------------

const MAVLINK_V2_MAGIC = 0xfd;
const GCS_SYSTEM_ID = 255;
const GCS_COMPONENT_ID = 0;

// CRC_EXTRA per message type (from MAVLink XML definitions)
const CRC_EXTRA: Record<number, number> = {
  11: 89,   // SET_MODE
  23: 168,  // PARAM_SET
  76: 152,  // COMMAND_LONG
  86: 5,    // SET_POSITION_TARGET_GLOBAL_INT
};

// ArduCopter flight mode numbers
const ARDUPILOT_MODES: Record<string, number> = {
  STABILIZE: 0,
  ALT_HOLD: 2,
  AUTO: 3,
  GUIDED: 4,
  LOITER: 5,
  RTL: 6,
  LAND: 9,
};

let sequence = 0;

// ---------------------------------------------------------------------------
// CRC-16/MCRF4XX (X.25) used by MAVLink
// ---------------------------------------------------------------------------

function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    let tmp = byte ^ (crc & 0xff);
    tmp ^= (tmp << 4) & 0xff;
    crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
    crc &= 0xffff;
  }
  return crc;
}

// ---------------------------------------------------------------------------
// MAVLink v2 frame builder
// ---------------------------------------------------------------------------

function buildFrame(msgId: number, payload: Buffer): Buffer {
  const headerLen = 10; // magic(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3)
  const header = Buffer.alloc(headerLen);

  header[0] = MAVLINK_V2_MAGIC;
  header[1] = payload.length;
  header[2] = 0; // incompat_flags
  header[3] = 0; // compat_flags
  header[4] = sequence & 0xff;
  sequence = (sequence + 1) & 0xff;
  header[5] = GCS_SYSTEM_ID;
  header[6] = GCS_COMPONENT_ID;
  // message_id: 3 bytes little-endian
  header[7] = msgId & 0xff;
  header[8] = (msgId >> 8) & 0xff;
  header[9] = (msgId >> 16) & 0xff;

  // CRC over bytes 1..end of payload, then accumulate CRC_EXTRA
  const crcData = Buffer.concat([header.subarray(1), payload]);
  let crc = crc16(crcData);

  const extra = CRC_EXTRA[msgId];
  if (extra === undefined) {
    throw new Error(`No CRC_EXTRA defined for message ID ${msgId}`);
  }

  // Accumulate CRC_EXTRA byte into the CRC
  let tmp = extra ^ (crc & 0xff);
  tmp ^= (tmp << 4) & 0xff;
  crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
  crc &= 0xffff;

  const crcBuf = Buffer.alloc(2);
  crcBuf.writeUInt16LE(crc, 0);

  return Buffer.concat([header, payload, crcBuf]);
}

// ---------------------------------------------------------------------------
// Message encoders
// ---------------------------------------------------------------------------

function encodeCommandLong(
  targetSystem: number,
  command: number,
  params: [number, number, number, number, number, number, number],
): Buffer {
  // Payload: 7x f32 + u16 command + u8 target_system + u8 target_component + u8 confirmation = 33 bytes
  const payload = Buffer.alloc(33);
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  for (let i = 0; i < 7; i++) {
    dv.setFloat32(i * 4, params[i], true);
  }
  dv.setUint16(28, command, true);     // command
  payload[30] = targetSystem;           // target_system
  payload[31] = 0;                      // target_component (autopilot)
  payload[32] = 0;                      // confirmation

  return buildFrame(76, payload);
}

function encodeSetMode(targetSystem: number, customMode: number): Buffer {
  // Payload: u32 custom_mode + u8 target_system + u8 base_mode = 6 bytes
  const payload = Buffer.alloc(6);
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  dv.setUint32(0, customMode, true);
  payload[4] = targetSystem;
  payload[5] = 209; // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | SAFETY_ARMED | MANUAL_INPUT_ENABLED | GUIDED_ENABLED

  return buildFrame(11, payload);
}

function encodeSetPositionTargetGlobalInt(
  targetSystem: number,
  lat: number,
  lon: number,
  alt: number,
): Buffer {
  // Payload: u32 time_boot_ms + i32 lat + i32 lon + f32 alt + 6x f32 (vx,vy,vz,afx,afy,afz)
  //          + f32 yaw + f32 yaw_rate + u16 type_mask + u8 target_system + u8 target_component + u8 coordinate_frame
  //        = 4 + 4 + 4 + 4 + 24 + 4 + 4 + 2 + 1 + 1 + 1 = 53 bytes
  const payload = Buffer.alloc(53);
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  dv.setUint32(0, 0, true);                        // time_boot_ms
  dv.setInt32(4, Math.round(lat * 1e7), true);      // lat_int
  dv.setInt32(8, Math.round(lon * 1e7), true);      // lon_int
  dv.setFloat32(12, alt, true);                     // alt
  // vx, vy, vz, afx, afy, afz = 0 (bytes 16-39)
  // yaw = 0 (bytes 40-43)
  // yaw_rate = 0 (bytes 44-47)
  dv.setUint16(48, 0x0ff8, true);                  // type_mask: position only
  payload[50] = targetSystem;                        // target_system
  payload[51] = 0;                                   // target_component
  payload[52] = 6;                                   // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT

  return buildFrame(86, payload);
}

function encodeParamSet(targetSystem: number, paramId: string, value: number): Buffer {
  // Payload: f32 param_value + u8 target_system + u8 target_component + char[16] param_id + u8 param_type = 23 bytes
  const payload = Buffer.alloc(23);
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  dv.setFloat32(0, value, true);      // param_value
  payload[4] = targetSystem;           // target_system
  payload[5] = 0;                      // target_component

  // param_id: 16 bytes, null-padded
  const nameBytes = Buffer.from(paramId, 'ascii');
  nameBytes.copy(payload, 6, 0, Math.min(nameBytes.length, 16));

  payload[22] = 9;                     // MAV_PARAM_TYPE_REAL32

  return buildFrame(23, payload);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

type CommandHandler = (args: string[], targetSystem: number) => Buffer[];

const commands: Record<string, CommandHandler> = {
  arm(_args, targetSystem) {
    console.log(`Arming vehicle (system ${targetSystem})`);
    return [encodeCommandLong(targetSystem, 400, [1, 0, 0, 0, 0, 0, 0])];
  },

  disarm(_args, targetSystem) {
    console.log(`Disarming vehicle (system ${targetSystem})`);
    return [encodeCommandLong(targetSystem, 400, [0, 0, 0, 0, 0, 0, 0])];
  },

  takeoff(args, targetSystem) {
    const alt = parseFloat(args[0]);
    if (isNaN(alt) || alt <= 0) {
      throw new Error('takeoff requires a positive altitude in meters. Usage: takeoff <alt>');
    }
    console.log(`Takeoff to ${alt}m (system ${targetSystem})`);
    return [encodeCommandLong(targetSystem, 22, [0, 0, 0, 0, 0, 0, alt])];
  },

  'set-mode'(args, targetSystem) {
    const modeName = args[0]?.toUpperCase();
    if (!modeName || !(modeName in ARDUPILOT_MODES)) {
      const valid = Object.keys(ARDUPILOT_MODES).join(', ');
      throw new Error(`Unknown mode "${args[0]}". Valid modes: ${valid}`);
    }
    const modeNum = ARDUPILOT_MODES[modeName];
    console.log(`Setting mode to ${modeName} (${modeNum}) on system ${targetSystem}`);
    return [encodeSetMode(targetSystem, modeNum)];
  },

  'fly-to'(args, targetSystem) {
    const lat = parseFloat(args[0]);
    const lon = parseFloat(args[1]);
    const alt = parseFloat(args[2]);
    if (isNaN(lat) || isNaN(lon) || isNaN(alt)) {
      throw new Error('fly-to requires lat, lon, alt. Usage: fly-to <lat> <lon> <alt>');
    }
    console.log(`Flying to ${lat}, ${lon} at ${alt}m (system ${targetSystem})`);
    return [encodeSetPositionTargetGlobalInt(targetSystem, lat, lon, alt)];
  },

  'inject-gps-failure'(_args, targetSystem) {
    console.log(`Injecting GPS failure on system ${targetSystem}`);
    return [encodeParamSet(targetSystem, 'SIM_GPS_DISABLE', 1)];
  },

  'restore-gps'(_args, targetSystem) {
    console.log(`Restoring GPS on system ${targetSystem}`);
    return [encodeParamSet(targetSystem, 'SIM_GPS_DISABLE', 0)];
  },

  'inject-battery-low'(_args, targetSystem) {
    console.log(`Injecting low battery (10.5V) on system ${targetSystem}`);
    return [encodeParamSet(targetSystem, 'SIM_BATT_VOLTAGE', 10.5)];
  },

  'inject-motor-fail'(args, targetSystem) {
    const motorNum = parseInt(args[0], 10);
    if (isNaN(motorNum) || motorNum < 1) {
      throw new Error('inject-motor-fail requires a motor number (1-based). Usage: inject-motor-fail <motor_num>');
    }
    console.log(`Injecting motor ${motorNum} failure on system ${targetSystem}`);
    return [
      encodeParamSet(targetSystem, 'SIM_ENGINE_FAIL', motorNum),
      encodeParamSet(targetSystem, 'SIM_ENGINE_MUL', 0.0),
    ];
  },

  'restore-motor'(_args, targetSystem) {
    console.log(`Restoring motor on system ${targetSystem}`);
    return [
      encodeParamSet(targetSystem, 'SIM_ENGINE_FAIL', 0),
      encodeParamSet(targetSystem, 'SIM_ENGINE_MUL', 1.0),
    ];
  },
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  port: number;
  sysid: number;
  command: string;
  commandArgs: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2); // skip node + script path
  let port = 5760;
  let sysid = 1;
  const commandArgs: string[] = [];
  let command = '';

  let i = 0;
  while (i < args.length) {
    if (args[i] === '--port') {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) throw new Error('--port requires a number');
    } else if (args[i] === '--sysid') {
      sysid = parseInt(args[++i], 10);
      if (isNaN(sysid)) throw new Error('--sysid requires a number');
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    } else if (!command) {
      command = args[i];
    } else {
      commandArgs.push(args[i]);
    }
    i++;
  }

  if (!command) {
    printUsage();
    process.exit(1);
  }

  return { port, sysid, command, commandArgs };
}

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/inject-commands.ts [options] <command> [args]

Options:
  --port <num>    WebSocket port (default: 5760)
  --sysid <num>   Target system ID (default: 1)
  -h, --help      Show this help

Commands:
  arm                           Arm the vehicle
  disarm                        Disarm the vehicle
  takeoff <alt>                 Takeoff to altitude (meters)
  set-mode <mode>               Set flight mode (STABILIZE, ALT_HOLD, LOITER, GUIDED, AUTO, RTL, LAND)
  fly-to <lat> <lon> <alt>      Fly to position in GUIDED mode (decimal degrees, meters)
  inject-gps-failure            Simulate GPS loss (SIM_GPS_DISABLE=1)
  restore-gps                   Restore GPS (SIM_GPS_DISABLE=0)
  inject-battery-low            Simulate low battery (SIM_BATT_VOLTAGE=10.5)
  inject-motor-fail <motor>     Simulate motor failure (1-based motor number)
  restore-motor                 Restore motor to normal

Examples:
  npx tsx scripts/inject-commands.ts arm
  npx tsx scripts/inject-commands.ts takeoff 10
  npx tsx scripts/inject-commands.ts set-mode GUIDED
  npx tsx scripts/inject-commands.ts fly-to 12.9720 77.5950 50
  npx tsx scripts/inject-commands.ts --port 5770 --sysid 2 arm
`.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const handler = commands[opts.command];

  if (!handler) {
    const valid = Object.keys(commands).join(', ');
    console.error(`Unknown command: "${opts.command}". Valid commands: ${valid}`);
    process.exit(1);
  }

  let frames: Buffer[];
  try {
    frames = handler(opts.commandArgs, opts.sysid);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const url = `ws://localhost:${opts.port}`;
  console.log(`Connecting to ${url}...`);

  const ws = new WebSocket(url);

  const connected = new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', (err) => {
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });
  });

  try {
    await connected;
  } catch (err) {
    console.error((err as Error).message);
    console.error('Is the SITL bridge running? Start it with: npm start');
    process.exit(1);
  }

  console.log('Connected.');

  // Log any incoming messages (responses, ACKs)
  let responseCount = 0;
  ws.on('message', (data: WebSocket.RawData) => {
    const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
    if (buf.length >= 10 && buf[0] === MAVLINK_V2_MAGIC) {
      const msgId = buf[7] | (buf[8] << 8) | (buf[9] << 16);
      responseCount++;
      console.log(`  <- Received message ID ${msgId} (${buf.length} bytes)`);

      // Decode COMMAND_ACK (msg 77) for feedback
      if (msgId === 77 && buf.length >= 12 + 3) {
        const payloadStart = 10;
        const ackCmd = buf.readUInt16LE(payloadStart);
        const result = buf[payloadStart + 2];
        const resultNames: Record<number, string> = {
          0: 'ACCEPTED',
          1: 'TEMPORARILY_REJECTED',
          2: 'DENIED',
          3: 'UNSUPPORTED',
          4: 'FAILED',
          5: 'IN_PROGRESS',
        };
        console.log(`  <- COMMAND_ACK: cmd=${ackCmd} result=${resultNames[result] ?? result}`);
      }
    }
  });

  // Send all frames
  for (const frame of frames) {
    ws.send(frame);
    console.log(`  -> Sent ${frame.length} bytes (msg_id=${frame[7] | (frame[8] << 8) | (frame[9] << 16)})`);
  }

  // Wait 2 seconds for responses, then disconnect
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (responseCount === 0) {
    console.log('No response received (this may be normal for PARAM_SET commands).');
  }

  ws.close();
  console.log('Done.');
}

main();
