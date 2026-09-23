"use client";

import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParamStar } from "../parameters/ParamStar";
import type { AxisConfig, PidParam } from "./pid-constants";

const SLIDER_CLASS =
  "w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer";

/**
 * One tunable parameter: label, slider and numeric input.
 *
 * `value` is `undefined` when the FC has not reported the parameter. Before
 * the first load that means "not read yet"; after it, the parameter does not
 * exist on this firmware. Either way nothing is shown as a live 0 and the
 * controls are disabled, so a drag cannot queue a write the FC will refuse.
 */
export function PidParamRow({
  pidP,
  value,
  hasLoaded,
  isDirty,
  onChange,
  name,
  gridClass,
  unit,
  trailing,
}: {
  pidP: PidParam;
  value: number | undefined;
  hasLoaded: boolean;
  isDirty: boolean;
  onChange: (value: number) => void;
  name: ReactNode;
  gridClass: string;
  unit?: string;
  trailing?: ReactNode;
}) {
  const present = value !== undefined;
  return (
    <div className={cn("grid items-center gap-3", gridClass)}>
      <div>
        <span className="text-xs font-mono text-text-secondary">{pidP.label}</span>
        {name}
      </div>

      {present ? (
        <div className="relative">
          <input
            type="range"
            min={pidP.min}
            max={pidP.max}
            step={pidP.step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className={SLIDER_CLASS}
          />
          <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5">
            <span>{pidP.min}</span>
            <span>{unit ? `${pidP.max} ${unit}` : pidP.max}</span>
          </div>
        </div>
      ) : (
        <span className="text-[10px] text-text-tertiary">
          {hasLoaded ? "Not on this firmware" : "Not read"}
        </span>
      )}

      <input
        type="number"
        min={pidP.min}
        max={pidP.max}
        step={pidP.step}
        value={present ? value : ""}
        placeholder={"\u2014"}
        disabled={!present}
        onChange={(e) => {
          const next = parseFloat(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className={cn(
          "w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right",
          "focus:outline-none focus:border-accent-primary transition-colors disabled:opacity-40",
          isDirty ? "border-status-warning" : "border-border-default",
        )}
      />
      {trailing}
    </div>
  );
}

export function PidAxisRow({
  axis,
  params,
  hasLoaded,
  dirtyParams,
  setLocalValue,
  mapParamName = (s) => s,
}: {
  axis: AxisConfig;
  params: Map<string, number>;
  hasLoaded: boolean;
  dirtyParams: Set<string>;
  setLocalValue: (name: string, value: number) => void;
  mapParamName?: (s: string) => string;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">{axis.axis}</h2>
      </div>

      <div className="space-y-3">
        {axis.params.map((pidP) => (
          <PidParamRow
            key={pidP.param}
            pidP={pidP}
            value={params.get(pidP.param)}
            hasLoaded={hasLoaded}
            isDirty={dirtyParams.has(pidP.param)}
            onChange={(v) => setLocalValue(pidP.param, v)}
            name={<span className="text-[9px] text-text-tertiary block">{mapParamName(pidP.param)}</span>}
            gridClass="grid-cols-[100px_1fr_80px_auto]"
            trailing={<ParamStar name={pidP.param} />}
          />
        ))}
      </div>
    </div>
  );
}
