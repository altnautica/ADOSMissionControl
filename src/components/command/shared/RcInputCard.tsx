"use client";

import { useState } from "react";
import { Gamepad2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface RcInputCardProps {
  className?: string;
}

const CHANNEL_COUNT = 8;
const DEFAULT_VISIBLE = 4;
const PWM_MIN = 1000;
const PWM_MAX = 2000;
const PWM_RANGE = PWM_MAX - PWM_MIN;

export function RcInputCard({ className }: RcInputCardProps) {
  useTelemetryStore((s) => s._version);
  const rc = useTelemetryStore((s) => s.rc);
  const latest = rc.latest();
  const [expanded, setExpanded] = useState(false);

  const channels = latest?.channels ?? [];
  const visibleCount = expanded ? CHANNEL_COUNT : DEFAULT_VISIBLE;

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-3",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Gamepad2 className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          RC Input
        </span>
      </div>

      {/* Channel bars */}
      <div className="space-y-0.5">
        {Array.from({ length: visibleCount }, (_, i) => {
          const val = channels[i];
          const hasVal = val !== undefined && val > 0;
          const pct = hasVal
            ? Math.max(0, Math.min(100, ((val - PWM_MIN) / PWM_RANGE) * 100))
            : 0;

          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary w-5 text-right font-mono shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 h-1.5 rounded-sm bg-white/5 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-accent-primary/60 transition-all"
                  style={{ width: hasVal ? `${pct}%` : "0%" }}
                />
                {/* Center marker at 1500 */}
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
              </div>
              <span className="text-[10px] font-mono text-text-tertiary w-8 text-right shrink-0">
                {hasVal ? val : "----"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Show all / Show less toggle */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 mt-1.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {expanded ? (
          <>
            <ChevronUp className="w-3 h-3" />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" />
            Show all {CHANNEL_COUNT}
          </>
        )}
      </button>

      {/* RSSI */}
      <div className="mt-1.5 pt-1.5 border-t border-border-default flex justify-between">
        <span className="text-[10px] text-text-tertiary">RSSI</span>
        <span className="text-[10px] font-mono text-text-primary">
          {latest ? `${latest.rssi}` : "--"}
        </span>
      </div>

      {!latest && (
        <div className="text-[10px] text-text-tertiary text-center mt-1">
          Waiting for data...
        </div>
      )}
    </div>
  );
}
