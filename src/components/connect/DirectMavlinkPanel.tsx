/**
 * @module DirectMavlinkPanel
 * @description The "Flight Controller (Direct MAVLink)" column of the unified
 * Connect dialog. Presents every direct transport (USB Serial / WebSocket / UDP
 * / TCP / Bluetooth) as a method card with a per-surface availability chip;
 * selecting one reveals its form below. Hosts the connect-new vs add-link mode
 * toggle, save-preset, saved presets, and recent connections. Connects straight
 * to a flight controller over MAVLink (no companion agent).
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SerialPanel } from "@/components/connect/SerialPanel";
import { WebSocketPanel } from "@/components/connect/WebSocketPanel";
import { BluetoothPanel } from "@/components/connect/BluetoothPanel";
import { NetEndpointPanel, type NetEndpointValue } from "@/components/connect/NetEndpointPanel";
import { MethodCard } from "@/components/connect/MethodCard";
import { ConnectionPresets } from "@/components/connect/ConnectionPresets";
import { RecentConnections } from "@/components/connect/RecentConnections";
import {
  getDirectConnectionMethods,
  type ConnectionMethod,
  type DirectMethodId,
} from "@/lib/connect/connection-methods";
import { DEFAULT_BRIDGE_URL } from "@/lib/protocol/transport/net-mavlink";
import { useDroneManager } from "@/stores/drone-manager";
import { saveRecentConnection } from "@/lib/recent-connections";
import { savePreset, type ConnectionPreset } from "@/lib/connection-presets";
import { randomId } from "@/lib/utils";
import { Usb, Zap, Save, Star, History } from "lucide-react";

export function DirectMavlinkPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("connect");
  const droneCount = useDroneManager((s) => s.drones.size);
  const drones = useDroneManager((s) => s.drones);
  const router = useRouter();

  // Availability is surface-dependent (desktop vs browser, Chromium vs not).
  // The connect dialog only ever renders client-side (Modal portals and returns
  // null while closed), so a lazy initializer reads the real surface with no
  // SSR/CSR mismatch and recomputes on each open.
  const [methods] = useState<ConnectionMethod[]>(getDirectConnectionMethods);
  const [selected, setSelected] = useState<DirectMethodId>("serial");
  const [presetsKey, setPresetsKey] = useState(0);
  const [dfuDetected, setDfuDetected] = useState(false);
  const [serialBaudRate, setSerialBaudRate] = useState(115200);
  const [websocketUrl, setWebsocketUrl] = useState("ws://localhost:14550");
  const [udpValue, setUdpValue] = useState<NetEndpointValue>({ host: "0.0.0.0", port: 14550, mode: "listen" });
  const [tcpValue, setTcpValue] = useState<NetEndpointValue>({ host: "127.0.0.1", port: 5760 });
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
  const [connectMode, setConnectMode] = useState<"new" | "link">("new");
  const [selectedTargetDroneId, setSelectedTargetDroneId] = useState<string | null>(null);

  // Reset link target when no drones remain.
  useEffect(() => {
    if (drones.size === 0) {
      setConnectMode("new");
      setSelectedTargetDroneId(null);
    }
  }, [drones.size]);

  // DFU hot-plug detection.
  useEffect(() => {
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
  }, []);

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
      // Direct connect does not need the modal afterward; main dashboard shows
      // the new fleet row (via node registry attach in addDrone).
      onClose();
    },
    [onClose],
  );

  function handleSerialConnected(name: string, _type: "serial", baudRate: number) {
    handleConnected(name, "serial", baudRate);
  }

  function handleWsConnected(name: string, _type: "websocket", url: string) {
    handleConnected(name, "websocket", url);
  }

  async function handleSavePreset() {
    const presetName = prompt(t("presetNamePrompt"));
    if (!presetName) return;

    let preset: ConnectionPreset;
    const base = { id: randomId(), name: presetName, createdAt: Date.now() };
    if (selected === "serial") {
      preset = { ...base, type: "serial", config: { baudRate: serialBaudRate } };
    } else if (selected === "websocket") {
      preset = { ...base, type: "websocket", config: { url: websocketUrl } };
    } else if (selected === "udp") {
      preset = {
        ...base,
        type: "udp-proxy",
        config: { proto: "udp", host: udpValue.host, port: udpValue.port, mode: udpValue.mode, bridgeUrl },
      };
    } else if (selected === "tcp") {
      preset = {
        ...base,
        type: "tcp",
        config: { proto: "tcp", host: tcpValue.host, port: tcpValue.port, bridgeUrl },
      };
    } else {
      return; // Bluetooth picker can't be saved as a preset.
    }
    await savePreset(preset);
    setPresetsKey((k) => k + 1);
  }

  function handleApplyPreset(preset: ConnectionPreset) {
    if (preset.type === "serial") {
      setSelected("serial");
      if (preset.config.baudRate) setSerialBaudRate(preset.config.baudRate);
    } else if (preset.type === "websocket") {
      setSelected("websocket");
      if (preset.config.url) setWebsocketUrl(preset.config.url);
    } else if (preset.type === "udp-proxy") {
      setSelected("udp");
      setUdpValue({
        host: preset.config.host ?? "0.0.0.0",
        port: preset.config.port ?? 14550,
        mode: preset.config.mode ?? "listen",
      });
      if (preset.config.bridgeUrl) setBridgeUrl(preset.config.bridgeUrl);
    } else if (preset.type === "tcp") {
      setSelected("tcp");
      setTcpValue({ host: preset.config.host ?? "127.0.0.1", port: preset.config.port ?? 5760 });
      if (preset.config.bridgeUrl) setBridgeUrl(preset.config.bridgeUrl);
    }
  }

  function handleGoToFirmware() {
    onClose();
    router.push("/config/firmware");
  }

  const linkTarget = connectMode === "link" ? selectedTargetDroneId : null;
  const selectedMethod = methods.find((m) => m.id === selected);

  return (
    <div className="space-y-4">
      {/* DFU banner */}
      {dfuDetected && (
        <div className="bg-accent-primary/10 border border-accent-primary/30 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Usb size={14} className="text-accent-primary" />
            <span className="text-xs text-text-primary">{t("dfuDetected")}</span>
          </div>
          <button
            onClick={handleGoToFirmware}
            className="flex items-center gap-1 text-xs text-accent-primary hover:underline shrink-0"
          >
            <Zap size={12} />
            {t("goToFirmware")}
          </button>
        </div>
      )}

      {/* Mode toggle (only when at least one drone is connected) */}
      {droneCount > 0 && (
        <div className="border border-border-default p-3 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="connect-mode"
                checked={connectMode === "new"}
                onChange={() => {
                  setConnectMode("new");
                  setSelectedTargetDroneId(null);
                }}
                className="accent-accent-primary"
              />
              <span className="text-text-secondary">{t("connectNewDrone")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="connect-mode"
                checked={connectMode === "link"}
                onChange={() => setConnectMode("link")}
                className="accent-accent-primary"
              />
              <span className="text-text-secondary">{t("addLinkToDrone")}</span>
            </label>
          </div>
          {connectMode === "link" && (
            <div className="pt-2">
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">
                {t("targetDroneLabel")}
              </label>
              <Select
                value={selectedTargetDroneId ?? ""}
                onChange={(v) => setSelectedTargetDroneId(v || null)}
                className="w-full"
                options={[
                  { value: "", label: t("selectDrone") },
                  ...Array.from(drones.values()).map((d) => ({
                    value: d.id,
                    label: `${d.name} (sysid ${d.vehicleInfo.systemId})`,
                  })),
                ]}
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                {t("targetDroneHint")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Method cards + selected form */}
      <div className="border border-border-default">
        <div className="p-2 space-y-1.5">
          {methods.map((m) => (
            <MethodCard
              key={m.id}
              method={m}
              selected={selected === m.id}
              onSelect={setSelected}
            />
          ))}
        </div>
        <div className="border-t border-border-default px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-tertiary truncate">
            {selectedMethod ? t(selectedMethod.blurbKey) : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<Save size={12} />}
            onClick={handleSavePreset}
            disabled={selected === "bluetooth"}
          >
            {t("savePreset")}
          </Button>
        </div>
        <div className="p-4">
          {selected === "serial" ? (
            <SerialPanel
              onConnected={handleSerialConnected}
              baudRate={serialBaudRate}
              onBaudRateChange={setSerialBaudRate}
              targetDroneId={linkTarget}
            />
          ) : selected === "websocket" ? (
            <WebSocketPanel
              onConnected={handleWsConnected}
              url={websocketUrl}
              onUrlChange={setWebsocketUrl}
              targetDroneId={linkTarget}
            />
          ) : selected === "udp" ? (
            <NetEndpointPanel
              proto="udp"
              value={udpValue}
              bridgeUrl={bridgeUrl}
              onChange={setUdpValue}
              onBridgeUrlChange={setBridgeUrl}
              onConnected={() => onClose()}
              targetDroneId={linkTarget}
            />
          ) : selected === "tcp" ? (
            <NetEndpointPanel
              proto="tcp"
              value={tcpValue}
              bridgeUrl={bridgeUrl}
              onChange={setTcpValue}
              onBridgeUrlChange={setBridgeUrl}
              onConnected={() => onClose()}
              targetDroneId={linkTarget}
            />
          ) : selected === "bluetooth" ? (
            <BluetoothPanel targetDroneId={linkTarget} />
          ) : null}
        </div>
      </div>

      {/* Presets + Recent */}
      <div className="border border-border-default p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Star size={14} className="text-accent-secondary" />
          <h3 className="text-xs font-semibold text-text-primary">
            {t("savedPresets")}
          </h3>
        </div>
        <ConnectionPresets key={presetsKey} onApply={handleApplyPreset} />
      </div>
      <div className="border border-border-default p-3 space-y-2">
        <div className="flex items-center gap-2">
          <History size={14} className="text-text-secondary" />
          <h3 className="text-xs font-semibold text-text-primary">
            {t("recentConnections")}
          </h3>
        </div>
        <RecentConnections />
      </div>
    </div>
  );
}
