"use client";

/**
 * @module BluetoothPanel
 * @description Connect dialog panel for Bluetooth Low Energy (Web Bluetooth API).
 * Filters devices to those exposing the Nordic UART Service (NUS).
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Bluetooth, AlertCircle } from "lucide-react";
import { BluetoothTransport } from "@/lib/protocol/transport/ble";
import { connectWithDetection } from "@/lib/protocol/connect-with-detection";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveNodeId } from "@/lib/agent/node-id";
import { saveRecentConnection } from "@/lib/recent-connections";

export function BluetoothPanel({
  onConnected,
  targetDroneId,
  connectDisabled = false,
}: {
  /** Called after a successful connect or link attach so the host can close. */
  onConnected?: () => void;
  /** When set, connects this transport as an additional link to the existing drone (multi-link mode). */
  targetDroneId?: string | null;
  /** Blocks the connect action (link mode with no target drone chosen yet). */
  connectDisabled?: boolean;
}) {
  const t = useTranslations("connect");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);
  const attachLinkToDrone = useDroneManager((s) => s.attachLinkToDrone);

  if (!BluetoothTransport.isSupported()) {
    return (
      <div className="py-6 px-4 text-center space-y-2">
        <AlertCircle size={20} className="mx-auto text-text-tertiary" />
        <p className="text-xs text-text-secondary font-medium">{t("ble.notSupported")}</p>
        <p className="text-[10px] text-text-tertiary max-w-xs mx-auto">
          {t("ble.notSupportedHint")}
        </p>
      </div>
    );
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);

    // Held outside the try so a failed detection or a refused link attach
    // releases the GATT connection: a single-central UART bridge otherwise
    // stays bound to this tab and refuses every other client.
    let transport: BluetoothTransport | null = null;
    let owned = true;
    try {
      transport = new BluetoothTransport();
      await transport.connect();
      const deviceName = transport.deviceName ?? t("ble.unnamedDevice");

      // Multi-link mode: attach as secondary link to existing drone
      if (targetDroneId) {
        const result = await attachLinkToDrone(targetDroneId, transport);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        owned = false;
        onConnected?.();
        return;
      }

      const { adapter, vehicleInfo, firmwareType } =
        await connectWithDetection(transport);
      const droneId = resolveNodeId();
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass}) BLE`;

      owned = false;
      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "ble",
        bleDeviceName: deviceName,
        firmwareType,
      });

      void saveRecentConnection({
        type: "ble",
        bleDeviceName: deviceName,
        firmwareType,
        name: droneName,
        date: Date.now(),
      });

      onConnected?.();
    } catch (err) {
      // Browser device picker cancelled by user is a NotFoundError — show friendly message
      const message = err instanceof Error ? err.message : t("ble.connectionFailed");
      if (message.includes("User cancelled") || message.includes("NotFoundError")) {
        setError(t("ble.selectionCancelled"));
      } else {
        setError(message);
      }
    } finally {
      if (owned && transport) {
        await transport.disconnect().catch(() => {});
      }
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center py-4 space-y-2">
        <Bluetooth size={28} className="mx-auto text-accent-primary" />
        <p className="text-xs text-text-secondary">{t("ble.intro")}</p>
        <p className="text-[10px] text-text-tertiary">{t("ble.compatibility")}</p>
      </div>

      <Button
        variant="primary"
        onClick={handleConnect}
        disabled={connecting || connectDisabled}
        className="w-full"
        icon={<Bluetooth size={14} />}
      >
        {connecting ? t("ble.scanning") : t("ble.scanAndConnect")}
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
