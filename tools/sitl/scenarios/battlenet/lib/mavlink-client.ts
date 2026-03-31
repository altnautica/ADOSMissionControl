// mavlink-client.ts — Shared MAVLink v2 WebSocket client for test scenarios
// SPDX-License-Identifier: GPL-3.0-only

import WebSocket from 'ws';

// CRC X.25
function crc16(data: Buffer): number {
  let crc = 0xFFFF;
  for (const byte of data) {
    let tmp = byte ^ (crc & 0xFF);
    tmp ^= (tmp << 4) & 0xFF;
    crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
    crc &= 0xFFFF;
  }
  return crc;
}

// MAVLink message IDs and CRC extras
const MSG = {
  HEARTBEAT: { id: 0, crc: 50 },
  SET_MODE: { id: 11, crc: 89 },
  PARAM_SET: { id: 23, crc: 168 },
  GLOBAL_POSITION_INT: { id: 33, crc: 104 },
  COMMAND_LONG: { id: 76, crc: 152 },
  SET_POSITION_TARGET_GLOBAL_INT: { id: 86, crc: 5 },
} as const;

export interface DronePosition {
  sysId: number;
  lat: number;
  lon: number;
  alt: number;  // mm
  relativeAlt: number;  // mm
  vx: number;
  vy: number;
  vz: number;
  hdg: number;
}

export interface DroneHeartbeat {
  sysId: number;
  mode: number;
  armed: boolean;
  type: number;
}

