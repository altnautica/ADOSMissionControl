/**
 * @module use-auto-reconnect
 * @description React hook that bridges ReconnectManager with stores and toast UI.
 * Handles unexpected disconnect → reconnect, and auto-connect on page load.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { ReconnectManager, type ReconnectEntry } from "@/lib/reconnect-manager";
import { useDroneManager, onUnexpectedDisconnect } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useToast } from "@/components/ui/toast";
import { getRecentConnections } from "@/lib/recent-connections";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { createFcAdapter } from "@/lib/protocol/select-fc-adapter";
import { serialPortManager } from "@/lib/serial-port-manager";
import { pairedAgentDeviceIdForUrl } from "@/lib/agent/paired-agent-match";
import { resolveNodeId } from "@/lib/agent/node-id";

export function useAutoReconnect() {
  const { toast } = useToast();
  const addDrone = useDroneManager((s) => s.addDrone);
  const managerRef = useRef<ReconnectManager | null>(null);
  const loadAttemptedRef = useRef(false);

  // Create manager once
  if (!managerRef.current) {
    managerRef.current = new ReconnectManager(
      (id, name, protocol, transport, vehicleInfo, meta) => {
        // The manager only re-dials direct connections (`fc:<random>` ids),
        // each of which owns its standalone fleet row.
        useDroneManager
          .getState()
          .addDrone(id, name, protocol, transport, vehicleInfo, meta);
      },
    );
  }

  // Subscribe to unexpected disconnects → trigger reconnect
  useEffect(() => {
    const manager = managerRef.current!;

    const unsubDisconnect = onUnexpectedDisconnect((droneId, droneName, meta) => {
      const autoReconnect = useSettingsStore.getState().autoReconnect;
      if (!autoReconnect || !meta) return;
      // An agent-attached FC is re-dialled by its agent bridge; only announce a
      // reconnect this manager is actually going to run.
      if (manager.startReconnect(droneId, droneName, meta)) {
        toast(`${droneName} disconnected — reconnecting...`, "warning");
      }
    });

    const unsubState = manager.onStateChange((entry: ReconnectEntry) => {
      if (entry.state === "connected") {
        toast(`Reconnected to ${entry.droneName}`, "success");
      }
    });

    return () => {
      unsubDisconnect();
      unsubState();
      manager.cancelAll();
    };
  }, [toast]);

  // Auto-connect on page load
  useEffect(() => {
    if (loadAttemptedRef.current) return;
    loadAttemptedRef.current = true;

    // Wait for hydration
    const checkAndConnect = async () => {
      const settings = useSettingsStore.getState();
      if (!settings.autoConnectOnLoad) return;

      // Skip if already connected
      if (useDroneManager.getState().drones.size > 0) return;

      const recent = await getRecentConnections();
      if (recent.length === 0) return;

      const last = recent[0];

      try {
        if (last.type === "websocket" && last.url) {
          // If this WebSocket is a paired agent's own host, its agent bridge
          // owns that FC — dialing it directly here would spawn a duplicate
          // standalone fleet card. Leave it to the agent path.
          if (pairedAgentDeviceIdForUrl(last.url)) return;
          const transport = new WebSocketTransport();
          await transport.connect(last.url);
          const adapter = await createFcAdapter(last.firmwareType);
          const vehicleInfo = await adapter.connect(transport);
          const id = resolveNodeId();
          const name = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
          addDrone(id, name, adapter, transport, vehicleInfo, {
            type: "websocket",
            url: last.url,
          });
          toast(`Auto-connected to ${name}`, "success");
        } else if (last.type === "serial") {
          const ports = await serialPortManager.getKnownPorts();
          if (ports.length === 0) return;
          const transport = new WebSerialTransport();
          await transport.connectToPort(ports[0].port, last.baudRate || 115200);
          const adapter = await createFcAdapter(last.firmwareType);
          const vehicleInfo = await adapter.connect(transport);
          const id = resolveNodeId();
          const name = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
          addDrone(id, name, adapter, transport, vehicleInfo, {
            type: "serial",
            baudRate: last.baudRate,
            portVendorId: ports[0].vendorId,
            portProductId: ports[0].productId,
          });
          toast(`Auto-connected to ${name}`, "success");
        }
      } catch {
        // Silent — auto-connect is best-effort
      }
    };

    // Delay slightly to let stores hydrate
    const timer = setTimeout(checkAndConnect, 1000);
    return () => clearTimeout(timer);
  }, [addDrone, toast]);
}
