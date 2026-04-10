"use client";

/**
 * @module ConfirmStep
 * @description Setup wizard final step: summary of what will happen when the feature is enabled.
 * @license GPL-3.0-only
 */

import { Check, Sparkles } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { WizardStepProps } from "../SetupWizard";

export function ConfirmStep({ feature, params }: WizardStepProps) {
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);

  const configEntries = feature.configSchema
    ? feature.configSchema.map((param) => {
        const value = params[param.key] ?? param.default;
        let displayValue = String(value);

        // Look up select option labels
        if (param.type === "select" && param.options) {
          const opt = param.options.find((o) => o.value === value);
          if (opt) displayValue = opt.label;
        }

        if (param.unit) displayValue += ` ${param.unit}`;

        return { label: param.label, value: displayValue };
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-status-success/15">
          <Sparkles size={20} className="text-status-success" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-text-primary">Ready to Enable</h3>
          <p className="text-[11px] text-text-tertiary">
            Review your configuration before enabling {feature.name}
          </p>
        </div>
      </div>

      <div className="border border-border-default rounded-lg bg-bg-secondary overflow-hidden">
        {/* Feature summary */}
        <div className="px-3.5 py-2.5 border-b border-border-default">
          <p className="text-xs font-medium text-text-primary">{feature.name}</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">{feature.description}</p>
        </div>

        {/* Hardware */}
        <div className="px-3.5 py-2 border-b border-border-default">
          <p className="text-[10px] font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
            Hardware
          </p>
          <div className="space-y-1 text-[11px]">
            {cameras.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Check size={10} className="text-status-success" />
                <span className="text-text-secondary">
                  {cameras[0].name} ({cameras[0].resolution})
                </span>
              </div>
            )}
            {compute.npu_available && (
              <div className="flex items-center gap-1.5">
                <Check size={10} className="text-status-success" />
                <span className="text-text-secondary">
                  NPU {compute.npu_tops} TOPS ({compute.npu_runtime?.toUpperCase()})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Models */}
        {feature.requiredModels && feature.requiredModels.length > 0 && (
          <div className="px-3.5 py-2 border-b border-border-default">
            <p className="text-[10px] font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
              Models
            </p>
            <div className="space-y-1 text-[11px]">
              {feature.requiredModels.map((m) => (
                <div key={m.modelId} className="flex items-center gap-1.5">
                  <Check size={10} className="text-status-success" />
                  <span className="text-text-secondary">
                    {m.modelId} ({m.purpose})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Configuration */}
        {configEntries.length > 0 && (
          <div className="px-3.5 py-2">
            <p className="text-[10px] font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
              Configuration
            </p>
            <div className="space-y-1">
              {configEntries.map((entry) => (
                <div
                  key={entry.label}
                  className="flex items-center justify-between text-[11px]"
                >
                  <span className="text-text-tertiary">{entry.label}</span>
                  <span className="text-text-primary font-mono">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-tertiary">
        Click "Enable {feature.name}" to start. The vision engine will load the
        required models and begin detection. You can activate the behavior from the
        Smart Modes tab.
      </p>
    </div>
  );
}
