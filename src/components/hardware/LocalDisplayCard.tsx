"use client";

/**
 * @module LocalDisplayCard
 * @description Renders the SPI LCD attached to the ground-station
 * companion board (e.g. Waveshare 3.5" RPi LCD on Cubie A7Z or Rock 5C)
 * plus the effective-primary-path picker. The peripheral-status block
 * stays gated on a bound LCD; the picker shows on every ground-station
 * agent so the operator can swap between HDMI / LCD / none / auto-detect
 * without an SPI panel being present. Touch calibration status, theme,
 * last-touch age, and active page stay under the bound-LCD gate. The
 * "Calibrate touch" button requests the on-device calibration wizard;
 * the operator taps the crosshairs on the panel itself, and the status
 * pill reflects the result from the next heartbeat.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import {
  directClientForNode,
  resolveConfigAccess,
  setConfigValueViaAccess,
} from "@/lib/agent/config-access";
import { configWriteFailure } from "@/lib/agent/config-write";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";

/** Format an absolute epoch ms into a short relative string. */
function formatLastTouch(ts: number | undefined): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs} s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `${days} d`;
}

export interface LocalDisplayCardProps {
  /** The node this card is rendered for. The renderer override is a config
   * WRITE, so its transport resolves from this id — the attached client serves
   * the FOCUSED node and focus lags the render, so an ambient write can retire
   * the display on a different box. */
  nodeDeviceId: string | null;
}

