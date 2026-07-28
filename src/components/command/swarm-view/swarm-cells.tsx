"use client";

/**
 * @module command/swarm-view/swarm-cells
 * @description The swarm board's readout cells.
 *
 * Every one of them defers to the row's beacon freshness the way the nodes
 * board defers to node liveness: a fresh reading shows plainly, a stale one is
 * dimmed, and a slot the bus has not heard from shows nothing at all rather
 * than the last numbers it happened to send before it went quiet. A dash here
 * always carries the reason it is a dash.
 *
 * The four independent status bits live next door in `SwarmConditionsCell`,
 * which has its own rule about never blending them.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Crosshair,
  Signal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useBatteryBand } from "@/lib/battery-bands";
import {
  Chip,
  NEUTRAL_CHIP,
  UnknownValue,
  staleClass,
  type ReadingFreshness,
} from "@/components/command/nodes-view/cell-primitives";
import type { SwarmModePrecedence } from "@/stores/swarm-beacon-store";
import { SWARM_WEAK_RSSI_DBM, type SwarmSlotRow } from "./swarm-rows";

/**
 * The precedence levels, tinted by how much authority has been taken away from
 * the operator. `hard-separation` is the safety layer overriding everything
 * else and reads as an error, because that is what the operator must notice:
 * the drone is no longer doing what they asked.
 */
const PRECEDENCE_CHIP: Record<SwarmModePrecedence, string> = {
  "hard-separation": "border-status-error/50 bg-status-error/10 text-status-error",
  operator: "border-accent-primary/50 bg-accent-primary/10 text-accent-primary",
  formation: NEUTRAL_CHIP,
  flocking: NEUTRAL_CHIP,
  hold: "border-border-default bg-bg-tertiary text-text-tertiary",
};

/** i18n keys cannot carry the hyphen the wire value uses. */
const PRECEDENCE_KEY: Record<SwarmModePrecedence, string> = {
  "hard-separation": "hardSeparation",
  operator: "operator",
  formation: "formation",
  flocking: "flocking",
  hold: "hold",
};

/**
 * The level that is ACTUALLY governing the aircraft, not the one it was told to
 * fly. A drone whose separation layer has taken over reads `hard-separation`
 * here even though the operator commanded `formation` — mode-transition
 * ambiguity, an operator believing one mode governs while another does, is
 * implicated across the supervisory-control loss literature.
 */
export function PrecedenceCell({
  row,
  freshness,
}: {
  row: SwarmSlotRow;
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("swarmView.precedence");
  const precedence = row.beacon?.modePrecedence;

  if (!precedence) return <UnknownValue title={t("unknown")} />;

  return (
    <Chip
      className={cn(PRECEDENCE_CHIP[precedence], staleClass(freshness))}
      title={t("active")}
    >
      {t(PRECEDENCE_KEY[precedence])}
    </Chip>
  );
}

export function BatteryCell({
  row,
  freshness,
}: {
  row: SwarmSlotRow;
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("swarmView.table");
  const remaining = row.summary?.telemetry.batteryRemaining ?? null;
  // The operator's configured thresholds — the same resolver the nodes board,
  // the grid and the alert pipeline read, so no two surfaces disagree on when a
  // battery has become a problem.
  const band = useBatteryBand(remaining);

  if (remaining == null || band === undefined) {
    return <UnknownValue title={t("noTelemetry")} />;
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
    >
      <Icon size={12} />
      {remaining}%
    </span>
  );
}

export function RssiCell({
  row,
  freshness,
}: {
  row: SwarmSlotRow;
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("swarmView.table");
  const rssi = row.beacon?.rssiDbm ?? null;

  // The capture gives no radiotap RSSI on some adapters; that is an absent
  // reading, not a weak one, and must never render as a number.
  if (rssi == null) return <UnknownValue title={t("noRssi")} />;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums",
        rssi <= SWARM_WEAK_RSSI_DBM ? "text-status-warning" : "text-text-secondary",
        staleClass(freshness),
      )}
    >
      <Signal size={12} />
      {rssi}
    </span>
  );
}

export function BeaconAgeCell({ row }: { row: SwarmSlotRow }) {
  const t = useTranslations("swarmView.table");
  const beacon = row.beacon;

  if (!beacon) return <UnknownValue title={t("noBeacon")} />;

  const seconds = beacon.ageMs / 1000;
  return (
    <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
      {t("beaconAgeSeconds", { seconds: seconds.toFixed(1) })}
    </span>
  );
}

/**
 * The hero affordance. Deliberately not a Pin: this one is exclusive across the
 * fleet and moves real RF allocation, so it takes its own verb, its own
 * `Crosshair` icon and its own handler. The pressed state comes from the
 * beacon's own bit, never from the click — a promotion whose demotion failed
 * shows two lit crosshairs, which is the truth.
 */
export function HeroToggle({
  row,
  pending,
  disabled,
  onMakeHero,
}: {
  row: SwarmSlotRow;
  pending: boolean;
  disabled: boolean;
  onMakeHero: () => void;
}) {
  const t = useTranslations("swarmView.hero");
  const isHero = row.beacon?.hero ?? false;

  return (
    <button
      type="button"
      onClick={onMakeHero}
      disabled={disabled || isHero || pending}
      aria-pressed={isHero}
      title={isHero ? t("current") : disabled ? t("unavailable") : t("make")}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        isHero
          ? "bg-accent-primary/15 text-accent-primary"
          : "text-text-tertiary hover:text-text-primary",
        (disabled || pending) && !isHero && "opacity-40",
      )}
    >
      <Crosshair size={13} className={pending ? "animate-pulse" : undefined} />
      <span className="sr-only">{isHero ? t("current") : t("make")}</span>
    </button>
  );
}
