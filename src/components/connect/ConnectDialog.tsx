/**
 * @module ConnectDialog
 * @description Global modal for connecting to flight controllers (Serial/WebSocket).
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SerialPanel } from "@/components/connect/SerialPanel";
import { WebSocketPanel } from "@/components/connect/WebSocketPanel";
import { ActiveConnections } from "@/components/connect/ActiveConnections";
import { ConnectionPresets } from "@/components/connect/ConnectionPresets";
import { RecentConnections } from "@/components/connect/RecentConnections";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { useDroneManager } from "@/stores/drone-manager";
import { saveRecentConnection } from "@/lib/recent-connections";
import { savePreset, type ConnectionPreset } from "@/lib/connection-presets";
import { randomId } from "@/lib/utils";
import { Usb, Zap, Radio, Save, Star, History } from "lucide-react";

export function ConnectDialog() {
  const t = useTranslations("connect");
  const open = useConnectDialogStore((s) => s.open);
  const closeDialog = useConnectDialogStore((s) => s.closeDialog);
  const droneCount = useDroneManager((s) => s.drones.size);
  const router = useRouter();

  const CONNECTION_TABS = [
    { id: "serial", label: t("usbSerial") },
    { id: "websocket", label: t("webSocket") },
  ];

  const [tab, setTab] = useState("serial");
  const [presetsKey, setPresetsKey] = useState(0);
  const [dfuDetected, setDfuDetected] = useState(false);

  // DFU hot-plug detection — only when dialog is open
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || !("usb" in navigator)) return;
    if (typeof window !== "undefined" && !window.isSecureContext) return;

    const checkDfu = () => {
      navigator.usb
        .getDevices()
        .then((devices) => {
          const hasDfu = devices.some(
            (d) =>
              (d.vendorId === 0x0483 && d.productId === 0xdf11) ||
              (d.vendorId === 0x2e3c && d.productId === 0x0788) ||
              (d.vendorId === 0x29ac && d.productId === 0x0003) ||
              (d.vendorId === 0x2b04 && d.productId === 0xd058),
          );
          setDfuDetected(hasDfu);
        })
        .catch(() => {});
    };

    checkDfu();

    const onConnect = () => checkDfu();
    const onDisconnect = () => checkDfu();
    navigator.usb.addEventListener("connect", onConnect);
    navigator.usb.addEventListener("disconnect", onDisconnect);
    return () => {
      navigator.usb.removeEventListener("connect", onConnect);
      navigator.usb.removeEventListener("disconnect", onDisconnect);
    };
  }, [open]);

  const handleConnected = useCallback(
    (name: string, type: "serial" | "websocket", detail: string | number) => {
      void saveRecentConnection({
        type,
        name,
        date: Date.now(),
        ...(type === "serial"
          ? { baudRate: detail as number }
          : { url: detail as string }),
      });
    },
    [],
  );

  function handleSerialConnected(name: string, _type: "serial", baudRate: number) {
    handleConnected(name, "serial", baudRate);
  }

  function handleWsConnected(name: string, _type: "websocket", url: string) {
    handleConnected(name, "websocket", url);
  }

  function handleSavePreset() {
    const presetName = prompt("Preset name:");
    if (!presetName) return;

    const preset: ConnectionPreset = {
      id: randomId(),
      name: presetName,
      type: tab as "serial" | "websocket",
      config:
        tab === "serial"
          ? { baudRate: 115200 }
          : { url: "ws://localhost:14550" },
      createdAt: Date.now(),
    };
    void savePreset(preset);
    setPresetsKey((k) => k + 1);
  }

  function handleApplyPreset(preset: ConnectionPreset) {
    setTab(preset.type);
  }

  function handleGoToFirmware() {
    closeDialog();
    router.push("/config/firmware");
  }

  return (
    <Modal
      open={open}
      onClose={closeDialog}
      title={t("title")}
      className="max-w-3xl"
    >
      <div className="max-h-[80vh] overflow-y-auto space-y-4 -m-4 p-4">
        {/* DFU banner */}
        {dfuDetected && (
          <div className="bg-accent-primary/10 border border-accent-primary/30 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Usb size={14} className="text-accent-primary" />
              <span className="text-xs text-text-primary">
                DFU device detected — bootloader mode (flash-only).
              </span>
            </div>
            <button
              onClick={handleGoToFirmware}
              className="flex items-center gap-1 text-xs text-accent-primary hover:underline shrink-0"
            >
              <Zap size={12} />
              Go to Firmware
            </button>
          </div>
        )}

        {/* Active connections */}
        {droneCount > 0 && (
          <div className="bg-bg-primary border border-status-success/20 p-3 space-y-2">
            <h3 className="text-xs font-semibold text-text-primary flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
              Active Connections
              <Badge variant="success" size="sm">
                <Radio size={8} className="mr-0.5" />
                {droneCount}
              </Badge>
            </h3>
            <ActiveConnections />
          </div>
        )}

        {/* Connection tabs */}
        <div className="border border-border-default">
          <div className="flex items-center justify-between border-b border-border-default px-4">
            <Tabs
              tabs={CONNECTION_TABS}
              activeTab={tab}
              onChange={setTab}
              className="border-b-0"
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Save size={12} />}
              onClick={handleSavePreset}
            >
              Save Preset
            </Button>
          </div>
          <div className="p-4">
            {tab === "serial" ? (
              <SerialPanel onConnected={handleSerialConnected} />
            ) : (
              <WebSocketPanel onConnected={handleWsConnected} />
            )}
          </div>
        </div>

        {/* Bottom row: Presets + Recent */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-border-default p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Star size={14} className="text-accent-secondary" />
              <h3 className="text-xs font-semibold text-text-primary">
                Saved Presets
              </h3>
            </div>
            <ConnectionPresets key={presetsKey} onApply={handleApplyPreset} />
          </div>
          <div className="border border-border-default p-3 space-y-2">
            <div className="flex items-center gap-2">
              <History size={14} className="text-text-secondary" />
              <h3 className="text-xs font-semibold text-text-primary">
                Recent Connections
              </h3>
            </div>
            <RecentConnections />
          </div>
        </div>
      </div>
    </Modal>
  );
}
