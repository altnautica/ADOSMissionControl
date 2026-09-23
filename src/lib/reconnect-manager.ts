/**
 * @module reconnect-manager
 * @description Re-dials a directly connected FC (serial, WebSocket, UDP/TCP)
 * after its link drops: a fixed interval, no attempt cap, no terminal failed
 * state — a vehicle that comes back into range is picked up whenever it does.
 *
 * An FC attached through a paired agent (`node:<deviceId>` id) is not handled
 * here. Its agent bridge owns that session: it holds the credential the agent's
 * proxy requires and knows which agent the FC belongs to, so a bare re-dial
 * from here could only fail or bind the wrong vehicle.
 * @license GPL-3.0-only
 */

import type { ConnectionMeta } from "@/stores/drone-manager";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { NetMavlinkTransport } from "@/lib/protocol/transport/net-mavlink";
import { createFcAdapter } from "@/lib/protocol/select-fc-adapter";
import type { DroneProtocol, VehicleInfo } from "@/lib/protocol/types";
import { serialPortManager } from "@/lib/serial-port-manager";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";

export type ReconnectState = "waiting" | "attempting" | "connected";

export interface ReconnectEntry {
  droneId: string;
  droneName: string;
  meta: ConnectionMeta;
  state: ReconnectState;
  attempt: number;
}

type ReconnectTransport = WebSerialTransport | WebSocketTransport | NetMavlinkTransport;

type StateChangeListener = (entry: ReconnectEntry) => void;
type AddDroneCallback = (
  id: string,
  name: string,
  protocol: DroneProtocol,
  transport: ReconnectTransport,
  vehicleInfo: VehicleInfo,
  meta: ConnectionMeta,
) => void;

/** Gap between re-dial attempts. Fixed: a link is retried at the same pace forever. */
export const RECONNECT_INTERVAL_MS = 3_000;

/** Connection types this manager can re-dial on its own. */
const RECONNECTABLE_TYPES: ReadonlySet<ConnectionMeta["type"]> = new Set([
  "serial",
  "websocket",
  "udp-proxy",
  "tcp",
]);

interface ReconnectedLink {
  transport: ReconnectTransport;
  adapter: DroneProtocol;
  vehicleInfo: VehicleInfo;
  meta: ConnectionMeta;
}

export class ReconnectManager {
  private entries = new Map<string, ReconnectEntry>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<StateChangeListener>();
  private addDroneCallback: AddDroneCallback;

  constructor(addDrone: AddDroneCallback) {
    this.addDroneCallback = addDrone;
  }

  /**
   * Start re-dialling a dropped drone. Returns false, and does nothing, for a
   * drone this manager does not own: an agent-attached FC, whose agent bridge
   * re-dials it, or a transport with no direct re-dial path.
   */
  startReconnect(droneId: string, droneName: string, meta: ConnectionMeta): boolean {
    if (droneId.startsWith("node:") || !RECONNECTABLE_TYPES.has(meta.type)) {
      return false;
    }
    // One cycle per drone: a second start replaces the first.
    this.cancelReconnect(droneId);

    const entry: ReconnectEntry = {
      droneId,
      droneName,
      meta,
      state: "waiting",
      attempt: 0,
    };
    this.entries.set(droneId, entry);
    this.notify(entry);
    this.scheduleAttempt(droneId);
    return true;
  }

  /** Stop re-dialling a drone. An attempt already in flight is discarded when it lands. */
  cancelReconnect(droneId: string): void {
    const timer = this.timers.get(droneId);
    if (timer) clearTimeout(timer);
    this.timers.delete(droneId);
    this.entries.delete(droneId);
  }

  /** Cancel all reconnects. */
  cancelAll(): void {
    for (const [id] of this.entries) {
      this.cancelReconnect(id);
    }
  }

  /** Subscribe to state changes. Returns unsubscribe. */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Check if any reconnect is active. */
  isReconnecting(): boolean {
    return this.entries.size > 0;
  }

