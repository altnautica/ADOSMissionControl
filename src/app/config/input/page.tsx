"use client";

/**
 * @module InputDevicesPage
 * @description Unified Input Devices settings. Combines agent-side device
 * list (USB/Bluetooth gamepads, joysticks, HOTAS) with browser-side
 * Web Gamepad API calibration and tuning.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { BluetoothPairModal } from "@/components/hardware/BluetoothPairModal";
import { ControllersSection } from "@/components/hardware/ControllersSection";
import { SkillBindingsSection } from "@/components/config/SkillBindingsSection";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useSettingsStore } from "@/stores/settings-store";
import { registerBuiltins } from "@/lib/skills";

const POLL_INTERVAL_MS = 2000;

export default function InputDevicesPage() {
  const t = useTranslations("status");
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

  const autoClaim = useSettingsStore((s) => s.hudAutoClaimPicOnFirstButton);
  const setAutoClaim = useSettingsStore((s) => s.setHudAutoClaimPicOnFirstButton);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  // The bindings section resolves skill labels from the registry; register the
  // built-ins so the labels render even though this page is outside the cockpit
  // shell. Idempotent.
  useEffect(() => {
    registerBuiltins();
  }, []);

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
      toast("Primary controller updated.", "success");
    } else {
      toast("Failed to update primary controller.", "error");
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

  const formatDeviceType = (name: string, type: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes("hotas") || lower.includes("throttle")) return "HOTAS";
    if (lower.includes("joystick") || lower.includes("stick")) return "Joystick";
    if (lower.includes("wheel") || lower.includes("racing")) return "Wheel";
    return "Gamepad";
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl flex flex-col">
        <PageIntro
          title="Controllers"
          description="Game controllers, joysticks, and HOTAS devices connected to the ground station agent or directly to your browser."
        />
        <div className="flex flex-col gap-4">
        {/* Agent-side device list */}
        {hasAgent ? (
          <>
            <section className="rounded border border-border-default bg-bg-secondary p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium text-text-primary">Devices</h2>
                  <HintChip>Set a primary controller to send sticks to the drone.</HintChip>
                </div>
                <Button variant="primary" size="sm" onClick={() => setPairOpen(true)}>
                  Scan Bluetooth
                </Button>
              </div>

              {gamepads.devices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Gamepad2 className="h-6 w-6 text-text-tertiary" />
                  <p className="text-sm text-text-secondary">
                    No controllers detected.
                  </p>
                  <p className="max-w-xs text-xs text-text-tertiary">
                    Connect a USB or Bluetooth gamepad, joystick, or HOTAS to the ground station.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded border border-border-default">
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Device</th>
                        <th className="px-3 py-2 text-left">Connection</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamepads.devices.map((dev) => {
                        const isPrimary = dev.device_id === gamepads.primary_id;
                        return (
                          <tr key={dev.device_id} className="border-t border-border-default">
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
                            <td className="px-3 py-2 text-text-secondary">
                              {formatDeviceType(dev.name, dev.type)}
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
                                {dev.connected ? t("connected") : t("disconnected")}
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
                </div>
              )}
            </section>

            <section className="rounded border border-border-default bg-bg-secondary p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium text-text-primary">HDMI kiosk auto-claim</h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    Auto-claim PIC on first button press from the HDMI kiosk. Off by default
                    so that standalone kiosks do not silently take control.
                  </p>
                </div>
                <Toggle
                  label={autoClaim ? "Enabled" : "Disabled"}
                  checked={autoClaim}
                  onChange={setAutoClaim}
                />
              </div>
            </section>

            <section className="rounded border border-border-default bg-bg-secondary p-5">
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
                      className="flex items-center justify-between rounded border border-border-default px-3 py-2"
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
          </>
        ) : null}

        {/* Browser-side calibration and tuning (always available) */}
        <section className="rounded border border-border-default bg-bg-secondary p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-text-primary">Browser Input</h2>
            <HintChip>Browser controllers only feed sticks while this tab is open.</HintChip>
          </div>
          <p className="mb-4 text-xs text-text-secondary">
            Calibrate and tune controllers connected directly to this browser via the Web Gamepad API.
          </p>
          <ControllersSection />
        </section>

        {/* Cockpit skill / keyboard bindings for the active loadout. */}
        <SkillBindingsSection />

        <BluetoothPairModal open={pairOpen} onClose={() => setPairOpen(false)} />
        </div>
      </div>
    </div>
  );
}
