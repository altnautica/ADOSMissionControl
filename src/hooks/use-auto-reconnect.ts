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
import type { Transport } from "@/lib/protocol/types";
import { matchKnownPort, serialPortManager } from "@/lib/serial-port-manager";
import { pairedAgentDeviceIdForUrl } from "@/lib/agent/paired-agent-match";
import { resolveNodeId } from "@/lib/agent/node-id";

export function useAutoReconnect() {
  const { toast } = useToast();
  const addDrone = useDroneManager((s) => s.addDrone);
  const settingsHydrated = useSettingsStore((s) => s._hasHydrated);
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
      } else if (meta.type === "ble") {
        // The browser only opens a Bluetooth device from an operator gesture,
        // so a BLE link cannot be re-dialled in the background.
        toast(
          `Bluetooth link to ${droneName} lost. Reconnect it from the Connect dialog.`,
          "warning",
        );
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

  // Auto-connect on page load, once, after the persisted settings (the
  // opt-in toggle) are known. Marked attempted only when it actually runs, so
  // a StrictMode double mount or an early render cannot skip it.
  useEffect(() => {
    if (!settingsHydrated || loadAttemptedRef.current) return;
    loadAttemptedRef.current = true;

    const checkAndConnect = async () => {
      const settings = useSettingsStore.getState();
      if (!settings.autoConnectOnLoad) return;

      // Skip if already connected
      if (useDroneManager.getState().drones.size > 0) return;

      const recent = await getRecentConnections();
      if (recent.length === 0) return;

      const last = recent[0];
      // An opened transport whose FC handshake then fails must be closed, or
      // the port stays held and the operator's manual Connect is refused.
      let opened: Transport | null = null;

      try {
        if (last.type === "websocket" && last.url) {
          // If this WebSocket is a paired agent's own host, its agent bridge
          // owns that FC — dialing it directly here would spawn a duplicate
          // standalone fleet card. Leave it to the agent path.
          if (pairedAgentDeviceIdForUrl(last.url)) return;
          const transport = new WebSocketTransport();
          await transport.connect(last.url);
          opened = transport;
          const adapter = await createFcAdapter(last.firmwareType);
          const vehicleInfo = await adapter.connect(transport);
          const id = resolveNodeId();
          const name = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
          addDrone(id, name, adapter, transport, vehicleInfo, {
            type: "websocket",
            url: last.url,
            firmwareType: last.firmwareType,
          });
          opened = null; // owned by the drone manager from here on
          toast(`Auto-connected to ${name}`, "success");
        } else if (last.type === "serial") {
          // Only the port that carried this link, never whichever permitted
          // port is listed first; with no unique match there is nothing to
          // open without asking.
          const port = matchKnownPort(
            await serialPortManager.getKnownPorts(),
            last.portVendorId,
            last.portProductId,
          );
          if (!port) return;
          const transport = new WebSerialTransport();
          await transport.connectToPort(port.port, last.baudRate || 115200);
          opened = transport;
          const adapter = await createFcAdapter(last.firmwareType);
          const vehicleInfo = await adapter.connect(transport);
          const id = resolveNodeId();
          const name = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;
          addDrone(id, name, adapter, transport, vehicleInfo, {
            type: "serial",
            baudRate: last.baudRate,
            portVendorId: port.vendorId,
            portProductId: port.productId,
            firmwareType: last.firmwareType,
          });
          opened = null; // owned by the drone manager from here on
          toast(`Auto-connected to ${name}`, "success");
        }
      } catch {
        // Best-effort: stay silent, but release whatever was opened.
        await opened?.disconnect().catch(() => {});
      }
    };

    void checkAndConnect();
  }, [settingsHydrated, addDrone, toast]);
}
