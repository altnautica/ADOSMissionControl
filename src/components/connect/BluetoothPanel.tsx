"use client";

/**
 * @module BluetoothPanel
 * @description Connect dialog panel for Bluetooth Low Energy (Web Bluetooth API).
 * Filters devices to those exposing the Nordic UART Service (NUS).
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Bluetooth, AlertCircle } from "lucide-react";
import { BluetoothTransport } from "@/lib/protocol/transport/ble";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { randomId } from "@/lib/utils";

export function BluetoothPanel({
  onConnected,
  targetDroneId,
}: {
  onConnected?: (name: string, type: "ble", deviceName: string) => void;
  /** When set, connects this transport as an additional link to the existing drone (multi-link mode). */
  targetDroneId?: string | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);
  const attachLinkToDrone = useDroneManager((s) => s.attachLinkToDrone);

  if (!BluetoothTransport.isSupported()) {
    return (
      <div className="py-6 px-4 text-center space-y-2">
        <AlertCircle size={20} className="mx-auto text-text-tertiary" />
        <p className="text-xs text-text-secondary font-medium">Bluetooth not supported</p>
        <p className="text-[10px] text-text-tertiary max-w-xs mx-auto">
          Web Bluetooth requires a Chromium-based browser (Chrome, Edge, Opera) running in
          a secure context (HTTPS or localhost). Firefox and Safari do not support Web Bluetooth.
        </p>
      </div>
    );
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);

    try {
      const transport = new BluetoothTransport();
      await transport.connect();
      const deviceName = transport.deviceName ?? "BLE device";

      // Multi-link mode: attach as secondary link to existing drone
      if (targetDroneId) {
        const result = await attachLinkToDrone(targetDroneId, transport);
        if (!result.ok) {
          try { await transport.disconnect(); } catch { /* ignore */ }
          setError(result.error);
          setConnecting(false);
          return;
        }
        onConnected?.("link", "ble", deviceName);
        setConnecting(false);
        return;
      }

      const adapter = new MAVLinkAdapter();
      const vehicleInfo = await adapter.connect(transport);
      const droneId = randomId();
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass}) BLE`;

      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "websocket", // ConnectionMeta type union doesn't include "ble"; reuse closest
        url: `ble://${deviceName}`,
      });

      useDroneMetadataStore.getState().ensureProfile(droneId, {
        displayName: droneName,
        serial: `ALT-${droneId.toUpperCase()}`,
        enrolledAt: Date.now(),
      });

      onConnected?.(droneName, "ble", deviceName);
    } catch (err) {
      // Browser device picker cancelled by user is a NotFoundError — show friendly message
      const message = err instanceof Error ? err.message : "Bluetooth connection failed";
      if (message.includes("User cancelled") || message.includes("NotFoundError")) {
        setError("Device selection cancelled");
      } else {
        setError(message);
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center py-4 space-y-2">
        <Bluetooth size={28} className="mx-auto text-accent-primary" />
        <p className="text-xs text-text-secondary">
          Connect to a flight controller exposing the Nordic UART Service (NUS).
        </p>
        <p className="text-[10px] text-text-tertiary">
          Compatible with Betaflight, iNav, SpeedyBee, and most BLE-enabled FCs.
        </p>
      </div>

      <Button
        variant="primary"
        onClick={handleConnect}
        disabled={connecting}
        className="w-full"
        icon={<Bluetooth size={14} />}
      >
        {connecting ? "Scanning..." : "Scan & Connect"}
      </Button>

      {error && (
        <div className="flex items-start gap-2 p-2 border border-status-error/30 bg-status-error/10 rounded">
          <AlertCircle size={12} className="text-status-error shrink-0 mt-0.5" />
          <p className="text-[10px] text-status-error">{error}</p>
        </div>
      )}
    </div>
  );
}
