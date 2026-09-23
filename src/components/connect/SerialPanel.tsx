"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plug, Plus, Usb } from "lucide-react";
import { WebSerialTransport } from "@/lib/protocol/transport/webserial";
import { connectWithDetection } from "@/lib/protocol/connect-with-detection";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveNodeId } from "@/lib/agent/node-id";
import { saveRecentConnection } from "@/lib/recent-connections";
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
  baudRate,
  onBaudRateChange,
  targetDroneId,
  connectDisabled = false,
}: {
  /** Called after a successful connect or link attach so the host can close. */
  onConnected?: () => void;
  baudRate?: number;
  onBaudRateChange?: (baudRate: number) => void;
  /** When set, connects this transport as an additional link to the existing drone (multi-link mode). */
  targetDroneId?: string | null;
  /** Blocks the connect action (link mode with no target drone chosen yet). */
  connectDisabled?: boolean;
}) {
  const t = useTranslations("connect");
  const [mounted, setMounted] = useState(false);
  const [localBaudRate, setLocalBaudRate] = useState("115200");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knownPorts, setKnownPorts] = useState<PortInfo[]>([]);
  // The selected port is tracked as the SerialPort object, never a list
  // position: a hot-plug refresh reorders the list, and a position would
  // slide the selection onto whatever device took that row.
  const [selectedPort, setSelectedPort] = useState<SerialPort | null>(null);
  const [hotPlugEvent, setHotPlugEvent] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);
  const attachLinkToDrone = useDroneManager((s) => s.attachLinkToDrone);
  const { toast } = useToast();

  const selectedBaudRate = String(baudRate ?? parseInt(localBaudRate, 10));

  const handleBaudRateChange = (value: string) => {
    setLocalBaudRate(value);
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      onBaudRateChange?.(parsed);
    }
  };

  const refreshPorts = useCallback(async () => {
    const ports = await serialPortManager.getKnownPorts();
    setKnownPorts(ports);
    // A selected port that vanished leaves nothing selected. With nothing
    // selected, a lone port is the only candidate; several need a choice.
    setSelectedPort((prev) => {
      if (prev) return ports.some((p) => p.port === prev) ? prev : null;
      return ports.length === 1 ? ports[0].port : null;
    });
  }, []);

  useEffect(() => {
    setMounted(true);
    serialPortManager.init();
    refreshPorts();
  }, [refreshPorts]);

  // Hot-plug detection
  useEffect(() => {
    if (!mounted) return;
    const unsubConnect = serialPortManager.onConnect((info) => {
      setHotPlugEvent(t("serial.hotPlugConnected", { label: info.label }));
      toast(t("serial.toastConnected", { label: info.label }), "info");
      refreshPorts();
      setTimeout(() => setHotPlugEvent(null), 3000);
    });
    const unsubDisconnect = serialPortManager.onDisconnect((info) => {
      setHotPlugEvent(t("serial.hotPlugDisconnected", { label: info.label }));
      toast(t("serial.toastDisconnected", { label: info.label }), "warning");
      refreshPorts();
      setTimeout(() => setHotPlugEvent(null), 3000);
    });
    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, [mounted, toast, refreshPorts, t]);

  const selectedInfo = knownPorts.find((p) => p.port === selectedPort);

  async function handleRequestPort() {
    setError(null);
    try {
      const picked = await serialPortManager.requestNewPort();
      setKnownPorts(await serialPortManager.getKnownPorts());
      // The chooser can hand back a port that was already permitted, so
      // select the port it returned, wherever it sits in the list.
      setSelectedPort(picked.port);
    } catch (err) {
      if (err instanceof Error && err.name !== "NotFoundError") {
        setError(err.message);
      }
    }
  }

  async function handleConnect() {
    if (!selectedInfo) return;
    const portInfo = selectedInfo;
    setError(null);
    setConnecting(true);

    // Held outside the try so the catch can release it. A WebSerial port
    // whose reader lock is never released cannot be reopened for the rest
    // of the page's life, so a single failed FC detection used to make the
    // operator reload the GCS to try the same cable again.
    let transport: WebSerialTransport | null = null;
    let owned = true;
    try {
      transport = new WebSerialTransport();
      const baud = parseInt(selectedBaudRate, 10);

      await transport.connectToPort(portInfo.port, baud);

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
      // A direct-connect FC has no agent identity, so it gets a canonical
      // `fc:<random>` node id (its own selection id), distinct from an agent
      // node's `node:<deviceId>`.
      const droneId = resolveNodeId();
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;

      owned = false;
      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "serial",
        baudRate: baud,
        portVendorId: portInfo.vendorId,
        portProductId: portInfo.productId,
        firmwareType,
      });

      void saveRecentConnection({
        type: "serial",
        baudRate: baud,
        portVendorId: portInfo.vendorId,
        portProductId: portInfo.productId,
        firmwareType,
        name: droneName,
        date: Date.now(),
      });

      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connectionFailed"));
    } finally {
      // Anything the drone manager did not take ownership of is ours to
      // close — including the common case where `connectWithDetection`
      // throws on a port that opened fine.
      if (owned && transport) {
        try {
          await transport.disconnect();
        } catch {
          /* already closed */
        }
      }
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

  const portOptions = knownPorts.map((p, i) => ({ value: String(i), label: p.label }));

  return (
    <div className="space-y-4">
      {/* Port selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select
              label={t("port")}
              options={portOptions}
              value={selectedInfo ? String(knownPorts.indexOf(selectedInfo)) : ""}
              onChange={(v) => setSelectedPort(knownPorts[Number(v)]?.port ?? null)}
              placeholder={knownPorts.length > 0 ? t("serial.selectPort") : t("noPortsHint")}
            />
          </div>
          <div className="flex-1">
            <Select
              label={t("baudRate")}
              options={BAUD_RATES}
              value={selectedBaudRate}
              onChange={handleBaudRateChange}
            />
          </div>
        </div>

        {/* Port info */}
        {selectedInfo && (
          <div className="flex items-center gap-2">
            <Usb size={12} className="text-text-tertiary" />
            <span className="text-[10px] text-text-tertiary font-mono">
              {selectedInfo.vendorId !== undefined
                ? `VID: ${selectedInfo.vendorId.toString(16).toUpperCase().padStart(4, "0")} · PID: ${selectedInfo.productId?.toString(16).toUpperCase().padStart(4, "0")}`
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
          disabled={!selectedInfo || connectDisabled}
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
            {hotPlugEvent}
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
