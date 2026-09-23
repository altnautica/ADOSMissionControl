/**
 * @module recent-connections
 * @description IndexedDB utilities for recent connection history (idb-keyval).
 * @license GPL-3.0-only
 */

import { get, set, del } from "idb-keyval";
import type { FirmwareType } from "@/lib/protocol/types";

export interface RecentConnection {
  type: "serial" | "websocket" | "udp-proxy" | "tcp" | "ble";
  baudRate?: number;
  /** USB identity of the serial port, so a reconnect reopens the same device
   * rather than whichever permitted port is listed first. */
  portVendorId?: number;
  portProductId?: number;
  url?: string;
  // UDP/TCP direct-link fields
  proto?: "udp" | "tcp";
  host?: string;
  port?: number;
  mode?: "listen" | "target";
  bridgeUrl?: string;
  /** Bluetooth only: the advertised device name, for the label. */
  bleDeviceName?: string;
  // FC protocol family detected at connect time, so a reconnect re-selects
  // the MSP adapter for a Betaflight/iNav FC instead of assuming MAVLink.
  firmwareType?: FirmwareType;
  name: string;
  date: number;
}

const RECENT_KEY = "command:recent-connections";

export async function saveRecentConnection(conn: RecentConnection) {
  try {
    const existing: RecentConnection[] = (await get(RECENT_KEY)) ?? [];
    existing.unshift(conn);
    await set(RECENT_KEY, existing.slice(0, 10));
  } catch {
    /* ignore */
  }
}

export async function getRecentConnections(): Promise<RecentConnection[]> {
  try {
    return (await get<RecentConnection[]>(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function clearRecentConnections(): Promise<void> {
  await del(RECENT_KEY);
}
