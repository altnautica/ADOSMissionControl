import type { MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import { MSG_NAMES } from "@/lib/protocol/mavlink-adapter-frame-handlers";
import { decodeHeartbeat, decodeSysStatus } from "@/lib/protocol/messages/core";
import { decodeAttitude, decodeGpsRawInt, decodeGlobalPositionInt } from "@/lib/protocol/messages/telemetry";

export interface DecodedField {
  name: string;
  value: string;
}

const deg = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}°`;
const degE7 = (v: number): string => `${(v / 1e7).toFixed(7)}°`;
const mm = (v: number): string => `${(v / 1000).toFixed(1)}m`;

/** Field view of the messages the inspector knows, using the link's own wire decoders. */
export function decodePayload(msgId: number, payload: DataView): DecodedField[] | null {
  switch (msgId) {
    case 0: {
      const m = decodeHeartbeat(payload);
      return [
        { name: "type", value: String(m.type) },
        { name: "autopilot", value: String(m.autopilot) },
        { name: "base_mode", value: `0x${m.baseMode.toString(16).padStart(2, "0")}` },
        { name: "custom_mode", value: String(m.customMode) },
        { name: "system_status", value: String(m.systemStatus) },
        { name: "mavlink_version", value: String(m.mavlinkVersion) },
      ];
    }
    case 1: {
      const m = decodeSysStatus(payload);
      return [
        { name: "load", value: `${(m.load / 10).toFixed(1)}%` },
        { name: "voltage", value: `${(m.voltageBattery / 1000).toFixed(2)}V` },
        { name: "current", value: m.currentBattery === -1 ? "not measured" : `${(m.currentBattery / 100).toFixed(1)}A` },
        { name: "battery_remaining", value: m.batteryRemaining === -1 ? "not measured" : `${m.batteryRemaining}%` },
        { name: "drop_rate_comm", value: `${(m.dropRateComm / 100).toFixed(2)}%` },
        { name: "errors_comm", value: String(m.errorsComm) },
      ];
    }
    case 24: {
      const m = decodeGpsRawInt(payload);
      return [
        { name: "fix_type", value: String(m.fixType) },
        { name: "lat", value: degE7(m.lat) },
        { name: "lon", value: degE7(m.lon) },
        { name: "alt", value: mm(m.alt) },
        { name: "satellites", value: m.satellitesVisible === 255 ? "unknown" : String(m.satellitesVisible) },
      ];
    }
    case 30: {
      const m = decodeAttitude(payload);
      return [
        { name: "roll", value: deg(m.roll) },
        { name: "pitch", value: deg(m.pitch) },
        { name: "yaw", value: deg(m.yaw) },
      ];
    }
    case 33: {
      const m = decodeGlobalPositionInt(payload);
      return [
        { name: "lat", value: degE7(m.lat) },
        { name: "lon", value: degE7(m.lon) },
        { name: "alt", value: mm(m.alt) },
        { name: "relative_alt", value: mm(m.relativeAlt) },
      ];
    }
    default:
      return null;
  }
}

export interface InspectorMessage {
  id: number;
  msgId: number;
  msgName: string;
  frame: MAVLinkFrame;
}

export function messageName(msgId: number): string {
  return MSG_NAMES[msgId] ?? `MSG_${msgId}`;
}

export function payloadHex(payload: DataView): string {
  const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

export interface MsgRate {
  /** Frames received since the last tick. */
  count: number;
  /** Rate measured over the last tick window; 0 once the message stops. */
  hz: number;
}

/**
 * Close one rate window: each message's rate becomes the frames it received
 * in the window, so a message that stops arriving reads 0 Hz on the next tick
 * instead of keeping its last rate.
 */
export function tickRates(rates: Map<number, MsgRate>, elapsedS: number): void {
  for (const rate of rates.values()) {
    rate.hz = elapsedS > 0 ? Math.round(rate.count / elapsedS) : 0;
    rate.count = 0;
  }
}
