"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plug, Plus, Usb } from "lucide-react";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { randomId } from "@/lib/utils";
import { serialPortManager, type PortInfo } from "@/lib/serial-port-manager";
import { useToast } from "@/components/ui/toast";

const BAUD_RATES = [
  { value: "57600", label: "57600" },
  { value: "115200", label: "115200" },
  { value: "230400", label: "230400" },
  { value: "460800", label: "460800" },
  { value: "921600", label: "921600" },
];

export function SerialPanel({
  onConnected,
}: {
  onConnected?: (name: string, type: "serial", baudRate: number) => void;
}) {
  const t = useTranslations("connect");
  const [mounted, setMounted] = useState(false);
  const [baudRate, setBaudRate] = useState("115200");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knownPorts, setKnownPorts] = useState<PortInfo[]>([]);
  const [selectedPortIndex, setSelectedPortIndex] = useState<string>("-1");
  const [hotPlugEvent, setHotPlugEvent] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);
  const { toast } = useToast();

  const refreshPorts = useCallback(async () => {
    const ports = await serialPortManager.getKnownPorts();
    setKnownPorts(ports);
    if (ports.length > 0 && selectedPortIndex === "-1") {
      setSelectedPortIndex("0");
    }
  }, [selectedPortIndex]);

  useEffect(() => {
    setMounted(true);
    serialPortManager.init();
    refreshPorts();
  }, [refreshPorts]);

  // Hot-plug detection
  useEffect(() => {
    if (!mounted) return;
    const unsubConnect = serialPortManager.onConnect((info) => {
      setHotPlugEvent(`connected: ${info.label}`);
      toast(`USB device connected — ${info.label}`, "info");
      refreshPorts();
      setTimeout(() => setHotPlugEvent(null), 3000);
    });
    const unsubDisconnect = serialPortManager.onDisconnect((info) => {
      setHotPlugEvent(`disconnected: ${info.label}`);
      toast(`USB device disconnected — ${info.label}`, "warning");
      refreshPorts();
      setTimeout(() => setHotPlugEvent(null), 3000);
    });
    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, [mounted, toast, refreshPorts]);

  async function handleRequestPort() {
    setError(null);
    try {
      await serialPortManager.requestNewPort();
      const ports = await serialPortManager.getKnownPorts();
      setKnownPorts(ports);
      setSelectedPortIndex(String(ports.length - 1));
    } catch (err) {
      if (err instanceof Error && err.name !== "NotFoundError") {
        setError(err.message);
      }
    }
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);

    try {
      const transport = new WebSerialTransport();
      const baud = parseInt(baudRate);
      const portIdx = parseInt(selectedPortIndex);

      if (portIdx >= 0 && portIdx < knownPorts.length) {
        // Connect to the selected known port (no browser picker)
        await transport.connectToPort(knownPorts[portIdx].port, baud);
      } else {
        // Fallback: open browser picker
        await transport.connect(baud);
      }

      const adapter = new MAVLinkAdapter();
      const vehicleInfo = await adapter.connect(transport);
      const droneId = randomId();
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;

      const portInfo = portIdx >= 0 && portIdx < knownPorts.length ? knownPorts[portIdx] : undefined;
      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "serial",
        baudRate: baud,
        portVendorId: portInfo?.vendorId,
        portProductId: portInfo?.productId,
      });

      useDroneMetadataStore.getState().ensureProfile(droneId, {
        displayName: droneName,
        serial: `ALT-${droneId.toUpperCase()}`,
        enrolledAt: Date.now(),
      });

      onConnected?.(droneName, "serial", baud);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  if (!mounted) return null;

  if (!WebSerialTransport.isSupported()) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-status-warning">
          {t("webSerialNotSupported")}
        </p>
      </div>
    );
  }

  const portOptions =
    knownPorts.length > 0
      ? knownPorts.map((p, i) => ({ value: String(i), label: p.label }))
      : [{ value: "-1", label: t("noPortsHint") }];

  return (
    <div className="space-y-4">
      {/* Port selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select
              label={t("port")}
              options={portOptions}
              value={selectedPortIndex}
              onChange={setSelectedPortIndex}
            />
          </div>
          <div className="flex-1">
            <Select
              label={t("baudRate")}
              options={BAUD_RATES}
              value={baudRate}
              onChange={setBaudRate}
            />
          </div>
        </div>

        {/* Port info */}
        {knownPorts.length > 0 && parseInt(selectedPortIndex) >= 0 && (
          <div className="flex items-center gap-2">
            <Usb size={12} className="text-text-tertiary" />
            <span className="text-[10px] text-text-tertiary font-mono">
              {knownPorts[parseInt(selectedPortIndex)]?.vendorId !== undefined
                ? `VID: ${knownPorts[parseInt(selectedPortIndex)].vendorId?.toString(16).toUpperCase().padStart(4, "0")} · PID: ${knownPorts[parseInt(selectedPortIndex)].productId?.toString(16).toUpperCase().padStart(4, "0")}`
                : t("noUsbInfo")}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleConnect}
          loading={connecting}
          icon={<Plug size={14} />}
          disabled={knownPorts.length === 0}
        >
          {connecting ? t("connecting") : t("connect")}
        </Button>
        <Button
          variant="secondary"
          onClick={handleRequestPort}
          icon={<Plus size={14} />}
        >
          {t("requestPort")}
        </Button>
      </div>

      {/* Hot-plug indicator */}
      {hotPlugEvent && (
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
          <span className="text-[10px] text-accent-primary">
            Device {hotPlugEvent}
          </span>
        </div>
      )}

      {/* Known ports count */}
      {knownPorts.length > 0 && (
        <p className="text-[10px] text-text-tertiary">
          {t("portsAvailable", { count: knownPorts.length })}
        </p>
      )}

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
