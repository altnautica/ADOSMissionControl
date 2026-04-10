"use client";

/**
 * @module NpuCheckStep
 * @description Setup wizard step: verify NPU/compute is available for AI inference.
 * @license GPL-3.0-only
 */

import { Cpu, Check, X, AlertTriangle } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { WizardStepProps } from "../SetupWizard";

export function NpuCheckStep({ feature }: WizardStepProps) {
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const tier = useAgentCapabilitiesStore((s) => s.tier);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);

  const passed = compute.npu_available && compute.npu_tops >= 0.8;
  const hasCpuFallback = !compute.npu_available && tier >= 2;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-lg ${
            passed ? "bg-status-success/15" : "bg-status-error/15"
          }`}
        >
          <Cpu
            size={20}
            className={passed ? "text-status-success" : "text-status-error"}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium text-text-primary">NPU Check</h3>
          <p className="text-[11px] text-text-tertiary">
            {feature.name} requires neural processing for real-time detection
          </p>
        </div>
      </div>

      <div className="border border-border-default rounded-lg p-3.5 bg-bg-secondary">
        {!loaded ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Cpu size={12} className="animate-pulse" />
            Detecting compute hardware...
          </div>
        ) : passed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-status-success">
              <Check size={14} />
              NPU available
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="px-2 py-1.5 bg-bg-tertiary rounded">
                <span className="text-text-tertiary">Performance</span>
                <p className="text-text-primary font-mono mt-0.5">
                  {compute.npu_tops} TOPS
                </p>
              </div>
              <div className="px-2 py-1.5 bg-bg-tertiary rounded">
                <span className="text-text-tertiary">Runtime</span>
                <p className="text-text-primary font-mono mt-0.5 uppercase">
                  {compute.npu_runtime ?? "N/A"}
                </p>
              </div>
            </div>
            {compute.npu_tops >= 6.0 && (
              <p className="text-[10px] text-status-success">
                Optimal performance. Full-resolution detection at 18+ FPS.
              </p>
            )}
            {compute.npu_tops >= 2.0 && compute.npu_tops < 6.0 && (
              <p className="text-[10px] text-text-tertiary">
                Good performance. Standard detection at 12-18 FPS.
              </p>
            )}
            {compute.npu_tops < 2.0 && (
              <p className="text-[10px] text-status-warning">
                Basic performance. Low-resolution detection at 8-12 FPS.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-status-error">
              <X size={14} />
              No NPU available
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Your board (Tier {tier}) does not have a neural processing unit.
              {feature.name} requires an NPU for real-time detection.
            </p>
            <div className="text-[11px] text-text-tertiary">
              <p className="font-medium text-text-secondary mb-1">Boards with NPU:</p>
              <ul className="space-y-0.5 ml-3 list-disc">
                <li>Rock 5C Lite (6.0 TOPS, RKNN)</li>
                <li>RK3576 boards (6.0 TOPS, RKNN)</li>
                <li>Jetson Orin Nano (40 TOPS, TensorRT)</li>
              </ul>
            </div>
            {hasCpuFallback && (
              <div className="flex items-start gap-2 p-2 bg-status-warning/10 rounded text-[11px]">
                <AlertTriangle size={12} className="text-status-warning shrink-0 mt-0.5" />
                <span className="text-text-secondary">
                  CPU fallback is available but runs at ~2 FPS. Not usable for flight
                  control, only for testing and development.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {passed && (
        <p className="text-[11px] text-status-success flex items-center gap-1">
          <Check size={10} />
          Ready to proceed
        </p>
      )}
    </div>
  );
}
