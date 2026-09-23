"use client";

/**
 * @module fc/power/LiveBatteryDisplay
 * @description Live battery readout on the Power panel.
 *
 * Reads the battery channel through the telemetry freshness gate, so it
 * follows every new sample and blanks once the link goes quiet instead of
 * holding the last value under a "Live" label. A field the FC does not report
 * (current, consumed, an unknown remaining) reads "—". The per-cell view shows
 * measured cells only: a single whole-pack value in voltages[0] is not a cell,
 * and a cell count is never inferred from the pack voltage.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { Battery, Thermometer, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useKnownCellCount } from "@/hooks/use-known-cell-count";
import { useDroneManager } from "@/stores/drone-manager";
import {
  plausibleCellVoltages,
  resolveCellCount,
} from "@/lib/telemetry/battery-cells";

const NOT_MEASURED = "—";

function cellVoltageColor(v: number): string {
  if (v >= 3.7) return "text-status-success";
  if (v >= 3.5) return "text-status-warning";
  return "text-status-error";
}

function cellVoltageBg(v: number): string {
  if (v >= 3.7) return "bg-status-success";
  if (v >= 3.5) return "bg-status-warning";
  return "bg-status-error";
}

function LiveStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary block">{label}</span>
      <span className="text-sm font-mono text-text-primary">
        {value}
        {value !== NOT_MEASURED && (
          <span className="text-[10px] text-text-tertiary ml-0.5">{unit}</span>
        )}
      </span>
    </div>
  );
}

export function LiveBatteryDisplay() {
  const battery = useFreshTelemetry("battery");
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const knownCellCount = useKnownCellCount(droneId, battery?.cellCount);

  const cells = plausibleCellVoltages(battery?.cellVoltages);
  const cellCount = resolveCellCount(battery?.cellVoltages, knownCellCount);

  const cellImbalance = useMemo(() => {
    if (!cells || cells.length < 2) return null;
    const delta = Math.max(...cells) - Math.min(...cells);
    if (delta < 0.05) return null;
    return { delta, severity: delta > 0.3 ? ("error" as const) : ("warning" as const) };
  }, [cells]);

  const averageCell =
    battery && !cells && cellCount !== null ? battery.voltage / cellCount : null;

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Battery size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Live Battery</h2>
        {battery && cellCount !== null && (
          <span className="text-[10px] font-mono text-text-tertiary ml-auto">
            {cellCount}S
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <LiveStat
          label="Voltage"
          value={battery ? battery.voltage.toFixed(2) : NOT_MEASURED}
          unit="V"
        />
        <LiveStat
          label="Current"
          value={battery?.current !== undefined ? battery.current.toFixed(1) : NOT_MEASURED}
          unit="A"
        />
        <LiveStat
          label="Remaining"
          value={battery && battery.remaining >= 0 ? `${Math.round(battery.remaining)}` : NOT_MEASURED}
          unit="%"
        />
        <LiveStat
          label="Consumed"
          value={battery?.consumed !== undefined ? Math.round(battery.consumed).toString() : NOT_MEASURED}
          unit="mAh"
        />
      </div>

      {battery?.temperature !== undefined && (
        <div className="flex items-center gap-1 mb-3">
          <Thermometer size={10} className="text-text-tertiary" />
          <span
            className={cn(
              "text-[10px] font-mono",
              battery.temperature > 60
                ? "text-status-error"
                : battery.temperature > 45
                  ? "text-status-warning"
                  : "text-text-secondary",
            )}
          >
            {battery.temperature.toFixed(1)}&deg;C
          </span>
        </div>
      )}

      {cells && (
        <div>
          <span className="text-[10px] text-text-tertiary mb-1.5 block">Cell Voltages</span>
          <div className="flex gap-1.5">
            {cells.map((cv, i) => (
              <div key={i} className="flex-1">
                <div className="h-8 bg-bg-tertiary relative overflow-hidden">
                  <div
                    className={cn("absolute bottom-0 left-0 right-0 transition-all", cellVoltageBg(cv))}
                    style={{ height: `${Math.min(100, Math.max(0, ((cv - 3.0) / 1.2) * 100))}%`, opacity: 0.3 }}
                  />
                  <span className={cn("absolute inset-0 flex items-center justify-center text-[10px] font-mono", cellVoltageColor(cv))}>
                    {cv.toFixed(2)}
                  </span>
                </div>
                <span className="text-[9px] text-text-tertiary block text-center mt-0.5">C{i + 1}</span>
              </div>
            ))}
          </div>
          {cellImbalance && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-[10px]",
              cellImbalance.severity === "error" ? "text-status-error" : "text-status-warning"
            )}>
              <AlertTriangle size={10} />
              <span>Cell imbalance: {"\u0394"}{Math.round(cellImbalance.delta * 1000)}mV</span>
            </div>
          )}
        </div>
      )}

      {averageCell !== null && (
        <p className="text-[10px] text-text-tertiary">
          Average per cell:{" "}
          <span className={cn("font-mono", cellVoltageColor(averageCell))}>
            {averageCell.toFixed(2)} V
          </span>
        </p>
      )}

      {!battery && (
        <p className="text-[10px] text-text-tertiary">No live battery data from the flight controller</p>
      )}
    </div>
  );
}
