"use client";

/**
 * @module command/swarm-view/SwarmSeverityStrip
 * @description Band one: the fleet in five numbers, and the exceptions it is
 * currently carrying in one line.
 *
 * A dashboard full of green is as hard to read as one full of red, so this band
 * exists to make twenty healthy drones cost the operator nothing. It says how
 * many are hot and how many are wrong; the twenty that are neither are
 * represented by the absence of a number.
 *
 * Every chip is also the table's filter. Reading a count and then having to
 * hunt for the rows behind it is the step where a fleet board stops being used,
 * so the count IS the way in.
 *
 * The condition line under the chips is the alarm budget (EEMUA 191: one alarm
 * per operator per ten minutes in steady state). Three drones under the battery
 * threshold is one chip reading "3 low battery" — never three alerts, and never
 * three rows of their own.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BatteryLow, ShieldAlert, SignalLow } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBatteryThresholds } from "@/lib/battery-bands";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { StatusDot } from "@/components/ui/status-dot";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import {
  SWARM_SEVERITY_IDS,
  SWARM_SEVERITY_LEVEL,
  swarmConditionCounts,
  swarmSeverityCounts,
  type SwarmSeverityId,
} from "./swarm-rows";
import { useSwarmSlotRows } from "./use-swarm-slot-rows";

/** `armed` is state, not severity: it sits past a divider from the exceptions. */
const LAST_EXCEPTION_ID: SwarmSeverityId = "warning";

export interface SwarmSeverityStripProps {
  rows: readonly SwarmBeaconRow[];
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>;
  /** The chip currently narrowing the table, or null for the whole fleet. */
  active: SwarmSeverityId | null;
  onToggle: (id: SwarmSeverityId) => void;
}

export function SwarmSeverityStrip({
  rows,
  nodesBySlot,
  active,
  onToggle,
}: SwarmSeverityStripProps) {
  const t = useTranslations("swarmView");
  const thresholds = useBatteryThresholds();
  const slotRows = useSwarmSlotRows(rows, nodesBySlot);

  const counts = useMemo(() => swarmSeverityCounts(slotRows), [slotRows]);
  const conditions = useMemo(
    () => swarmConditionCounts(slotRows, thresholds),
    [slotRows, thresholds],
  );

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2">
      {SWARM_SEVERITY_IDS.map((id) => (
        <SeverityChip
          key={id}
          id={id}
          count={counts[id]}
          label={t(`severity.${id}`)}
          active={active === id}
          onToggle={() => onToggle(id)}
          // The divider marks where the exceptions end and fleet state begins.
          className={
            id === LAST_EXCEPTION_ID
              ? "mr-2 border-r border-border-default pr-4"
              : undefined
          }
        />
      ))}

      <span className="text-[11px] tabular-nums text-text-tertiary">
        {t("severity.ofTotal", { total: slotRows.length })}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {conditions.hardSeparation > 0 && (
          <ConditionChip
            icon={<ShieldAlert size={11} />}
            tone="text-status-error"
            label={t("conditions.hardSeparation", {
              count: conditions.hardSeparation,
            })}
          />
        )}
        {conditions.lowBattery > 0 && (
          <ConditionChip
            icon={<BatteryLow size={11} />}
            tone="text-status-warning"
            label={t("conditions.lowBattery", { count: conditions.lowBattery })}
          />
        )}
        {conditions.weakLink > 0 && (
          <ConditionChip
            icon={<SignalLow size={11} />}
            tone="text-status-warning"
            label={t("conditions.weakLink", { count: conditions.weakLink })}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One count, one dot, one filter. A chip with nothing behind it stays rendered
 * but dimmed and inert: the zero is information, and a strip whose chips move
 * around as conditions come and go is a strip nobody builds muscle memory for.
 */
function SeverityChip({
  id,
  count,
  label,
  active,
  onToggle,
  className,
}: {
  id: SwarmSeverityId;
  count: number;
  label: string;
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={empty}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        active
          ? "border-accent-primary bg-accent-primary/10"
          : "border-border-default bg-bg-secondary",
        empty
          ? "cursor-default opacity-45"
          : "hover:border-accent-primary/60 hover:bg-bg-tertiary",
        className,
      )}
    >
      <StatusDot
        status={SWARM_SEVERITY_LEVEL[id]}
        size="sm"
        label={label}
        // A live exception earns the pulse; zero and `armed` never do.
        pulse={!empty && id !== "armed"}
      />
      <span className="font-mono text-sm font-semibold tabular-nums text-text-primary">
        {count}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
    </button>
  );
}

/** An aggregate condition: one chip for the whole fleet, never one per drone. */
function ConditionChip({
  icon,
  tone,
  label,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border-default bg-bg-tertiary px-1.5 py-0.5 text-[10px] leading-none",
        tone,
      )}
    >
      {icon}
      {label}
    </span>
  );
}
