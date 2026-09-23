/**
 * @module SettingNumberField
 * @description Number input for an iNav named setting. Shows the firmware
 * range and flags a value outside it; it never clamps, so what the operator
 * typed is what the write is checked against.
 * @license GPL-3.0-only
 */

"use client";

import { rangeError, type SettingRange } from "./inav-setting-fields";

interface SettingNumberFieldProps {
  label: string;
  value: number | undefined;
  range: SettingRange | undefined;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function SettingNumberField({ label, value, range, step = 1, disabled, onChange }: SettingNumberFieldProps) {
  if (value === undefined) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-text-tertiary font-mono">{label}</span>
        <span className="text-[10px] text-text-tertiary font-mono">Not on this firmware</span>
      </div>
    );
  }
  const problem = rangeError(value, range);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-text-tertiary font-mono">
        {label}
        {range && <span className="ml-1 text-text-tertiary">({range.min} to {range.max})</span>}
      </span>
      <input
        type="number"
        step={step}
        min={range?.min}
        max={range?.max}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
      />
      {problem && <span className="text-[10px] font-mono text-status-error">{problem}</span>}
    </label>
  );
}
