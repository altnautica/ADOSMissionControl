"use client";

/**
 * @module command/nodes-view/StateCells
 * @description Battery and flight-state readouts for a board row.
 *
 * Both read the node's own telemetry snapshot and both defer to the row's
 * freshness: an unreachable node renders nothing rather than the last number it
 * sent. The mode readout is exported on its own because the actionable mode
 * control reuses it as its trigger label — the operator reads the same string
 * whether or not that row can be commanded.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { BatteryLow, BatteryMedium, BatteryFull } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import { useBatteryBand } from "@/lib/battery-bands";
import {
  UnknownValue,
  staleClass,
  type ReadingFreshness,
} from "./cell-primitives";

export function BatteryCell({
  telemetry,
  freshness,
}: {
  telemetry: CommandAgentSummary["telemetry"];
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("nodesView");
  const remaining = telemetry.batteryRemaining;
  // Severity comes from the operator's configured thresholds — the shared
  // resolver every fleet surface reads, so the board, the grid and the alert
  // pipeline agree on when a node's battery is a problem. Colour is never the
  // only channel: the icon changes with the band too.
  const band = useBatteryBand(remaining);

  if (freshness === "none") return <UnknownValue title={t("noLiveReading")} />;
  if (remaining == null || band === undefined) {
    return <UnknownValue title={t("battery.noReading")} />;
  }

  const Icon =
    band === "critical"
      ? BatteryLow
      : band === "warning"
        ? BatteryMedium
        : BatteryFull;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums",
        band === "critical"
          ? "text-status-error"
          : band === "warning"
            ? "text-status-warning"
            : "text-text-secondary",
        staleClass(freshness),
      )}
      title={
        telemetry.batteryVoltage != null
          ? t("battery.withVoltage", {
              volts: telemetry.batteryVoltage.toFixed(1),
            })
          : undefined
      }
    >
      <Icon size={12} />
      {remaining}%
    </span>
  );
}

/**
 * The node's flight mode plus its arm state. Both come from the node's own
 * telemetry; an unknown arm state is shown as unknown, never as disarmed.
 */
export function ModeReadout({
  telemetry,
  freshness,
}: {
  telemetry: CommandAgentSummary["telemetry"];
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("nodesView");

  if (freshness === "none" || telemetry.mode == null) {
    return (
      <UnknownValue
        title={
          freshness === "none" ? t("noLiveReading") : t("mode.noReading")
        }
      />
    );
  }

  const armed = telemetry.armed;

  return (
    <span className={cn("inline-flex items-center gap-1.5", staleClass(freshness))}>
      <span className="font-mono text-[11px] uppercase text-text-primary">
        {telemetry.mode}
      </span>
      {armed != null && (
        <span
          className={cn(
            "rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
            armed
              ? "bg-status-error/15 text-status-error"
              : "bg-bg-tertiary text-text-tertiary",
          )}
        >
          {armed ? t("armed") : t("disarmed")}
        </span>
      )}
    </span>
  );
}
