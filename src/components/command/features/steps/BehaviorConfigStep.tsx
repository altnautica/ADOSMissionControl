"use client";

/**
 * @module BehaviorConfigStep
 * @description Setup wizard step: configure behavior parameters using dynamic schema.
 * Renders sliders, selects, toggles, and number inputs from the feature's configSchema.
 * @license GPL-3.0-only
 */

import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import type { WizardStepProps } from "../SetupWizard";
import type { ConfigParam } from "@/lib/agent/feature-types";

function SliderParam({
  param,
  value,
  onChange,
}: {
  param: ConfigParam;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-text-secondary">{param.label}</label>
        <span className="text-[11px] font-mono text-text-primary">
          {value}
          {param.unit ? ` ${param.unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent-primary"
      />
      <div className="flex justify-between text-[9px] text-text-tertiary">
        <span>
          {param.min}
          {param.unit ? ` ${param.unit}` : ""}
        </span>
        <span>
          {param.max}
          {param.unit ? ` ${param.unit}` : ""}
        </span>
      </div>
    </div>
  );
}

function SelectParam({
  param,
  value,
  onChange,
}: {
  param: ConfigParam;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={param.label}
      value={value}
      onChange={onChange}
      options={param.options ?? []}
    />
  );
}

function ToggleParam({
  param,
  value,
  onChange,
}: {
  param: ConfigParam;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-[11px] text-text-secondary">{param.label}</label>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "w-8 h-4.5 rounded-full relative transition-colors",
          value ? "bg-accent-primary" : "bg-bg-tertiary"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform",
            value ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}

export function BehaviorConfigStep({ feature, params, setParams }: WizardStepProps) {
  const schema = feature.configSchema ?? [];

  const handleChange = (key: string, value: unknown) => {
    setParams({ ...params, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-primary/15">
          <Settings size={20} className="text-accent-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-text-primary">Configure</h3>
          <p className="text-[11px] text-text-tertiary">
            Adjust {feature.name} parameters. You can change these later.
          </p>
        </div>
      </div>

      <div className="border border-border-default rounded-lg p-3.5 bg-bg-secondary space-y-4">
        {schema.map((param) => {
          const value = params[param.key] ?? param.default;

          switch (param.type) {
            case "slider":
              return (
                <SliderParam
                  key={param.key}
                  param={param}
                  value={value as number}
                  onChange={(v) => handleChange(param.key, v)}
                />
              );
            case "select":
              return (
                <SelectParam
                  key={param.key}
                  param={param}
                  value={value as string}
                  onChange={(v) => handleChange(param.key, v)}
                />
              );
            case "toggle":
              return (
                <ToggleParam
                  key={param.key}
                  param={param}
                  value={value as boolean}
                  onChange={(v) => handleChange(param.key, v)}
                />
              );
            case "number":
              return (
                <div key={param.key} className="space-y-1">
                  <label className="text-[11px] text-text-secondary">{param.label}</label>
                  <input
                    type="number"
                    value={value as number}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    onChange={(e) => handleChange(param.key, Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg-tertiary border border-border-default rounded text-text-primary outline-none focus:border-accent-primary font-mono"
                  />
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
