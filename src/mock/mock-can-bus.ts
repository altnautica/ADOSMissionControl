/**
 * Synthetic DroneCAN bus for demo mode.
 *
 * Simulates 4 realistic DroneCAN nodes that periodically publish
 * telemetry on CAN bus 0. The frames are fed into the mock protocol
 * via `emitCanFrame` and show up in the CAN Monitor panel with decoded
 * labels (see `src/lib/can/known-ids.ts`).
 *
 * This is NOT a DSDL encoder — it fabricates plausible payload bytes
 * so the monitor has something to display. Real DroneCAN decoding is
 * not required for a viewer.
 *
 * @license GPL-3.0-only
 */

import type { MockProtocol } from "./mock-protocol";

/** DroneCAN priority levels (lower = higher priority). */
const PRIORITY_NORMAL = 20;
const PRIORITY_HIGH = 5;

/**
 * Build a 29-bit DroneCAN message frame ID.
 *
 * Layout (bit 0 = LSB):
 *   0..6   source node ID (7 bits)
 *   7      service_not_message (0 = message)
 *   8..23  data type ID (16 bits)
 *   24..28 priority (5 bits)
 */
function buildMessageFrameId(
  sourceNodeId: number,
  dataTypeId: number,
  priority = PRIORITY_NORMAL,
): number {
  return (
    (sourceNodeId & 0x7f) |
    (0 << 7) |
    ((dataTypeId & 0xffff) << 8) |
    ((priority & 0x1f) << 24)
  );
}

interface CanNode {
  /** DroneCAN node ID (1..127). */
  nodeId: number;
  /** Human-readable name. */
  name: string;
  /** Short category shown in the monitor sidebar. */
  category: "ESC" | "GPS" | "Airspeed" | "Power" | "FC";
  /** Millis between frame bursts for this node. */
  periodMs: number;
  /** Next tick timestamp (millis) when this node should emit. */
  nextEmitMs: number;
  /** Frame builder — returns zero or more frames to emit. */
  buildFrames: (t: number, node: CanNode) => MockCanFrame[];
}

export interface MockCanFrame {
  id: number;
  bus: number;
  len: number;
  data: Uint8Array;
}

/** Fill a buffer with pseudo-random but stable bytes for a given tag. */
function fillBytes(buf: Uint8Array, seed: number): void {
  let x = seed >>> 0;
  for (let i = 0; i < buf.length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    buf[i] = x & 0xff;
  }
}

/** Pack a float32 little-endian into the first 4 bytes. */
function packFloat32LE(buf: Uint8Array, offset: number, value: number): void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setFloat32(offset, value, true);
}

/** Pack a uint16 little-endian. */
function packU16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

// ── Frame builders for each node type ──────────────────────────────

/** ESC node: emits ESC Status + ESC RPM for 4 motors at 50 Hz. */
function buildEscFrames(t: number, node: CanNode): MockCanFrame[] {
  const frames: MockCanFrame[] = [];
  const baseRpm = 8000 + Math.sin(t / 500) * 800;

  for (let motor = 0; motor < 4; motor++) {
    // ESC Status (data type 1030)
    const status = new Uint8Array(8);
    const rpm = Math.round(baseRpm + motor * 40);
    const voltage = 15.8 + Math.random() * 0.3;
    const current = 6 + Math.random() * 2 + motor * 0.3;
    const temp = 42 + Math.random() * 4;
    packU16LE(status, 0, rpm & 0xffff);
    packU16LE(status, 2, Math.round(voltage * 100));
    packU16LE(status, 4, Math.round(current * 100));
    status[6] = Math.round(temp);
    status[7] = motor;
    frames.push({
      id: buildMessageFrameId(node.nodeId, 1030),
      bus: 0,
      len: 8,
      data: status,
    });
  }
  return frames;
}

/** GPS node: emits GNSS Fix2 at 5 Hz. */
function buildGpsFrames(t: number, node: CanNode): MockCanFrame[] {
  const buf = new Uint8Array(8);
  // Lat: 12.9716 (Bangalore), jitter ~2m
  const lat = 12.9716 + (Math.sin(t / 2000) * 2e-5);
  const lon = 77.5946 + (Math.cos(t / 2000) * 2e-5);
  packFloat32LE(buf, 0, lat);
  packFloat32LE(buf, 4, lon);
  return [
    {
      id: buildMessageFrameId(node.nodeId, 1061),
      bus: 0,
      len: 8,
      data: buf,
    },
  ];
}

/** Airspeed node: emits airspeed + static pressure at 10 Hz. */
function buildAirspeedFrames(t: number, node: CanNode): MockCanFrame[] {
  const airspeedBuf = new Uint8Array(8);
  const pressureBuf = new Uint8Array(8);
  const airspeed = 14 + Math.sin(t / 800) * 2;
  const pressure = 96500 + Math.random() * 50;
  packFloat32LE(airspeedBuf, 0, airspeed);
  packFloat32LE(airspeedBuf, 4, 0.5); // variance
  packFloat32LE(pressureBuf, 0, pressure);
  packFloat32LE(pressureBuf, 4, 25); // temp
  return [
    { id: buildMessageFrameId(node.nodeId, 1027), bus: 0, len: 8, data: airspeedBuf },
    { id: buildMessageFrameId(node.nodeId, 1028), bus: 0, len: 8, data: pressureBuf },
  ];
}