export class MavlinkClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private positions = new Map<number, DronePosition>();
  private heartbeats = new Map<number, DroneHeartbeat>();
  private onPositionCallbacks: ((pos: DronePosition) => void)[] = [];
  private onHeartbeatCallbacks: ((hb: DroneHeartbeat) => void)[] = [];

  constructor(private readonly url: string = 'ws://localhost:5760') {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'nodebuffer';
      this.ws.on('open', () => {
        console.log(`Connected to ${this.url}`);
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (data: Buffer) => this.parseIncoming(data));
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  onPosition(cb: (pos: DronePosition) => void): void {
    this.onPositionCallbacks.push(cb);
  }

  onHeartbeat(cb: (hb: DroneHeartbeat) => void): void {
    this.onHeartbeatCallbacks.push(cb);
  }

  getPosition(sysId: number): DronePosition | undefined {
    return this.positions.get(sysId);
  }

  getHeartbeat(sysId: number): DroneHeartbeat | undefined {
    return this.heartbeats.get(sysId);
  }

  /** Wait until we have position data from N drones */
  async waitForDrones(count: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.positions.size < count) {
      if (Date.now() > deadline) {
        throw new Error(`Only ${this.positions.size}/${count} drones detected after ${timeoutMs}ms`);
      }
      await sleep(500);
    }
    console.log(`All ${count} drones detected`);
  }

  // --- Command senders ---

  async arm(sysId: number): Promise<void> {
    this.sendCommandLong(sysId, 400, 1, 0, 0, 0, 0, 0, 0); // MAV_CMD_COMPONENT_ARM_DISARM
    console.log(`[${sysId}] Arm command sent`);
  }

  async disarm(sysId: number): Promise<void> {
    this.sendCommandLong(sysId, 400, 0, 0, 0, 0, 0, 0, 0);
    console.log(`[${sysId}] Disarm command sent`);
  }

  async setMode(sysId: number, mode: number): Promise<void> {
    const payload = Buffer.alloc(6);
    payload.writeUInt32LE(mode, 0);
    payload.writeUInt8(sysId, 4);
    payload.writeUInt8(209, 5); // base_mode
    this.sendFrame(MSG.SET_MODE.id, MSG.SET_MODE.crc, payload);
    console.log(`[${sysId}] Set mode ${mode}`);
  }

  async takeoff(sysId: number, altitude: number): Promise<void> {
    this.sendCommandLong(sysId, 22, 0, 0, 0, 0, 0, 0, altitude); // MAV_CMD_NAV_TAKEOFF
    console.log(`[${sysId}] Takeoff to ${altitude}m`);
  }

  async flyTo(sysId: number, lat: number, lon: number, alt: number): Promise<void> {
    const payload = Buffer.alloc(53);
    payload.writeUInt32LE(0, 0); // time_boot_ms
    payload.writeInt32LE(Math.round(lat * 1e7), 4);
    payload.writeInt32LE(Math.round(lon * 1e7), 8);
    payload.writeFloatLE(alt, 12);
    // vx, vy, vz, afx, afy, afz = 0 (already zeroed)
    payload.writeFloatLE(0, 40); // yaw
    payload.writeFloatLE(0, 44); // yaw_rate
    payload.writeUInt16LE(0x0FF8, 48); // type_mask: position only
    payload.writeUInt8(sysId, 50);
    payload.writeUInt8(0, 51); // target_component
    payload.writeUInt8(6, 52); // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
    this.sendFrame(MSG.SET_POSITION_TARGET_GLOBAL_INT.id, MSG.SET_POSITION_TARGET_GLOBAL_INT.crc, payload);
  }

  async setParam(sysId: number, paramName: string, value: number): Promise<void> {
    const payload = Buffer.alloc(23);
    payload.writeFloatLE(value, 0);
    payload.writeUInt8(sysId, 4);
    payload.writeUInt8(0, 5);
    const nameBytes = Buffer.from(paramName.padEnd(16, '\0').slice(0, 16), 'ascii');
    nameBytes.copy(payload, 6);
    payload.writeUInt8(9, 22); // MAV_PARAM_TYPE_REAL32
    this.sendFrame(MSG.PARAM_SET.id, MSG.PARAM_SET.crc, payload);
    console.log(`[${sysId}] Set ${paramName}=${value}`);
  }

  // --- Helpers ---

  /** Arm, set GUIDED mode, and takeoff all drones */
  async armAndTakeoffAll(sysIds: number[], altitude: number): Promise<void> {
    for (const id of sysIds) {
      await this.setMode(id, 4); // GUIDED
      await sleep(500);
      await this.arm(id);
      await sleep(500);
      await this.takeoff(id, altitude);
      await sleep(1000);
    }
    // Wait for all drones to reach altitude
    console.log(`Waiting for ${sysIds.length} drones to reach ${altitude}m...`);
    await this.waitForAltitude(sysIds, altitude * 0.8, 60_000);
  }

  async waitForAltitude(sysIds: number[], minAlt: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const allAbove = sysIds.every((id) => {
        const pos = this.positions.get(id);
        return pos && pos.relativeAlt / 1000 >= minAlt;
      });
      if (allAbove) {
        console.log(`All drones above ${minAlt}m`);
        return;
      }
      await sleep(1000);
    }
    throw new Error(`Not all drones reached ${minAlt}m altitude`);
  }

  // --- Internal ---

  private sendCommandLong(
    targetSys: number, command: number,
    p1: number, p2: number, p3: number, p4: number, p5: number, p6: number, p7: number,
  ): void {
    const payload = Buffer.alloc(33);
    payload.writeFloatLE(p1, 0);
    payload.writeFloatLE(p2, 4);
    payload.writeFloatLE(p3, 8);
    payload.writeFloatLE(p4, 12);
    payload.writeFloatLE(p5, 16);
    payload.writeFloatLE(p6, 20);
    payload.writeFloatLE(p7, 24);
    payload.writeUInt16LE(command, 28);
    payload.writeUInt8(targetSys, 30);
    payload.writeUInt8(0, 31); // target_component
    payload.writeUInt8(0, 32); // confirmation
    this.sendFrame(MSG.COMMAND_LONG.id, MSG.COMMAND_LONG.crc, payload);
  }

  private sendFrame(msgId: number, crcExtra: number, payload: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const header = Buffer.alloc(10);
    header[0] = 0xFD; // MAVLink v2
    header[1] = payload.length;
    header[2] = 0; // incompat_flags
    header[3] = 0; // compat_flags
    header[4] = this.seq++ & 0xFF;
    header[5] = 255; // system_id (GCS)
    header[6] = 0;   // component_id
    header[7] = msgId & 0xFF;
    header[8] = (msgId >> 8) & 0xFF;
    header[9] = (msgId >> 16) & 0xFF;

    // CRC over header[1..9] + payload + crcExtra
    const crcData = Buffer.concat([header.subarray(1), payload, Buffer.from([crcExtra])]);
    const crc = crc16(crcData);
    const crcBuf = Buffer.alloc(2);
    crcBuf.writeUInt16LE(crc, 0);

    const frame = Buffer.concat([header, payload, crcBuf]);
    this.ws.send(frame);
  }

  private parseIncoming(data: Buffer): void {
    let offset = 0;
    while (offset < data.length) {
      // Find MAVLink v2 start
      if (data[offset] !== 0xFD) {
        offset++;
        continue;
      }
      if (offset + 12 > data.length) break;

      const payloadLen = data[offset + 1];
      const frameLen = 12 + payloadLen; // 10 header + payload + 2 CRC
      if (offset + frameLen > data.length) break;

      const msgId = data[offset + 7] | (data[offset + 8] << 8) | (data[offset + 9] << 16);
      const sysId = data[offset + 5];
      const payload = data.subarray(offset + 10, offset + 10 + payloadLen);

      if (msgId === MSG.GLOBAL_POSITION_INT.id && payloadLen >= 28) {
        const pos: DronePosition = {
          sysId,
          lat: payload.readInt32LE(4) / 1e7,
          lon: payload.readInt32LE(8) / 1e7,
          alt: payload.readInt32LE(12),
          relativeAlt: payload.readInt32LE(16),
          vx: payload.readInt16LE(20),
          vy: payload.readInt16LE(22),
          vz: payload.readInt16LE(24),
          hdg: payload.readUInt16LE(26),
        };
        this.positions.set(sysId, pos);
        for (const cb of this.onPositionCallbacks) cb(pos);
      }

      if (msgId === MSG.HEARTBEAT.id && payloadLen >= 9) {
        const hb: DroneHeartbeat = {
          sysId,
          type: payload[4],
          mode: payload.readUInt32LE(0),
          armed: (payload[6] & 0x80) !== 0,
        };
        this.heartbeats.set(sysId, hb);
        for (const cb of this.onHeartbeatCallbacks) cb(hb);
      }

      offset += frameLen;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Haversine distance between two lat/lon points in meters
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Offset a lat/lon by meters (north, east)
export function offsetPosition(lat: number, lon: number, northM: number, eastM: number): { lat: number; lon: number } {
  const dLat = northM / 111320;
  const dLon = eastM / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}
