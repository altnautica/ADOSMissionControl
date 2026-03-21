/**
 * @module RecentConnections
 * @description Recent connection history with working reconnect.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Usb, Wifi, RotateCw, Trash2 } from "lucide-react";
import { randomId } from "@/lib/utils";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import { serialPortManager } from "@/lib/serial-port-manager";
import {
  type RecentConnection,
  getRecentConnections,
  saveRecentConnection,
  clearRecentConnections,
} from "@/lib/recent-connections";

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

    try {
      if (conn.type === "websocket" && conn.url) {
        const transport = new WebSocketTransport();
        await transport.connect(conn.url);
        const adapter = new MAVLinkAdapter();
        const vehicleInfo = await adapter.connect(transport);
        const droneId = randomId();
        const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
        addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
          type: "websocket",
          url: conn.url,
        });
        useDroneMetadataStore.getState().ensureProfile(droneId, {
          displayName: droneName,
          serial: `ALT-${droneId.toUpperCase()}`,
          enrolledAt: Date.now(),
        });
        void saveRecentConnection({ ...conn, name: droneName, date: Date.now() });
      } else if (conn.type === "serial") {
        const ports = await serialPortManager.getKnownPorts();
        if (ports.length === 0) {
          setError("No permitted serial ports. Click 'Request Port' in the Serial tab.");
          return;
        }
        const transport = new WebSerialTransport();
        await transport.connectToPort(ports[0].port, conn.baudRate || 115200);
        const adapter = new MAVLinkAdapter();
        const vehicleInfo = await adapter.connect(transport);
        const droneId = randomId();
        const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
        addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
          type: "serial",
          baudRate: conn.baudRate,
          portVendorId: ports[0].vendorId,
          portProductId: ports[0].productId,
        });
        useDroneMetadataStore.getState().ensureProfile(droneId, {
          displayName: droneName,
          serial: `ALT-${droneId.toUpperCase()}`,
          enrolledAt: Date.now(),
        });
        void saveRecentConnection({ ...conn, name: droneName, date: Date.now() });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconnect failed");
    } finally {
      setReconnecting(null);
    }
  }

  function timeAgo(date: number): string {
    const diff = Date.now() - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (connections.length === 0) {
    return (
      <p className="text-[10px] text-text-tertiary py-2">
        No recent connections yet.
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
                  : conn.url?.replace("ws://", "")}
                {" · "}
                {timeAgo(conn.date)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={conn.type === "serial" ? "info" : "neutral"}>
              {conn.type === "serial" ? "USB" : "WS"}
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