  private notify(entry: ReconnectEntry): void {
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  private scheduleAttempt(droneId: string): void {
    if (!this.entries.has(droneId)) return;
    const timer = setTimeout(() => {
      void this.attempt(droneId);
    }, RECONNECT_INTERVAL_MS);
    this.timers.set(droneId, timer);
  }

  private async attempt(droneId: string): Promise<void> {
    const entry = this.entries.get(droneId);
    if (!entry) return;

    entry.attempt++;
    entry.state = "attempting";
    this.notify(entry);

    const note = `Reconnect attempt ${entry.attempt} for ${entry.droneName}`;
    useDiagnosticsStore
      .getState()
      .logConnection("reconnect_attempt", `${note} (${entry.meta.type})`);
    useDiagnosticsStore.getState().logEvent("reconnect_attempt", note);

    let link: ReconnectedLink;
    try {
      link = await this.dial(entry.meta);
    } catch {
      // Cancelled or superseded while dialling: that cycle is over.
      if (this.entries.get(droneId) !== entry) return;
      entry.state = "waiting";
      this.notify(entry);
      this.scheduleAttempt(droneId);
      return;
    }

    // The dial succeeded, but the cycle it belonged to may have been cancelled
    // (the operator connected or removed the drone) or replaced meanwhile.
    // Attaching it then would resurrect a drone nobody is waiting for.
    if (this.entries.get(droneId) !== entry) {
      await link.adapter.disconnect().catch(() => {});
      await link.transport.disconnect().catch(() => {});
      return;
    }

    // Reconnect under the ORIGINAL id so the drone re-attaches to the same
    // fleet row instead of spawning a second one.
    const name = `${link.vehicleInfo.firmwareVersionString} (${link.vehicleInfo.vehicleClass})`;
    this.addDroneCallback(droneId, name, link.adapter, link.transport, link.vehicleInfo, link.meta);
    entry.state = "connected";
    this.notify(entry);
    this.timers.delete(droneId);
    this.entries.delete(droneId);
  }

  private dial(meta: ConnectionMeta): Promise<ReconnectedLink> {
    switch (meta.type) {
      case "serial":
        return this.dialSerial(meta);
      case "websocket":
        return this.dialWebSocket(meta);
      case "udp-proxy":
      case "tcp":
        return this.dialNet(meta);
      default:
        return Promise.reject(new Error(`No reconnect path for a ${meta.type} link`));
    }
  }

  private async dialSerial(meta: ConnectionMeta): Promise<ReconnectedLink> {
    const ports = await serialPortManager.getKnownPorts();
    if (ports.length === 0) throw new Error("No serial ports");

    // Match by VID/PID when known.
    let matchedPort = ports[0].port;
    if (meta.portVendorId !== undefined && meta.portProductId !== undefined) {
      const match = ports.find(
        (p) => p.vendorId === meta.portVendorId && p.productId === meta.portProductId,
      );
      if (match) matchedPort = match.port;
    }

    const transport = new WebSerialTransport();
    await transport.connectToPort(matchedPort, meta.baudRate || 115200);
    return handshake(transport, meta);
  }

  private async dialWebSocket(meta: ConnectionMeta): Promise<ReconnectedLink> {
    if (!meta.url) throw new Error("No URL for WebSocket reconnect");
    const transport = new WebSocketTransport();
    await transport.connect(meta.url);
    return handshake(transport, meta);
  }

  private async dialNet(meta: ConnectionMeta): Promise<ReconnectedLink> {
    const { proto, host, port } = meta;
    if (!proto || !host || port === undefined) {
      throw new Error("Incomplete endpoint for UDP/TCP reconnect");
    }
    const transport = new NetMavlinkTransport(proto);
    await transport.connect({
      proto,
      host,
      port,
      mode: meta.mode,
      bridgeUrl: meta.bridgeUrl,
    });
    return handshake(transport, meta);
  }
}

/**
 * Run the FC handshake over an open transport with the adapter for the FC
 * family detected at first connect, so a Betaflight/iNav FC comes back over
 * MSP. A failed handshake closes the transport so a failed attempt never
 * leaks a socket (a leaked UDP listener keeps its port bound and wedges the
 * next attempt).
 */
async function handshake(
  transport: ReconnectTransport,
  meta: ConnectionMeta,
): Promise<ReconnectedLink> {
  const adapter = await createFcAdapter(meta.firmwareType);
  try {
    const vehicleInfo = await adapter.connect(transport);
    return { transport, adapter, vehicleInfo, meta };
  } catch (err) {
    await transport.disconnect().catch(() => {});
    throw err;
  }
}
