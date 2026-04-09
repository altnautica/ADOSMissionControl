"use client";

import { Battery } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface BatteryCardProps {
  className?: string;
}

function barColor(pct: number): string {
  if (pct <= 20) return "bg-red-500";
  if (pct <= 50) return "bg-yellow-500";
  return "bg-green-500";
}

export function BatteryCard({ className }: BatteryCardProps) {
  useTelemetryStore((s) => s._version);
  const battery = useTelemetryStore((s) => s.battery);
  const latest = battery.latest();

  // DEC-108 bench mode: a disconnected battery reads ~0.01V via the FC's
  // voltage divider, and the percentage field is uninitialized garbage.
  // When voltage is below ~1V, treat it as "no battery connected" instead
  // of showing "0% Critical".
  const hasRealBattery = (latest?.voltage ?? 0) >= 1.0;
  const pct = latest?.remaining ?? 0;

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Battery className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Battery
        </span>
      </div>

      {/* Percentage + bar */}
      <div className="mb-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-lg font-mono font-semibold text-text-primary leading-none">
            {!latest ? "--%" : hasRealBattery ? `${pct.toFixed(0)}%` : "—"}
          </span>
          <span className="text-[10px] text-text-tertiary">
            {hasRealBattery && latest ? `${latest.consumed.toFixed(0)} mAh` : "no battery"}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/5">
          <div
            className={cn("h-full rounded-full transition-all", barColor(pct))}
            style={{ width: hasRealBattery && latest ? `${Math.min(pct, 100)}%` : "0%" }}
          />
        </div>
      </div>

      {/* Voltage + Current */}
      <div className="flex gap-3 mb-1.5">
        <div className="text-[10px] text-text-tertiary">
          V{" "}
          <span className="text-text-primary font-mono text-xs">
            {hasRealBattery && latest ? `${latest.voltage.toFixed(2)}` : "--.-"}
          </span>
        </div>
        <div className="text-[10px] text-text-tertiary">
          A{" "}
          <span className="text-text-primary font-mono text-xs">
            {hasRealBattery && latest ? `${latest.current.toFixed(1)}` : "--.-"}
          </span>
        </div>
      </div>

      {/* Cell voltages if available */}
      {hasRealBattery && latest?.cellVoltages && latest.cellVoltages.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-border-default">
          <div className="text-[10px] text-text-tertiary mb-1">Cells</div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
            {latest.cellVoltages
              .filter((v) => v > 0)
              .map((v, i) => (
                <div key={i} className="text-[10px] font-mono text-text-primary">
                  C{i + 1}{" "}
                  <span
                    className={cn(
                      v < 3.3
                        ? "text-red-400"
                        : v < 3.5
                          ? "text-yellow-400"
                          : "text-text-primary"
                    )}
                  >
                    {v.toFixed(2)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {!latest && (
        <div className="text-[10px] text-text-tertiary text-center mt-1">
          Waiting for data...
        </div>
      )}
    </div>
  );
}
