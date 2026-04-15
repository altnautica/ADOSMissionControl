"use client";

/**
 * @module HardwareGamepadsPage
 * @description Phase 2 Gamepads sub-view. Lists USB and Bluetooth gamepads,
 * lets the operator set a primary device, and surfaces the Bluetooth scan
 * and paired-devices lists.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { BluetoothPairModal } from "@/components/hardware/BluetoothPairModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const POLL_INTERVAL_MS = 2000;

export default function HardwareGamepadsPage() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const gamepads = useGroundStationStore((s) => s.gamepads);
  const bluetooth = useGroundStationStore((s) => s.bluetooth);
  const loadGamepads = useGroundStationStore((s) => s.loadGamepads);
  const applyPrimaryGamepad = useGroundStationStore((s) => s.applyPrimaryGamepad);
  const loadPairedBluetooth = useGroundStationStore((s) => s.loadPairedBluetooth);
  const forgetBluetooth = useGroundStationStore((s) => s.forgetBluetooth);

  const { toast } = useToast();
  const [pairOpen, setPairOpen] = useState(false);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const client = groundStationApiFromAgent(agentUrlRef.current, apiKeyRef.current);
      if (!client) return;
      if (cancelled) return;
      void loadGamepads(client);
      void loadPairedBluetooth(client);
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [loadGamepads, loadPairedBluetooth]);

  const handleSetPrimary = async (deviceId: string) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const ok = await applyPrimaryGamepad(client, deviceId);
    if (ok) {
      toast("Primary gamepad updated.", "success");
    } else {
      toast("Failed to update primary gamepad.", "error");
    }
  };

  const handleForget = async (mac: string, name: string) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const ok = await forgetBluetooth(client, mac);
    if (ok) {
      toast("Forgot " + name, "info");
    }
  };

  const hasAgent = Boolean(agentUrl);
  const formatType = (t: string) => {
    if (t === "usb") return "USB";
    if (t === "bluetooth") return "Bluetooth";
    return "Unknown";
  };

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link href="/hardware" className="hover:text-text-primary transition-colors">
            Hardware
          </Link>
          <span>/</span>
          <span>Gamepads</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">Gamepads</h1>

        <HardwareTabs />

        {!hasAgent ? (
          <div className="rounded-lg border border-border-primary bg-surface-secondary p-8 text-center text-sm text-text-secondary">
            No ground station connected.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Devices</h2>
                <Button variant="primary" size="sm" onClick={() => setPairOpen(true)}>
                  Scan Bluetooth
                </Button>
              </div>

              {gamepads.devices.length === 0 ? (
                <div className="py-6 text-center text-sm text-text-secondary">
                  No gamepads detected.
                </div>
              ) : (
                <div className="overflow-hidden rounded border border-border-primary">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Type</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamepads.devices.map((dev) => {
                        const isPrimary = dev.device_id === gamepads.primary_id;
                        return (
                          <tr key={dev.device_id} className="border-t border-border-primary/40">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-text-primary">{dev.name}</span>
                                {isPrimary ? (
                                  <span className="rounded border border-accent-primary/40 bg-accent-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary">
                                    Primary
                                  </span>
                                ) : null}
                              </div>
                              <div className="font-mono text-[10px] text-text-tertiary">
                                {dev.device_id}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-text-secondary">{formatType(dev.type)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  dev.connected
                                    ? "text-xs text-status-success"
                                    : "text-xs text-text-tertiary"
                                }
                              >
                                {dev.connected ? "Connected" : "Disconnected"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {!isPrimary ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleSetPrimary(dev.device_id)}
                                  disabled={!dev.connected}
                                >
                                  Set as primary
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-4 text-lg font-medium text-text-primary">Paired Bluetooth devices</h2>
              {bluetooth.paired.length === 0 ? (
                <div className="py-4 text-center text-sm text-text-secondary">
                  No paired Bluetooth devices.
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {bluetooth.paired.map((dev) => (
                    <li
                      key={dev.mac}
                      className="flex items-center justify-between rounded border border-border-primary/40 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm text-text-primary">{dev.name || "Unknown"}</span>
                        <span className="font-mono text-xs text-text-secondary">{dev.mac}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleForget(dev.mac, dev.name || dev.mac)}
                      >
                        Forget
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <BluetoothPairModal open={pairOpen} onClose={() => setPairOpen(false)} />
      </div>
    </div>
  );
}
