"use client";

/**
 * @module FcSourcePicker
 * @description Picks the agent's MAVLink FC source (auto / serial / udp / tcp)
 * and, for a serial source, the device port + baud. Writes the choice through
 * the agent's config surface, then shows a LIVE validation line driven by the
 * gated `mavlink_alive` / `heartbeat_age_s` fields on the status poll: the
 * operator sees "MAVLink validated" once a HEARTBEAT decodes, or "waiting for
 * MAVLink…" while a port is open but silent.
 *
 * Lives on the drone Agent overview next to the status card, where the rest of
 * the FC/agent config sits. Cloud-relay mode has no local AgentClient, so the
 * picker renders a read-only note there (the write path is LAN-direct only).
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plug, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { deriveMavlinkLink, heartbeatAgeLabel } from "@/lib/agent/mavlink-link";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { describeFcSourceReadOnly } from "./fc-source-availability";
import type { FcSource, MavlinkPort } from "@/lib/agent/types";

const SOURCE_OPTIONS: SelectOption[] = [
  { value: "auto", label: "Auto", description: "Probe ports and pick a live FC" },
  { value: "serial", label: "Serial / USB", description: "A fixed serial device" },
  { value: "udp", label: "UDP", description: "A UDP MAVLink endpoint" },
  { value: "tcp", label: "TCP", description: "A TCP MAVLink endpoint" },
];

const BAUD_OPTIONS: SelectOption[] = [
  "57600",
  "115200",
  "230400",
  "460800",
  "921600",
  "1500000",
].map((b) => ({ value: b, label: b }));

export function FcSourcePicker() {
  const client = useAgentConnectionStore((s) => s.client);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const status = useAgentSystemStore((s) => s.status);

  const [ports, setPorts] = useState<MavlinkPort[]>([]);
  const [source, setSource] = useState<FcSource>("auto");
  const [serialPort, setSerialPort] = useState<string>("");
  const [baud, setBaud] = useState<string>("115200");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPorts, setLoadingPorts] = useState(false);

  // Seed the picker from the agent's reported source/port/baud once known, so
  // it reflects reality rather than always defaulting to "auto". Only seeds
  // until the operator first edits (the ref guards against clobbering edits on
  // every poll).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !status) return;
    if (status.fc_source) setSource(status.fc_source);
    if (status.fc_port) setSerialPort(status.fc_port);
    if (status.fc_baud) setBaud(String(status.fc_baud));
    seededRef.current = true;
  }, [status]);

  const loadPorts = useCallback(async () => {
    if (!client || typeof client.getMavlinkPorts !== "function") return;
    setLoadingPorts(true);
    try {
      const list = await client.getMavlinkPorts();
      setPorts(list);
      // Default the serial port to the first detected device when none is set.
      setSerialPort((prev) => prev || list[0]?.path || "");
    } catch {
      // Best-effort enumeration; leave the list empty.
    } finally {
      setLoadingPorts(false);
    }
  }, [client]);

  useEffect(() => {
    void loadPorts();
  }, [loadPorts]);

  const apply = useCallback(async () => {
    if (!client || typeof client.setMavlinkSource !== "function") return;
    setApplying(true);
    setApplied(false);
    setError(null);
    try {
      await client.setMavlinkSource(source, {
        serialPort: source === "serial" ? serialPort || undefined : undefined,
        baudRate: source === "serial" ? Number(baud) : undefined,
      });
      setApplied(true);
      // The router re-binds asynchronously; the live indicator below reads the
      // status poll, so no manual refresh is needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set FC source");
    } finally {
      setApplying(false);
    }
  }, [client, source, serialPort, baud]);

  const link = deriveMavlinkLink(status);

  // Cloud relay has no write path to the config surface, so the picker can only
  // report here. The reason names what is true of THIS node rather than
  // promising a LAN connection it may not have, and the reading is shown
  // alongside it instead of standing in for the explanation.
  if (cloudMode) {
    return (
      <div className="border border-border-default rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-text-tertiary" />
          <h3 className="text-sm font-medium text-text-primary">FC source</h3>
        </div>
        {status?.fc_source && (
          <p className="text-xs text-text-secondary">
            Source: {status.fc_source}
          </p>
        )}
        <p className="text-xs text-text-tertiary">
          {describeFcSourceReadOnly({
            lanPaired: cloudDeviceId
              ? resolveLocalAgentForDrone(cloudDeviceId) !== null
              : false,
            originIsHttps:
              typeof window !== "undefined" &&
              window.location.protocol === "https:",
          })}
        </p>
      </div>
    );
  }

  const portOptions: SelectOption[] =
    ports.length > 0
      ? ports.map((p) => ({
          value: p.path,
          label: p.path,
          description: p.description || undefined,
        }))
      : serialPort
        ? [{ value: serialPort, label: serialPort }]
        : [];

  return (
    <div className="border border-border-default rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-text-tertiary" />
          <h3 className="text-sm font-medium text-text-primary">FC source</h3>
        </div>
        <button
          type="button"
          onClick={() => void loadPorts()}
          className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          title="Rescan serial ports"
          disabled={loadingPorts}
        >
          <RefreshCw
            size={12}
            className={cn(loadingPorts && "animate-spin")}
          />
        </button>
      </div>

      <Select
        label="Source"
        options={SOURCE_OPTIONS}
        value={source}
        onChange={(v) => {
          setSource(v as FcSource);
          setApplied(false);
        }}
      />

      {source === "serial" && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Port"
            options={portOptions}
            value={serialPort}
            onChange={(v) => {
              setSerialPort(v);
              setApplied(false);
            }}
            placeholder={
              loadingPorts ? "Scanning…" : "No serial ports detected"
            }
          />
          <Select
            label="Baud"
            options={BAUD_OPTIONS}
            value={baud}
            onChange={(v) => {
              setBaud(v);
              setApplied(false);
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          loading={applying}
          disabled={applying || (source === "serial" && !serialPort)}
          onClick={() => void apply()}
        >
          Apply
        </Button>
        {/* Live validation: drives off the gated mavlink_alive / heartbeat_age_s
            so the operator sees the link prove itself, not just an "applied". */}
        {link.state === "msp" ? (
          // An MSP FC (Betaflight/iNav) never emits a MAVLink heartbeat; it is
          // validated by being reachable + drivable over the MSP proxy, so it
          // reads active, not "waiting for MAVLink…".
          <span className="flex items-center gap-1.5 text-xs text-status-success">
            <CheckCircle2 size={12} />
            MSP link active
          </span>
        ) : link.mavlinkAlive ? (
          <span className="flex items-center gap-1.5 text-xs text-status-success">
            <CheckCircle2 size={12} />
            MAVLink validated{" "}
            <span className="text-text-tertiary">
              ({heartbeatAgeLabel(link.heartbeatAgeS)})
            </span>
          </span>
        ) : link.transportOpen ? (
          <span className="flex items-center gap-1.5 text-xs text-status-warning">
            <Loader2 size={12} className="animate-spin" />
            waiting for MAVLink…
          </span>
        ) : applied ? (
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Loader2 size={12} className="animate-spin" />
            applying…
          </span>
        ) : null}
      </div>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
