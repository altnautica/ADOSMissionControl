"use client";

/**
 * @module PhysicalUiTab
 * @description Command-tab home for the physical-UI surface (OLED
 * live card, Buttons, Screens — the button mapping is editable, the screen
 * list read-only in this build). Shared by every node with a front panel
 * (ground station, Visor).
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
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import {
  PANEL_BUTTON_DEFAULTS,
  PANEL_SCREEN_DEFAULTS,
  type PanelProfile,
  type UiConfig,
} from "@/lib/api/ground-station/types/ui";
import { isDemoMode } from "@/lib/utils";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { ButtonMappingCard } from "./ButtonMappingCard";

const SLIDER_DEBOUNCE_MS = 300;

export interface PhysicalUiTabProps {
  /** The node this tab is rendered for. Forwarded to the cards that WRITE the
   * node's config so the write cannot land on the previously focused node. */
  nodeDeviceId: string | null;
  /** The node's panel profile: whose button and screen defaults apply. */
  profile: PanelProfile;
}

/** The demo node's panel config. The demo seed is a ground station's; a demo
 * Visor shows the Visor's own defaults under the seeded brightness. */
export function demoUi(seed: UiConfig | null, profile: PanelProfile): UiConfig | null {
  if (profile === "ground_station") return seed;
  const screens = [...PANEL_SCREEN_DEFAULTS[profile]];
  return {
    oled: seed?.oled ?? { brightness: 204 },
    buttons: { mapping: { ...PANEL_BUTTON_DEFAULTS[profile] } },
    screens: { order: screens, enabled: screens },
  };
}

export function PhysicalUiTab({ nodeDeviceId, profile }: PhysicalUiTabProps) {
  const tk = useTranslations("command.physicalUiTab");
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
  // Demo mode has no REST endpoint behind its agent URL, so the seeded config
  // is the node's config there.
  const demo = isDemoMode();
  const demoConfig = useMemo(() => demoUi(storeUi, profile), [storeUi, profile]);
  const ui = demo ? demoConfig : client && uiFor === client.baseUrl ? storeUi : null;
  const lastError = useGroundStationStore((s) => s.lastError);
  const loadUi = useGroundStationStore((s) => s.loadUi);
  const applyOled = useGroundStationStore((s) => s.applyOled);
  const applyButtons = useGroundStationStore((s) => s.applyButtons);
  const storeBluetooth = useGroundStationStore((s) => s.bluetooth);
  const pairedDevices =
    client && storeBluetooth.pairedFor === client.baseUrl ? storeBluetooth.paired : [];
  const loadPairedBluetooth = useGroundStationStore((s) => s.loadPairedBluetooth);
  const forgetBluetooth = useGroundStationStore((s) => s.forgetBluetooth);

  const t = useTranslations("hardware");

  const { toast } = useToast();
  const [btPairOpen, setBtPairOpen] = useState(false);

  const [brightness, setBrightness] = useState<number>(128);

  const clientRef = useRef(client);
  clientRef.current = client;

  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load this node's UI config and seed the OLED controls from THIS load's
  // result (never from whatever the shared store held for another node).
  useEffect(() => {
    // Demo seeds from the demo config whether or not a client resolves.
    if (demo && demoConfig) setBrightness(demoConfig.oled.brightness);
    if (!client) return;
    let cancelled = false;
    if (!demo) {
      void loadUi(client).then((loaded) => {
        if (cancelled || !loaded) return;
        setBrightness(loaded.oled.brightness);
      });
    }
    void loadPairedBluetooth(client);
    return () => {
      cancelled = true;
    };
  }, [client, demo, demoConfig, loadUi, loadPairedBluetooth]);

  // The client for a write. Demo mode has a truthy agent URL but no REST
  // endpoint, so a write there says it is inert instead of doing nothing.
  const writeClient = () => {
    if (demo) {
      toast(t("demoReadOnly"), "info");
      return null;
    }
    return clientRef.current;
  };

  const handleForgetBt = async (mac: string, name: string) => {
    const current = writeClient();
    if (!current) return;
    const ok = await forgetBluetooth(current, mac);
    if (ok) toast(tk("forgot") + name, "info");
  };

  const sendOled = async (update: { brightness?: number }) => {
    const current = writeClient();
    if (!current) return;
    await applyOled(current, update);
  };

  const saveButtons = async (overrides: Record<string, string>) => {
    const current = writeClient();
    if (!current) return;
    const saved = await applyButtons(current, overrides);
    if (saved) toast(t("buttons.saved"), "success");
  };

  const handleBrightness = (v: number) => {
    setBrightness(v);
    if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    brightnessTimerRef.current = setTimeout(() => {
      sendOled({ brightness: v });
    }, SLIDER_DEBOUNCE_MS);
  };

  const hasAgent = direct !== null;
  const screenOrder = ui?.screens.order ?? PANEL_SCREEN_DEFAULTS[profile];
  const enabledScreens = new Set(ui?.screens.enabled ?? PANEL_SCREEN_DEFAULTS[profile]);

  if (!hasAgent) {
    return (
      <div className="flex flex-col">
        <PageIntro
          title={t("physicalUi")}
          description={t("physicalUiPage.neutralDescription")}
        />
        <CloudModeLimitedNotice feature="physicalUi" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageIntro
        title={t("physicalUi")}
        description={t("physicalUiPage.neutralDescription")}
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
          <HintChip>{tk("refreshesOncePerSecond")}</HintChip>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="oled-brightness" className="text-xs text-text-secondary">
                {t("oled.contrast")}
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

          {lastError ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
              {lastError}
            </div>
          ) : null}
        </div>
      </section>

      <ButtonMappingCard
        profile={profile}
        mapping={ui?.buttons.mapping ?? null}
        onSave={saveButtons}
      />

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
            {tk("noPairedBluetoothDevices")}
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