/** Power node: emits battery info at 5 Hz. */
function buildPowerFrames(t: number, node: CanNode): MockCanFrame[] {
  const buf = new Uint8Array(8);
  const voltage = 22.2 - (t % 300000) * 0.000008;
  const current = 24 + Math.random() * 4;
  packFloat32LE(buf, 0, voltage);
  packFloat32LE(buf, 4, current);
  return [
    {
      id: buildMessageFrameId(node.nodeId, 1092),
      bus: 0,
      len: 8,
      data: buf,
    },
  ];
}

/** Flight controller: emits NodeStatus heartbeat at 1 Hz per node. */
function buildNodeStatus(t: number, node: CanNode): MockCanFrame[] {
  const buf = new Uint8Array(7);
  const uptime = Math.floor(t / 1000);
  buf[0] = uptime & 0xff;
  buf[1] = (uptime >>> 8) & 0xff;
  buf[2] = (uptime >>> 16) & 0xff;
  buf[3] = (uptime >>> 24) & 0xff;
  buf[4] = 0; // health OK
  buf[5] = 2; // mode OPERATIONAL
  buf[6] = 0; // sub-mode
  return [
    {
      id: buildMessageFrameId(node.nodeId, 341, PRIORITY_HIGH),
      bus: 0,
      len: 7,
      data: buf,
    },
  ];
}

// ── Node registry ─────────────────────────────────────────────────

export interface CanNodeSummary {
  nodeId: number;
  name: string;
  category: CanNode["category"];
  framesPerSecond: number;
  lastSeen: number;
}

export class MockCanBus {
  private nodes: CanNode[] = [];
  private frameCountWindow = new Map<number, number>();
  private windowStartMs = 0;
  private nodeFps = new Map<number, number>();
  private lastSeen = new Map<number, number>();

  constructor() {
    this.nodes = [
      {
        nodeId: 10,
        name: "ESC Controller",
        category: "ESC",
        periodMs: 20, // 50 Hz
        nextEmitMs: 0,
        buildFrames: buildEscFrames,
      },
      {
        nodeId: 11,
        name: "Here3 GPS",
        category: "GPS",
        periodMs: 200, // 5 Hz
        nextEmitMs: 0,
        buildFrames: buildGpsFrames,
      },
      {
        nodeId: 12,
        name: "Airspeed Sensor",
        category: "Airspeed",
        periodMs: 100, // 10 Hz
        nextEmitMs: 0,
        buildFrames: buildAirspeedFrames,
      },
      {
        nodeId: 13,
        name: "Power Monitor",
        category: "Power",
        periodMs: 200, // 5 Hz
        nextEmitMs: 0,
        buildFrames: buildPowerFrames,
      },
    ];
  }

  /** Run one tick of the simulator and emit frames via the given protocol. */
  tick(protocol: MockProtocol, now: number): void {
    // NodeStatus heartbeat every 1 s per node.
    for (const node of this.nodes) {
      if (now % 1000 < 50) {
        for (const f of buildNodeStatus(now, node)) {
          this.emit(protocol, f, now);
        }
      }
      if (now >= node.nextEmitMs) {
        for (const f of node.buildFrames(now, node)) {
          this.emit(protocol, f, now);
        }
        node.nextEmitMs = now + node.periodMs;
      }
    }

    // FPS rolling window (1s).
    if (now - this.windowStartMs >= 1000) {
      this.nodeFps = new Map(this.frameCountWindow);
      this.frameCountWindow.clear();
      this.windowStartMs = now;
    }
  }

  private emit(protocol: MockProtocol, frame: MockCanFrame, now: number): void {
    protocol.emitCanFrame({
      timestamp: now,
      bus: frame.bus,
      len: frame.len,
      targetSystem: 1,
      targetComponent: 1,
      id: frame.id,
      data: frame.data,
    });
    // Attribute the frame to its source node for per-node FPS.
    const sourceNodeId = frame.id & 0x7f;
    this.frameCountWindow.set(
      sourceNodeId,
      (this.frameCountWindow.get(sourceNodeId) ?? 0) + 1,
    );
    this.lastSeen.set(sourceNodeId, now);
  }

  /** Snapshot of the simulated nodes + their live frame rates. */
  getNodeSummaries(): CanNodeSummary[] {
    return this.nodes.map((n) => ({
      nodeId: n.nodeId,
      name: n.name,
      category: n.category,
      framesPerSecond: this.nodeFps.get(n.nodeId) ?? 0,
      lastSeen: this.lastSeen.get(n.nodeId) ?? 0,
    }));
  }

  /** Reset to initial state (used on engine stop). */
  reset(): void {
    this.frameCountWindow.clear();
    this.nodeFps.clear();
    this.lastSeen.clear();
    this.windowStartMs = 0;
    for (const n of this.nodes) n.nextEmitMs = 0;
    // Silence unused-import complaints in narrow builds.
    void fillBytes;
  }
}

/** Singleton for easy access from CanMonitorPanel sidebar. */
export const mockCanBus = new MockCanBus();
