/**
 * @module connection-meta
 * @description How a directly connected FC link was dialled, and which vehicle
 * it answered as, so a dropped link can be re-dialled to the same aircraft.
 * @license GPL-3.0-only
 */

import type { FirmwareType } from "@/lib/protocol/types";

export interface ConnectionMeta {
  type: "serial" | "websocket" | "mqtt-mavlink" | "udp-proxy" | "tcp" | "ble";
  baudRate?: number;
  url?: string;
  portVendorId?: number;
  portProductId?: number;
  /** Bluetooth only: the advertised device name. A BLE link is not re-dialled
   * automatically (the browser needs an operator gesture to pick a device). */
  bleDeviceName?: string;
  // UDP/TCP direct-link fields (type "udp-proxy" | "tcp")
  proto?: "udp" | "tcp";
  host?: string;
  port?: number;
  /** UDP only: "listen" (bind + learn peer) or "target" (send to a fixed host). */
  mode?: "listen" | "target";
  /** Browser-path bridge WebSocket URL; absent for the native desktop path. */
  bridgeUrl?: string;
  /**
   * FC protocol family detected on this transport at connect time
   * ("betaflight" | "inav" drive the MSP adapter; ArduPilot / PX4 /
   * unknown drive MAVLink). Persisted so a reconnect re-selects the same
   * adapter instead of always assuming MAVLink.
   */
  firmwareType?: FirmwareType;
  /**
   * The vehicle this link answered as when it was first connected, stamped by
   * the drone manager. A reconnect that hears a different vehicle on the
   * re-dialled link refuses it rather than re-attaching it under this drone's
   * id, where commands meant for one aircraft would reach another.
   */
  vehicle?: ConnectedVehicleIdentity;
}

/** The identity fields a link's handshake reports for its vehicle. */
export interface ConnectedVehicleIdentity {
  systemId: number;
  firmwareType: FirmwareType;
  vehicleType: number;
  boardId?: number;
}
