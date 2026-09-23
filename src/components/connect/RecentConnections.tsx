/**
 * @module RecentConnections
 * @description Recent connection history with working reconnect.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Usb, Wifi, Network, Bluetooth, RotateCw, Trash2 } from "lucide-react";
import { resolveNodeId } from "@/lib/agent/node-id";
import { pairedAgentDeviceIdForUrl } from "@/lib/agent/paired-agent-match";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { NetMavlinkTransport } from "@/lib/protocol/transport/net-mavlink";
import { BluetoothTransport } from "@/lib/protocol/transport/ble";
import { createFcAdapter } from "@/lib/protocol/select-fc-adapter";
import type { Transport } from "@/lib/protocol/types";
import type { ConnectionMeta } from "@/lib/connection-meta";
import { matchKnownPort, serialPortManager } from "@/lib/serial-port-manager";
import {
  type RecentConnection,
  getRecentConnections,
  saveRecentConnection,
  clearRecentConnections,
} from "@/lib/recent-connections";

const TYPE_BADGE: Record<RecentConnection["type"], string> = {
  serial: "USB",
  websocket: "WS",
  "udp-proxy": "UDP",
  tcp: "TCP",
  ble: "BLE",
};

/** Why a recent entry could not be reopened, as its `connect` message key. */
type RecentOpenFailure =
  | "recent.noUrl"
  | "ownedByAgent"
  | "recent.serialPortAmbiguous"
  | "recent.incompleteEndpoint";

class RecentOpenError extends Error {
  constructor(readonly reason: RecentOpenFailure) {
    super(reason);
    this.name = "RecentOpenError";
  }
}

/**
 * Open the transport a recent entry describes. Returns the transport plus the
 * connection meta to record, or throws a `RecentOpenError` the operator can
 * act on.
 */
async function openRecent(
  conn: RecentConnection,
): Promise<{ transport: Transport; meta: ConnectionMeta }> {
  const base = { firmwareType: conn.firmwareType };
  switch (conn.type) {
    case "websocket": {
      if (!conn.url) throw new RecentOpenError("recent.noUrl");
      // A paired agent's FC is owned by its agent card; reconnecting it here
      // as a direct link would spawn a duplicate.
      if (pairedAgentDeviceIdForUrl(conn.url)) {
        throw new RecentOpenError("ownedByAgent");
      }
      const transport = new WebSocketTransport();
      await transport.connect(conn.url);
      return { transport, meta: { ...base, type: "websocket", url: conn.url } };
    }
    case "serial": {
      const port = matchKnownPort(
        await serialPortManager.getKnownPorts(),
        conn.portVendorId,
        conn.portProductId,
      );
      if (!port) throw new RecentOpenError("recent.serialPortAmbiguous");
      const transport = new WebSerialTransport();
      await transport.connectToPort(port.port, conn.baudRate || 115200);
      return {
        transport,
        meta: {
          ...base,
          type: "serial",
          baudRate: conn.baudRate,
          portVendorId: port.vendorId,
          portProductId: port.productId,
        },
      };
    }
    case "udp-proxy":
    case "tcp": {
      if (!conn.proto || !conn.host || conn.port === undefined) {
        throw new RecentOpenError("recent.incompleteEndpoint");
      }
      const endpoint = {
        proto: conn.proto,
        host: conn.host,
        port: conn.port,
        mode: conn.mode,
        bridgeUrl: conn.bridgeUrl,
      };
      const transport = new NetMavlinkTransport(conn.proto);
      await transport.connect(endpoint);
      return { transport, meta: { ...base, type: conn.type, ...endpoint } };
    }
    case "ble": {
      // Opens the browser's device picker; the click is the gesture it needs.
      const transport = new BluetoothTransport();
      await transport.connect();
      return {
        transport,
        meta: { ...base, type: "ble", bleDeviceName: transport.deviceName ?? conn.bleDeviceName },
      };
    }
  }
}

export function RecentConnections() {
  const t = useTranslations("connect");
  const [connections, setConnections] = useState<RecentConnection[]>([]);
  const [reconnecting, setReconnecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);

  useEffect(() => {
    getRecentConnections().then(setConnections).catch(() => setConnections([]));
  }, []);

  async function clearHistory() {
    await clearRecentConnections();
    setConnections([]);
  }

  async function handleReconnect(conn: RecentConnection, index: number) {
    setError(null);
    setReconnecting(index);

    let opened: Transport | null = null;
    let handedOff = false;
    try {
      const { transport, meta } = await openRecent(conn);
      opened = transport;
      const adapter = await createFcAdapter(conn.firmwareType);
      const vehicleInfo = await adapter.connect(transport);
      const droneId = resolveNodeId();
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
      addDrone(droneId, droneName, adapter, transport, vehicleInfo, meta);
      handedOff = true;
      // Record the identity this reconnect actually used (a single matching
      // port may have supplied a USB identity the old entry lacked).
      void saveRecentConnection({
        ...conn,
        portVendorId: meta.portVendorId,
        portProductId: meta.portProductId,
        bleDeviceName: meta.bleDeviceName,
        name: droneName,
        date: Date.now(),
      });
    } catch (err) {
      setError(
        err instanceof RecentOpenError
          ? t(err.reason)
          : err instanceof Error
            ? err.message
            : t("recent.reconnectFailed"),
      );
    } finally {
      // Tear down a link that opened but failed to reach a heartbeat so a
      // failed reconnect doesn't leak it.
      if (opened && !handedOff) {
        await opened.disconnect().catch(() => {});
      }
      setReconnecting(null);
    }
  }

  function timeAgo(date: number): string {
    const diff = Date.now() - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("recent.justNow");
    if (mins < 60) return t("recent.minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("recent.hoursAgo", { count: hours });
    return t("recent.daysAgo", { count: Math.floor(hours / 24) });
  }

  if (connections.length === 0) {
    return (
      <p className="text-[10px] text-text-tertiary py-2">
        {t("recent.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {connections.map((conn, i) => (
        <div
          key={`${conn.date}-${i}`}
          className="flex items-center justify-between gap-2 py-1.5 border-b border-border-default last:border-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            {conn.type === "serial" ? (
              <Usb size={12} className="text-text-tertiary shrink-0" />
            ) : conn.type === "udp-proxy" || conn.type === "tcp" ? (
              <Network size={12} className="text-text-tertiary shrink-0" />
            ) : conn.type === "ble" ? (
              <Bluetooth size={12} className="text-text-tertiary shrink-0" />
            ) : (
              <Wifi size={12} className="text-text-tertiary shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[10px] text-text-primary truncate">
                {conn.name}
              </p>
              <p className="text-[10px] text-text-tertiary font-mono">
                {conn.type === "serial"
                  ? `@ ${conn.baudRate}`
                  : conn.type === "udp-proxy" || conn.type === "tcp"
                    ? `${conn.host}:${conn.port}`
                    : conn.type === "ble"
                      ? (conn.bleDeviceName ?? "—")
                      : conn.url?.replace("ws://", "")}
                {" · "}
                {timeAgo(conn.date)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={conn.type === "serial" ? "info" : "neutral"}>
              {TYPE_BADGE[conn.type]}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCw size={10} />}
              onClick={() => handleReconnect(conn, i)}
              loading={reconnecting === i}
            >
              {t("reconnect")}
            </Button>
          </div>
        </div>
      ))}
      {error && <p className="text-[10px] text-status-error mt-1">{error}</p>}
      <div className="pt-1">
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={10} />}
          onClick={clearHistory}
        >
          {t("clear")}
        </Button>
      </div>
    </div>
  );
}
