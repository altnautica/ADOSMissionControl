"use client";

/**
 * @module CameraCheckStep
 * @description Setup wizard step: verify camera is detected and streaming.
 * @license GPL-3.0-only
 */

import { Camera, Check, X, RefreshCw } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { WizardStepProps } from "../SetupWizard";

export function CameraCheckStep({ feature }: WizardStepProps) {
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);

  const hasCamera = cameras.length > 0;
  const isStreaming = cameras.some((c) => c.streaming);
  const passed = hasCamera && isStreaming;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-lg ${
            passed
              ? "bg-status-success/15"
              : hasCamera
                ? "bg-status-warning/15"
                : "bg-status-error/15"
          }`}
        >
          <Camera
            size={20}
            className={
              passed
                ? "text-status-success"
                : hasCamera
                  ? "text-status-warning"
                  : "text-status-error"
            }
          />
        </div>
        <div>
          <h3 className="text-sm font-medium text-text-primary">Camera Check</h3>
          <p className="text-[11px] text-text-tertiary">
            {feature.name} requires a camera for visual detection
          </p>
        </div>
      </div>

      {/* Result */}
      <div className="border border-border-default rounded-lg p-3.5 bg-bg-secondary">
        {!loaded ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <RefreshCw size={12} className="animate-spin" />
            Checking camera...
          </div>
        ) : passed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-status-success">
              <Check size={14} />
              Camera detected and streaming
            </div>
            {cameras.map((cam, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[11px] text-text-secondary px-2 py-1.5 bg-bg-tertiary rounded"
              >
                <span>{cam.name}</span>
                <span className="text-text-tertiary">
                  {cam.resolution} {cam.type.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        ) : hasCamera ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-status-warning">
              <X size={14} />
              Camera detected but not streaming
            </div>
            <p className="text-[11px] text-text-tertiary">
              The camera is connected but not producing frames. Check that no other
              application is using it and try again.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-status-error">
              <X size={14} />
              No camera detected
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Connect a USB or CSI camera to your companion computer and try again.
            </p>
            <div className="text-[11px] text-text-tertiary">
              <p className="font-medium text-text-secondary mb-1">Supported cameras:</p>
              <ul className="space-y-0.5 ml-3 list-disc">
                <li>USB UVC webcam (any)</li>
                <li>Radxa Camera 4K (MIPI CSI)</li>
                <li>Arducam IMX179 USB 8MP</li>
              </ul>
            </div>
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
