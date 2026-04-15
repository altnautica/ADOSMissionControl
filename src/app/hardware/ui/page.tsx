"use client";

/**
 * @module HardwareUiPage
 * @description Phase 1 Physical UI sub-view. OLED live card, Buttons and
 * Screens are read-only placeholders (remapping and reorder ship in Phase 2).
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { BluetoothPairModal } from "@/components/hardware/BluetoothPairModal";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const SLIDER_DEBOUNCE_MS = 300;

const DEFAULT_SCREEN_ORDER = ["Link", "Drone", "GCS", "Net", "System"];
const DEFAULT_BUTTONS = ["B1", "B2", "B3", "B4"];

export default function HardwareUiPage() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const ui = useGroundStationStore((s) => s.ui);
  const lastError = useGroundStationStore((s) => s.lastError);
  const loadUi = useGroundStationStore((s) => s.loadUi);
  const applyOled = useGroundStationStore((s) => s.applyOled);
  const bluetooth = useGroundStationStore((s) => s.bluetooth);
  const loadPairedBluetooth = useGroundStationStore((s) => s.loadPairedBluetooth);
  const forgetBluetooth = useGroundStationStore((s) => s.forgetBluetooth);

  const { toast } = useToast();
  const [btPairOpen, setBtPairOpen] = useState(false);

  const [brightness, setBrightness] = useState<number>(128);
  const [autoDim, setAutoDim] = useState<boolean>(true);
  const [cycleSeconds, setCycleSeconds] = useState<number>(10);
  const [initialised, setInitialised] = useState(false);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    loadUi(client);
    loadPairedBluetooth(client);
  }, [agentUrl, apiKey, loadUi, loadPairedBluetooth]);

  const handleForgetBt = async (mac: string, name: string) => {
    const client = groundStationApiFromAgent(agentUrlRef.current, apiKeyRef.current);
    if (!client) return;
    const ok = await forgetBluetooth(client, mac);
    if (ok) toast("Forgot " + name, "info");
  };

  useEffect(() => {
    if (!ui || initialised) return;
    setBrightness(ui.oled.brightness);
    setAutoDim(ui.oled.auto_dim_enabled);
    setCycleSeconds(ui.oled.screen_cycle_seconds);
    setInitialised(true);
  }, [ui, initialised]);

  const sendOled = async (update: {
    brightness?: number;
    auto_dim_enabled?: boolean;
    screen_cycle_seconds?: number;
  }) => {
    const client = groundStationApiFromAgent(agentUrlRef.current, apiKeyRef.current);
    if (!client) return;
    await applyOled(client, update);
  };

  const handleBrightness = (v: number) => {
    setBrightness(v);
    if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    brightnessTimerRef.current = setTimeout(() => {
      sendOled({ brightness: v });
    }, SLIDER_DEBOUNCE_MS);
  };

  const handleAutoDim = (v: boolean) => {
    setAutoDim(v);
    sendOled({ auto_dim_enabled: v });
  };

  const handleCycle = (v: number) => {
    const clamped = Math.max(1, Math.min(60, Math.floor(v)));
    setCycleSeconds(clamped);
    sendOled({ screen_cycle_seconds: clamped });
  };

  const hasAgent = Boolean(agentUrl);
  const buttonEntries = ui?.buttons ?? {};
  const buttonIds = DEFAULT_BUTTONS;
  const screenOrder = ui?.screens.order ?? DEFAULT_SCREEN_ORDER;
  const enabledScreens = new Set(ui?.screens.enabled ?? DEFAULT_SCREEN_ORDER);

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link href="/hardware" className="hover:text-text-primary transition-colors">
            Hardware
          </Link>
          <span>/</span>
          <span>Physical UI</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">Physical UI</h1>

        <HardwareTabs />

        {!hasAgent ? (
          <div className="rounded-lg border border-border-primary bg-surface-secondary p-8 text-center text-sm text-text-secondary">
            No ground station connected.
          </div>
        ) : null}

        {hasAgent ? (
          <div className="flex flex-col gap-5">
            {/* OLED card */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-4 text-lg font-medium text-text-primary">OLED Display</h2>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="oled-brightness" className="text-xs text-text-secondary">
                      Brightness
                    </label>
                    <span className="font-mono text-xs text-text-primary">{brightness}</span>
                  </div>
                  <input
                    id="oled-brightness"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={brightness}
                    onChange={(e) => handleBrightness(Number(e.target.value))}
                    className="w-full accent-accent-primary"
                  />
                </div>

                <Toggle
                  label="Auto-dim after 60 s idle"
                  checked={autoDim}
                  onChange={handleAutoDim}
                />

                <div className="flex flex-col gap-1">
                  <label htmlFor="oled-cycle" className="text-xs text-text-secondary">
                    Cycle interval (seconds)
                  </label>
                  <input
                    id="oled-cycle"
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={cycleSeconds}
                    onChange={(e) => handleCycle(Number(e.target.value))}
                    className="w-28 h-8 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                  />
                </div>

                {lastError ? (
                  <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                    {lastError}
                  </div>
                ) : null}
              </div>
            </section>

            {/* Buttons card (read-only) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-4 text-lg font-medium text-text-primary">Buttons</h2>
              <div className="overflow-hidden rounded border border-border-primary">
                <table className="w-full text-sm">
                  <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Button</th>
                      <th className="px-3 py-2 text-left">Short press</th>
                      <th className="px-3 py-2 text-left">Long press</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buttonIds.map((id) => {
                      const binding = buttonEntries[id] ?? {};
                      return (
                        <tr key={id} className="border-t border-border-primary/40">
                          <td className="px-3 py-2 font-mono text-text-primary">{id}</td>
                          <td className="px-3 py-2 text-text-secondary">
                            {binding.short_press ?? "unassigned"}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">
                            {binding.long_press ?? "unassigned"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Remapping ships in Phase 2.
              </p>
            </section>

            {/* Screens card (read-only) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-4 text-lg font-medium text-text-primary">Screens</h2>
              <ol className="space-y-1">
                {screenOrder.map((name, idx) => (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded border border-border-primary/40 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-text-primary">
                      {idx + 1}. {name}
                    </span>
                    <span
                      className={
                        enabledScreens.has(name)
                          ? "text-xs text-status-success"
                          : "text-xs text-text-tertiary"
                      }
                    >
                      {enabledScreens.has(name) ? "enabled" : "disabled"}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-text-secondary">
                Enable and reorder ships in Phase 2.
              </p>
            </section>

            {/* Bluetooth card (Phase 2, Wave C) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Bluetooth</h2>
                <Button variant="primary" size="sm" onClick={() => setBtPairOpen(true)}>
                  Pair new device
                </Button>
              </div>
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
                        onClick={() => handleForgetBt(dev.mac, dev.name || dev.mac)}
                      >
                        Forget
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        <BluetoothPairModal open={btPairOpen} onClose={() => setBtPairOpen(false)} />
      </div>
    </div>
  );
}
