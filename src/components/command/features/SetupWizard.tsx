"use client";

/**
 * @module SetupWizard
 * @description Multi-step guided setup dialog for enabling drone features.
 * Walks users through hardware checks, model downloads, and behavior configuration.
 * @license GPL-3.0-only
 */

import { useState, useCallback, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { ResolvedFeature, ConfigParam } from "@/lib/agent/feature-types";
import { CameraCheckStep } from "./steps/CameraCheckStep";
import { NpuCheckStep } from "./steps/NpuCheckStep";
import { ModelDownloadStep } from "./steps/ModelDownloadStep";
import { BehaviorConfigStep } from "./steps/BehaviorConfigStep";
import { ConfirmStep } from "./steps/ConfirmStep";

export interface WizardStepProps {
  feature: ResolvedFeature;
  onNext: () => void;
  onBack: () => void;
  params: Record<string, unknown>;
  setParams: (params: Record<string, unknown>) => void;
}

interface WizardStep {
  id: string;
  title: string;
  component: React.ComponentType<WizardStepProps>;
}

interface SetupWizardProps {
  feature: ResolvedFeature;
  open: boolean;
  onClose: () => void;
  onComplete: (featureId: string, params: Record<string, unknown>) => void;
}

function buildSteps(feature: ResolvedFeature): WizardStep[] {
  const steps: WizardStep[] = [];

  // Camera check if camera is required
  const needsCamera = feature.sensorsRequired.some(
    (s) => s.type === "camera" && s.required
  );
  if (needsCamera) {
    steps.push({ id: "camera", title: "Camera Check", component: CameraCheckStep });
  }

  // NPU check if NPU is required
  if (feature.requiresNpu) {
    steps.push({ id: "npu", title: "NPU Check", component: NpuCheckStep });
  }

  // Model download if models are required
  if (feature.requiredModels && feature.requiredModels.length > 0) {
    steps.push({ id: "model", title: "AI Models", component: ModelDownloadStep });
  }

  // Behavior config if configSchema exists
  if (feature.configSchema && feature.configSchema.length > 0) {
    steps.push({ id: "config", title: "Configure", component: BehaviorConfigStep });
  }

  // Always end with confirm
  steps.push({ id: "confirm", title: "Confirm", component: ConfirmStep });

  return steps;
}

export function SetupWizard({ feature, open, onClose, onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [params, setParams] = useState<Record<string, unknown>>(() => {
    // Initialize with defaults from configSchema
    const defaults: Record<string, unknown> = {};
    if (feature.configSchema) {
      for (const param of feature.configSchema) {
        defaults[param.key] = param.default;
      }
    }
    return defaults;
  });

  const steps = useMemo(() => buildSteps(feature), [feature]);
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = useCallback(() => {
    setCurrentStep((current) => {
      const last = current >= steps.length - 1;
      if (last) {
        // Final step: enable the feature and close wizard
        useAgentCapabilitiesStore.getState().optimisticEnableFeature(feature.id);
        onComplete(feature.id, params);
        onClose();
        return current;
      }
      return current + 1;
    });
  }, [steps.length, feature.id, params, onComplete, onClose]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  if (!open) return null;

  const step = steps[currentStep];
  const StepComponent = step.component;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 bg-bg-primary border border-border-default rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-default">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Setup: {feature.name}
            </h2>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Step {currentStep + 1} of {steps.length}: {step.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-bg-tertiary">
          <div
            className="h-full bg-accent-primary transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 py-3">
          {steps.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                i < currentStep
                  ? "bg-status-success"
                  : i === currentStep
                    ? "bg-accent-primary"
                    : "bg-bg-tertiary"
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="px-5 pb-4 min-h-[240px]">
          <StepComponent
            feature={feature}
            onNext={handleNext}
            onBack={handleBack}
            params={params}
            setParams={setParams}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-default bg-bg-secondary">
          <button
            onClick={handleBack}
            disabled={isFirstStep}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors",
              isFirstStep
                ? "text-text-tertiary cursor-not-allowed"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
            )}
          >
            <ChevronLeft size={12} />
            Back
          </button>
          <button
            onClick={handleNext}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded transition-all",
              isLastStep
                ? "bg-status-success text-white hover:opacity-90"
                : "bg-accent-primary text-white hover:opacity-90"
            )}
          >
            {isLastStep ? (
              <>
                <Check size={12} />
                Enable {feature.name}
              </>
            ) : (
              <>
                Next
                <ChevronRight size={12} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
