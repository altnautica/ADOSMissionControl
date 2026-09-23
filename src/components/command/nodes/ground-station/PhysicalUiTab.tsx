"use client";

/**
 * @module PhysicalUiTab
 * @description Command-tab home for the physical-UI surface (OLED
 * live card, Buttons, Screens — buttons and screens are read-only
 * in this build). Renders the physical-UI surface for a ground-station node.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BluetoothPairModal } from "@/components/hardware/BluetoothPairModal";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { LocalDisplayCard } from "@/components/hardware/LocalDisplayCard";
import { LcdPagePreview } from "@/components/hardware/LcdPagePreview";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { isDemoMode } from "@/lib/utils";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { useGroundStationStore } from "@/stores/ground-station-store";

const SLIDER_DEBOUNCE_MS = 300;

const DEFAULT_SCREEN_ORDER = ["Link", "Drone", "GCS", "Net", "System"];
const DEFAULT_BUTTONS = ["B1", "B2", "B3", "B4"];

export interface PhysicalUiTabProps {
  /** The node this tab is rendered for. Forwarded to the cards that WRITE the
   * node's config so the write cannot land on the previously focused node. */
  nodeDeviceId: string | null;
}

export function PhysicalUiTab({ nodeDeviceId }: PhysicalUiTabProps) {
  // The transport is this node's own connection, never the ambient one: the
  // focused connection lags the render on a node switch, so reading it would
  // load (and later write) the previously shown node.
  const direct = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  const client = useMemo(
    () => groundStationApiFromAgent(agentUrl, apiKey),
    [agentUrl, apiKey],
  );

  const storeUi = useGroundStationStore((s) => s.ui);
  const uiFor = useGroundStationStore((s) => s.uiFor);
  const ui = client && uiFor === client.baseUrl ? storeUi : null;
  const lastError = useGroundStationStore((s) => s.lastError);
  const loadUi = useGroundStationStore((s) => s.loadUi);
  const applyOled = useGroundStationStore((s) => s.applyOled);
  const storeBluetooth = useGroundStationStore((s) => s.bluetooth);
  const pairedDevices =
    client && storeBluetooth.pairedFor === client.baseUrl ? storeBluetooth.paired : [];
  const loadPairedBluetooth = useGroundStationStore((s) => s.loadPairedBluetooth);
  const forgetBluetooth = useGroundStationStore((s) => s.forgetBluetooth);

  const t = useTranslations("hardware");

  const { toast } = useToast();
  const [btPairOpen, setBtPairOpen] = useState(false);

  const [brightness, setBrightness] = useState<number>(128);
  const [autoDim, setAutoDim] = useState<boolean>(true);
  const [cycleSeconds, setCycleSeconds] = useState<number>(10);

  const clientRef = useRef(client);
  clientRef.current = client;

  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load this node's UI config and seed the OLED controls from THIS load's
  // result (never from whatever the shared store held for another node).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void loadUi(client).then((loaded) => {
      if (cancelled || !loaded) return;
      setBrightness(loaded.oled.brightness);
      setAutoDim(loaded.oled.auto_dim_enabled);
      setCycleSeconds(loaded.oled.screen_cycle_seconds);
    });
    void loadPairedBluetooth(client);
    return () => {
      cancelled = true;
    };
  }, [client, loadUi, loadPairedBluetooth]);

  // The client for a write. Demo mode has a truthy agent URL but no REST
  // endpoint, so a write there says it is inert instead of doing nothing.
  const writeClient = () => {
    const current = clientRef.current;
    if (!current && isDemoMode()) toast(t("demoReadOnly"), "info");
    return current;
  };

  const handleForgetBt = async (mac: string, name: string) => {
    const current = writeClient();
    if (!current) return;
    const ok = await forgetBluetooth(current, mac);
    if (ok) toast("Forgot " + name, "info");
  };

  const sendOled = async (update: {
    brightness?: number;
    auto_dim_enabled?: boolean;
    screen_cycle_seconds?: number;
  }) => {
    const current = writeClient();
    if (!current) return;
    await applyOled(current, update);
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

  const hasAgent = direct !== null;
  const buttonEntries = ui?.buttons ?? {};
  const buttonIds = DEFAULT_BUTTONS;
  const screenOrder = ui?.screens.order ?? DEFAULT_SCREEN_ORDER;
  const enabledScreens = new Set(ui?.screens.enabled ?? DEFAULT_SCREEN_ORDER);

  if (!hasAgent) {
    return (
      <div className="flex flex-col">
        <PageIntro
          title={t("physicalUi")}
          description="Live preview of the OLED screen and four front buttons on the ground station box. Pair Bluetooth peripherals here too."
        />
        <CloudModeLimitedNotice feature="physicalUi" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageIntro
        title={t("physicalUi")}
        description="Live preview of the OLED screen and four front buttons on the ground station box. Pair Bluetooth peripherals here too."
      />
      <div className="flex flex-col gap-4">
      {/* SPI LCD card + live thumbnail. Both hidden when no /dev/fb1
          panel is bound on the agent. Companion-board LCDs (Cubie A7Z,
          Rock 5C with Waveshare 3.5") render here. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LocalDisplayCard nodeDeviceId={nodeDeviceId} relayReach={null} />
        </div>
        <div>
          <LcdPagePreview />
        </div>
      </div>

      {/* OLED card */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium text-text-primary">{t("oled.title")}</h2>
          <HintChip>Refreshes once per second</HintChip>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="oled-brightness" className="text-xs text-text-secondary">
                {t("oled.brightness")}
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
              className="w-full accent-accent-primary focus-ring"
            />
          </div>

          <Toggle
            label={t("oled.autoDim")}
            checked={autoDim}
            onChange={handleAutoDim}
          />

          <div className="flex flex-col gap-1">
            <label htmlFor="oled-cycle" className="text-xs text-text-secondary">
              {t("oled.cycleSeconds")}
            </label>
            <input
              id="oled-cycle"
              type="number"
              min={1}
              max={60}
              step={1}
              value={cycleSeconds}
              onChange={(e) => handleCycle(Number(e.target.value))}
              className="w-28 h-8 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary focus-ring focus:border-accent-primary transition-colors"
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
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium text-text-primary">{t("buttons.title")}</h2>
          <HintChip>Long-press is remappable. Short-press is fixed by profile.</HintChip>
        </div>
        <div className="overflow-hidden rounded border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Button</th>
                <th className="px-3 py-2 text-left">{t("buttons.shortPress")}</th>
                <th className="px-3 py-2 text-left">{t("buttons.longPress")}</th>
              </tr>
            </thead>
            <tbody>
              {buttonIds.map((id) => {
                const binding = buttonEntries[id] ?? {};
                return (
                  <tr key={id} className="border-t border-border-default">
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
          {t("buttons.readOnlyNote")}
        </p>
      </section>

      {/* Screens card (read-only) */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <h2 className="mb-4 text-lg font-medium text-text-primary">{t("screens.title")}</h2>
        <ol className="space-y-1">
          {screenOrder.map((name, idx) => (
            <li
              key={name}
              className="flex items-center justify-between rounded border border-border-default px-3 py-2 text-sm"
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
          {t("screens.readOnlyNote")}
        </p>
      </section>

      {/* Bluetooth pairing */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-text-primary">{t("bluetooth.title")}</h2>
          <Button variant="primary" size="sm" onClick={() => setBtPairOpen(true)}>
            {t("bluetooth.pairNewDevice")}
          </Button>
        </div>
        {pairedDevices.length === 0 ? (
          <div className="py-4 text-center text-sm text-text-secondary">
            No paired Bluetooth devices.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {pairedDevices.map((dev) => (
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
                  onClick={() => handleForgetBt(dev.mac, dev.name || dev.mac)}
                >
                  {t("bluetooth.forget")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BluetoothPairModal open={btPairOpen} onClose={() => setBtPairOpen(false)} />
      </div>
    </div>
  );
}
