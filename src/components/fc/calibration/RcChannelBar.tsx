"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const RC_PWM_MIN = 800;
const RC_PWM_MAX = 2200;

export function RcChannelBar({
  label, channel, value, capturedMin, capturedMax, capturedTrim, showCaptures,
}: {
  label: string;
  channel: number;
  value: number;
  capturedMin: number;
  capturedMax: number;
  capturedTrim: number;
  showCaptures: boolean;
}) {
  const range = RC_PWM_MAX - RC_PWM_MIN;
  const pct = ((value - RC_PWM_MIN) / range) * 100;
  const minPct = ((capturedMin - RC_PWM_MIN) / range) * 100;
  const maxPct = ((capturedMax - RC_PWM_MIN) / range) * 100;
  const trimPct = ((capturedTrim - RC_PWM_MIN) / range) * 100;

  const barColor = value < 1000 || value > 2000 ? "bg-status-warning" : "bg-accent-primary";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-text-secondary w-16 shrink-0">
        CH{channel} <span className="text-text-tertiary">{label}</span>
      </span>
      <div className="relative h-4 bg-bg-tertiary flex-1">
        <div className={cn("absolute top-0 left-0 h-full transition-all duration-100", barColor)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        {showCaptures && capturedMin < RC_PWM_MAX && (
          <div className="absolute top-0 h-full w-[2px] bg-status-error"
            style={{ left: `${Math.min(100, Math.max(0, minPct))}%` }} title={`Min: ${capturedMin}`} />
        )}
        {showCaptures && capturedMax > RC_PWM_MIN && (
          <div className="absolute top-0 h-full w-[2px] bg-status-error"
            style={{ left: `${Math.min(100, Math.max(0, maxPct))}%` }} title={`Max: ${capturedMax}`} />
        )}
        {showCaptures && (
          <div className="absolute top-0 h-full w-[2px] bg-status-success"
            style={{ left: `${Math.min(100, Math.max(0, trimPct))}%` }} title={`Trim: ${capturedTrim}`} />
        )}
      </div>
      <span className="text-[10px] font-mono text-text-tertiary w-10 text-right shrink-0">{value}</span>
    </div>
  );
}

export function RcCalSummaryTable({
  captures, channelLabels,
}: {
  captures: Array<{ min: number; max: number; trim: number }>;
  channelLabels: string[];
}) {
  const tm = useTranslations("fcPanels.rcChannelBar");
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-text-tertiary">
            <th className="text-left px-1 py-0.5">CH</th>
            <th className="text-right px-1 py-0.5">{tm("min")}</th>
            <th className="text-right px-1 py-0.5">{tm("trim")}</th>
            <th className="text-right px-1 py-0.5">{tm("max")}</th>
            <th className="text-right px-1 py-0.5">{tm("range")}</th>
          </tr>
        </thead>
        <tbody>
          {captures.map((ch, i) => {
            const range = ch.max - ch.min;
            const rangeOk = range >= 200;
            return (
              <tr key={i} className="border-t border-border-default/50">
                <td className="text-left px-1 py-0.5 text-text-secondary">CH{i + 1} {channelLabels[i]}</td>
                <td className="text-right px-1 py-0.5 text-text-primary">{ch.min}</td>
                <td className="text-right px-1 py-0.5 text-status-success">{ch.trim}</td>
                <td className="text-right px-1 py-0.5 text-text-primary">{ch.max}</td>
                <td className={cn("text-right px-1 py-0.5", rangeOk ? "text-status-success" : "text-status-warning")}>{range}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
