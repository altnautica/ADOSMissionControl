"use client";

/**
 * @module BluetoothPairModal
 * @description Phase 2 Bluetooth discovery and pairing modal. Runs a 10s scan,
 * lists discovered devices, and pairs the selected device via the agent.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";

const SCAN_DURATION_S = 10;

interface BluetoothPairModalProps {
  open: boolean;
  onClose: () => void;
}

export function BluetoothPairModal({ open, onClose }: BluetoothPairModalProps) {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const bluetooth = useGroundStationStore((s) => s.bluetooth);
  const scanBluetooth = useGroundStationStore((s) => s.scanBluetooth);
  const pairBluetooth = useGroundStationStore((s) => s.pairBluetooth);

  const { toast } = useToast();
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setProgress(0);
    }
  }, [open]);

  useEffect(() => {
    if (!bluetooth.scanning) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }
  }, [bluetooth.scanning]);

  const handleScan = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setProgress(0);
    const start = Date.now();
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / (SCAN_DURATION_S * 1000)) * 100);
      setProgress(pct);
      if (pct >= 100 && progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    }, 100);
    await scanBluetooth(client, SCAN_DURATION_S);
  };

  const handlePair = async (mac: string, name: string) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const ok = await pairBluetooth(client, mac);
    if (ok) {
      toast("Paired " + name, "success");
      onClose();
    } else {
      toast("Failed to pair " + name, "error");
    }
  };

  const hasAgent = Boolean(agentUrl);

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={bluetooth.scanning}>
        Close
      </Button>
      <Button
        variant="primary"
        onClick={handleScan}
        disabled={!hasAgent || bluetooth.scanning}
        loading={bluetooth.scanning}
      >
        {bluetooth.scanning ? "Scanning..." : "Scan"}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pair Bluetooth device"
      footer={footer}
      className="max-w-md"
    >
      {!hasAgent ? (
        <div className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          No ground station connected.
        </div>
      ) : (
        <div className="space-y-3">
          {bluetooth.scanning ? (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-text-secondary">Scanning for devices...</div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-bg-tertiary">
                <div
                  className="h-full bg-accent-primary transition-all"
                  style={{ width: progress + "%" }}
                />
              </div>
            </div>
          ) : null}

          {bluetooth.scan_results.length === 0 && !bluetooth.scanning ? (
            <div className="py-6 text-center text-xs text-text-secondary">
              Tap Scan to discover nearby devices.
            </div>
          ) : null}

          {bluetooth.scan_results.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs uppercase tracking-wide text-text-secondary">
                Scan results
              </div>
              <ul className="flex flex-col gap-1">
                {bluetooth.scan_results.map((dev) => {
                  const isPairing = bluetooth.pairing_mac === dev.mac;
                  return (
                    <li
                      key={dev.mac}
                      className="flex items-center justify-between rounded border border-border-primary/40 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm text-text-primary">{dev.name || "Unknown"}</span>
                        <span className="font-mono text-xs text-text-secondary">
                          {dev.mac}
                          {dev.rssi_dbm != null ? "  " + dev.rssi_dbm + " dBm" : ""}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handlePair(dev.mac, dev.name || dev.mac)}
                        loading={isPairing}
                        disabled={isPairing || bluetooth.scanning}
                      >
                        {isPairing ? "Pairing..." : "Pair"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {bluetooth.error ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
              {bluetooth.error}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