export function LocalDisplayCard({ nodeDeviceId }: LocalDisplayCardProps) {
  const display = useAgentCapabilitiesStore((s) => s.display);
  const displayType = useAgentCapabilitiesStore((s) => s.displayType);
  const uiTheme = useAgentCapabilitiesStore((s) => s.uiTheme);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);
  const storeClient = useAgentConnectionStore((s) => s.client);
  const attachedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const t = useTranslations("hardware.localDisplay");
  const { toast } = useToast();

  // The direct client ONLY when it is this node's. `startDisplayCalibration`
  // is a direct-only endpoint (the server-side config proxy forwards a fixed
  // path map that does not include it), so it needs the client itself;
  // calibrating a different box's panel is the same class of mistake as
  // writing its config.
  const nodeClient = directClientForNode(
    storeClient,
    attachedDeviceId,
    nodeDeviceId,
  );
  // This node's own config lane: its direct client when the attached one
  // serves it, else the server-side proxy against its stored LAN pairing.
  const access = resolveConfigAccess(nodeClient, nodeDeviceId, {
    localNodes,
    pairedDrones,
  });

  const [calibrating, setCalibrating] = useState(false);
  // The override picker holds an operator-pending selection until the
  // PUT /config round-trip lands. While `pending` is non-null we render
  // it as the picker's value; once the agent echoes a new resolved
  // displayType (or the request fails), we clear `pending` so the picker
  // tracks the agent again.
  const [pendingOverride, setPendingOverride] = useState<string | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);

  // Clear the pending selection once the agent's reported displayType
  // matches it. For "auto" we wait for the resolved value the agent
  // probes; the next agent-side displayType ("hdmi" | "lcd" | "none")
  // is the confirmation. For a concrete pick the agent should echo the
  // same string back.
  useEffect(() => {
    if (pendingOverride == null) return;
    if (!displayType) return;
    if (pendingOverride === "auto") {
      // Any concrete resolution clears the pending "auto" selection.
      if (
        displayType === "hdmi" ||
        displayType === "lcd" ||
        displayType === "none"
      ) {
        setPendingOverride(null);
      }
      return;
    }
    if (displayType === pendingOverride) {
      setPendingOverride(null);
    }
  }, [displayType, pendingOverride]);

  // Wait for at least one capability payload before rendering.
  if (!loaded) return null;

  // If neither the SPI LCD peripheral nor the displayType enrichment is
  // present, render nothing. This covers stock drone agents and ground
  // stations on older agent versions that predate both surfaces.
  const hasBoundDisplay =
    display !== undefined && display.type !== "none";
  const hasDisplayTypeField = displayType !== undefined && displayType !== null;
  if (!hasBoundDisplay && !hasDisplayTypeField) {
    return null;
  }

  // Resolve the picker's current value. Operator selection wins; if no
  // selection is pending we mirror the agent's resolved value (or fall
  // back to "auto" when the agent hasn't reported yet).
  const overrideValue: string =
    pendingOverride ?? (displayType && displayType !== null ? displayType : "auto");

  const overrideOptions: SelectOption[] = [
    { value: "auto", label: t("override.auto") },
    { value: "hdmi", label: t("override.hdmi") },
    { value: "lcd", label: t("override.lcd") },
    { value: "none", label: t("override.none") },
  ];

  const effectiveLabel = (() => {
    if (!hasDisplayTypeField) return t("effectiveUnknown");
    switch (displayType) {
      case "hdmi":
        return t("override.hdmi");
      case "lcd":
        return t("override.lcd");
      case "none":
        return t("override.none");
      case "auto":
        return t("effectiveAutoDetecting");
      default:
        return t("effectiveUnknown");
    }
  })();

  const onOverrideChange = async (next: string) => {
    if (access.mode === "none" || overrideSaving) return;
    if (next === overrideValue) return;
    setPendingOverride(next);
    setOverrideSaving(true);
    try {
      const res = await setConfigValueViaAccess(
        access,
        "ground_station.display.type",
        next,
      );
      // Both halves of the agent's 200-means-nothing contract: a rejected
      // value, and a value taken in RAM the agent could not write to disk.
      // The display service reads this key at boot, so a RAM-only write is a
      // renderer choice that silently reverts at the next start.
      const failure = configWriteFailure(res);
      if (failure) throw new Error(failure);
      toast(t("overrideSaved"), "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("overrideError");
      toast(msg, "error");
      // Clear the pending selection so the picker snaps back to the
      // agent-reported value on the next render.
      setPendingOverride(null);
    } finally {
      setOverrideSaving(false);
    }
  };

  // Local helpers below are only meaningful when a peripheral is bound.
  const typeLabel = !hasBoundDisplay
    ? ""
    : display!.type === "spi-lcd"
      ? t("spiLcd")
      : display!.type === "hdmi"
        ? t("hdmi")
        : display!.type;

  const lastTouchStr = hasBoundDisplay
    ? formatLastTouch(display!.lastTouchAt)
    : null;

  const calibrationPill = !hasBoundDisplay
    ? null
    : (() => {
        if (!display!.hasTouch) {
          return (
            <Tooltip content={t("noTouch")}>
              <span className="rounded bg-text-tertiary/15 px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
                {t("noTouch")}
              </span>
            </Tooltip>
          );
        }
        if (display!.touchCalibrated === true) {
          return (
            <Tooltip content={t("calibratedTooltip")}>
              <span className="rounded bg-status-success/15 px-2 py-0.5 text-[11px] font-medium text-status-success">
                {t("calibrated")}
              </span>
            </Tooltip>
          );
        }
        return (
          <Tooltip content={t("uncalibratedTooltip")}>
            <span className="rounded bg-status-warning/15 px-2 py-0.5 text-[11px] font-medium text-status-warning">
              {t("uncalibrated")}
            </span>
          </Tooltip>
        );
      })();

  const themePill =
    uiTheme === "light" || uiTheme === "dark" ? (
      <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
        {uiTheme === "light" ? t("themeLight") : t("themeDark")}
      </span>
    ) : null;

  const onCalibrate = async () => {
    if (!nodeClient || calibrating) return;
    setCalibrating(true);
    try {
      await nodeClient.startDisplayCalibration();
      toast(t("calibrateStarted"), "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("calibrateError");
      toast(msg, "error");
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <section className="mb-4 rounded border border-border-default bg-bg-secondary">
      <header className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-accent-primary" />
          <h2 className="text-sm font-display font-semibold text-text-primary">
            {t("title")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasBoundDisplay ? (
            <span
              className={
                display!.hasTouch
                  ? "rounded bg-status-success/15 px-2 py-0.5 text-[11px] font-medium text-status-success"
                  : "rounded bg-text-tertiary/15 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
              }
            >
              {display!.hasTouch ? t("touchEnabled") : t("touchDisabled")}
            </span>
          ) : null}
          {calibrationPill}
          {themePill}
        </div>
      </header>

      {/* Effective primary local-display path picker. Shown on every
          ground station so the operator can swap between HDMI / LCD /
          none / auto-detect even when no SPI panel is bound. The agent
          reflects the new value in its next heartbeat via displayType. */}
      <div className="border-b border-border-default px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
              {t("effectivePrimary")}
            </div>
            <div className="mt-0.5 text-sm text-text-primary">
              {effectiveLabel}
            </div>
          </div>
          <div className="min-w-[180px]">
            <Select
              label={t("override.label")}
              options={overrideOptions}
              value={overrideValue}
              onChange={(next) => {
                void onOverrideChange(next);
              }}
              disabled={access.mode === "none" || overrideSaving}
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-text-tertiary">{t("overrideNote")}</p>
      </div>

      {hasBoundDisplay ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-xs text-text-secondary sm:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
              {t("typeLabel")}
            </dt>
            <dd className="mt-0.5 text-text-primary">{typeLabel}</dd>
          </div>
          {display!.controller ? (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {t("controller")}
              </dt>
              <dd className="mt-0.5 text-text-primary">{display!.controller}</dd>
            </div>
          ) : null}
          {display!.resolution ? (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {t("resolution")}
              </dt>
              <dd className="mt-0.5 text-text-primary">{display!.resolution}</dd>
            </div>
          ) : null}
          {display!.rotation !== undefined ? (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {t("rotation")}
              </dt>
              <dd className="mt-0.5 text-text-primary">
                {display!.rotation}&deg;
              </dd>
            </div>
          ) : null}
          {lastTouchStr ? (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {t("lastTouch")}
              </dt>
              <dd className="mt-0.5 text-text-primary">
                {t("lastTouchAgo", { value: lastTouchStr })}
              </dd>
            </div>
          ) : null}
          {display!.activePage ? (
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {t("activePage")}
              </dt>
              <dd className="mt-0.5 font-mono text-text-primary">
                {display!.activePage}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {hasBoundDisplay && display!.hasTouch ? (
        <footer className="flex items-center justify-end border-t border-border-default px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCalibrate}
            disabled={!nodeClient || calibrating}
          >
            {t("calibrateButton")}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
