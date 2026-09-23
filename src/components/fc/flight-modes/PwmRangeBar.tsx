"use client";

import { cn } from "@/lib/utils";
import { MODE_PWM_RANGES } from "./flight-mode-constants";

interface PwmRangeBarProps {
  currentPwm: number;
  activeSlot: number;
}

export function PwmRangeBar({ currentPwm, activeSlot }: PwmRangeBarProps) {
  const barMin = 800;
  const barMax = 2100;
  const barRange = barMax - barMin;

  const markerPct = currentPwm > 0
    ? Math.max(0, Math.min(100, ((currentPwm - barMin) / barRange) * 100))
    : -1;

  return (
    <div className="space-y-1">
      <div className="relative h-6 bg-bg-tertiary border border-border-default overflow-hidden">
        {MODE_PWM_RANGES.map((range, i) => {
          const left = ((Math.max(range.min, barMin) - barMin) / barRange) * 100;
          const right = ((Math.min(range.max, barMax) - barMin) / barRange) * 100;
          const width = right - left;
          const isActive = activeSlot === i;

          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 bottom-0 flex items-center justify-center text-[9px] font-mono transition-colors",
                isActive
                  ? "bg-accent-primary/20 text-accent-primary font-bold"
                  : i % 2 === 0
                    ? "bg-bg-secondary/50 text-text-tertiary"
                    : "bg-bg-tertiary/80 text-text-tertiary",
                i < 5 && "border-r border-border-default",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {i + 1}
            </div>
          );
        })}
        {markerPct >= 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent-primary z-10 transition-all duration-150"
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>
    </div>
  );
}
