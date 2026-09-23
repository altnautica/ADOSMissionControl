/**
 * @module BfPortsPanel
 * @description Betaflight serial-port configuration. Reads the per-UART function
 * bitmask + baud indices and writes them back so ports can be configured in-app
 * instead of the CLI. Prefers the 32-bit MSP2_COMMON_SERIAL_CONFIG (which
 * exposes function bits above 15: FrSky OSD, VTX MSP, gimbal, LIDAR NL, custom
 * OSD text) and falls back to the legacy U16 MSP_CF_SERIAL_CONFIG.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { Cable, Upload } from "lucide-react";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import type { MspSerialPort } from "@/lib/protocol/types";
import { BF_SERIAL_FUNCTIONS, BF_SERIAL_FUNCTIONS_EXTENDED, BF_BAUD_RATES, bfPortLabel } from "./bf-ports-constants";

const BAUD_OPTIONS = BF_BAUD_RATES.map((label, i) => ({ value: String(i), label }));

/** Baud fields shown per port, in wire order. */
const BAUD_FIELDS: ReadonlyArray<{ key: keyof MspSerialPort; label: string }> = [
  { key: "mspBaudRate", label: "MSP" },
  { key: "gpsBaudRate", label: "GPS" },
  { key: "telemetryBaudRate", label: "Telemetry" },
  { key: "blackboxBaudRate", label: "Blackbox" },
];

export function BfPortsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();
  const { isArmed, lockMessage } = useArmedLock();

  const [ports, setPorts] = useState<MspSerialPort[]>([]);
  const [baseline, setBaseline] = useState("");
  const [extended, setExtended] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  /** Saved to EEPROM this session; ports are only reconfigured at boot. */
  const [needsReboot, setNeedsReboot] = useState(false);

  const read = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getSerialConfig) {
      setError("Serial-port config is not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await protocol.getSerialConfig();
      setPorts(p);
      setBaseline(JSON.stringify(p));
      setExtended(protocol.serialConfigExtended?.() ?? false);
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol]);

  const write = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.setSerialConfig) return;
    setLoading(true);
    setError(null);
    try {
      const r = await protocol.setSerialConfig(ports);
      if (r.success) { setBaseline(JSON.stringify(ports)); setNeedsReboot(true); }
      else setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, ports]);

  const updatePort = useCallback((idx: number, patch: Partial<MspSerialPort>) => {
    setPorts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }, []);

  const toggleFunction = useCallback((idx: number, bit: number, on: boolean) => {
    setPorts((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const functions = on ? p.functions | (1 << bit) : p.functions & ~(1 << bit);
      return { ...p, functions };
    }));
  }, []);

  const dirty = hasLoaded && JSON.stringify(ports) !== baseline;
  const disabled = loading || isArmed;
  const serialFunctions = extended
    ? [...BF_SERIAL_FUNCTIONS, ...BF_SERIAL_FUNCTIONS_EXTENDED]
    : BF_SERIAL_FUNCTIONS;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <PanelHeader
        title="Ports"
        subtitle="Betaflight per-UART function and baud configuration"
        icon={<Cable size={16} />}
        loading={loading}
        loadProgress={null}
        hasLoaded={hasLoaded}
        onRead={read}
        connected={connected}
        error={error}
      >
        {hasLoaded && (
          <Button
            variant="primary" size="sm" icon={<Upload size={12} />} loading={loading}
            disabled={!connected || !dirty || disabled}
            title={isArmed ? lockMessage : undefined}
            onClick={write}
          >
            Write to FC
          </Button>
        )}
      </PanelHeader>

      {dirty && (
        <p className="text-[10px] font-mono text-status-warning py-1">Unsaved changes : use Write to FC to save them to the flight controller.</p>
      )}
      {!dirty && needsReboot && (
        <p className="text-[10px] font-mono text-status-warning py-1">Saved. The flight controller applies port changes when it next reboots.</p>
      )}

      {hasLoaded && (
        <div className="space-y-3 mt-2">
          {ports.map((port, idx) => (
            <div key={port.identifier} className="border border-border-default p-3">
              <div className="text-xs font-mono font-semibold text-text-primary mb-2">{bfPortLabel(port.identifier)}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                {serialFunctions.map((fn) => (
                  <label key={fn.bit} className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={(port.functions & (1 << fn.bit)) !== 0}
                      onChange={(e) => toggleFunction(idx, fn.bit, e.target.checked)}
                    />
                    {fn.label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BAUD_FIELDS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-tertiary font-mono">{f.label} baud</span>
                    <Select
                      options={BAUD_OPTIONS}
                      value={String(port[f.key])}
                      onChange={(v) => updatePort(idx, { [f.key]: parseInt(v, 10) })}
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
