"use client";

import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface AttitudeCardProps {
  className?: string;
}

export function AttitudeCard({ className }: AttitudeCardProps) {
  // Subscribe to version to trigger re-renders on telemetry push
  useTelemetryStore((s) => s._version);
  const attitude = useTelemetryStore((s) => s.attitude);
  const latest = attitude.latest();

  const fmt = (v: number | undefined) =>
    v !== undefined ? v.toFixed(1) : "--.-";
  const fmtRate = (v: number | undefined) =>
    v !== undefined ? v.toFixed(2) : "--.--";

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg bg-bg-secondary p-3",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Compass className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Attitude
        </span>
      </div>

      {/* Data rows */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
        {(["Roll", "Pitch", "Yaw"] as const).map((label) => {
          const key = label.toLowerCase() as "roll" | "pitch" | "yaw";
          const rateKey = `${key}Speed` as
            | "rollSpeed"
            | "pitchSpeed"
            | "yawSpeed";
          return (
            <div key={label} className="text-center">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wide">
                {label}
              </div>
              <div className="text-sm font-mono text-text-primary leading-tight">
                {fmt(latest?.[key])}&deg;
              </div>
              <div className="text-[10px] font-mono text-text-tertiary leading-tight">
                {fmtRate(latest?.[rateKey])} r/s
              </div>
            </div>
          );
        })}
      </div>

      {!latest && (
        <div className="text-[10px] text-text-tertiary text-center mt-1">
          Waiting for data...
        </div>
      )}
    </div>
  );
}
