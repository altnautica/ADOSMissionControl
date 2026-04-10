"use client";

/**
 * @module ModelDownloadStep
 * @description Setup wizard step: verify AI models are downloaded, offer download if missing.
 * @license GPL-3.0-only
 */

import { useState, useCallback } from "react";
import { Check, Download, HardDrive, AlertTriangle, Loader2 } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { WizardStepProps } from "../SetupWizard";

export function ModelDownloadStep({ feature }: WizardStepProps) {
  const models = useAgentCapabilitiesStore((s) => s.models);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = useCallback(async (modelId: string) => {
    setDownloading(modelId);
    // TODO(agent-api): POST /api/vision/models/{modelId}/download
    // For now, simulate a download delay in demo mode
    await new Promise((r) => setTimeout(r, 1500));
    setDownloading(null);
  }, []);

  const requiredModels = feature.requiredModels ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-primary/15">
          <HardDrive size={20} className="text-accent-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-text-primary">AI Models</h3>
          <p className="text-[11px] text-text-tertiary">
            {feature.name} needs detection models on the companion computer
          </p>
        </div>
      </div>

      <div className="border border-border-default rounded-lg p-3.5 bg-bg-secondary space-y-2.5">
        {requiredModels.map((req) => {
          const installed = models.installed.find((m) => m.id === req.modelId);
          const isInstalled = !!installed;
          const isLoaded = installed?.loaded ?? false;

          return (
            <div
              key={req.modelId}
              className="flex items-center justify-between px-2.5 py-2 bg-bg-tertiary rounded"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">
                    {req.modelId}
                  </span>
                  {isInstalled && (
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {installed.variant} / {installed.format}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-text-tertiary mt-0.5">{req.purpose}</p>
              </div>

              <div className="shrink-0 ml-3">
                {isLoaded ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-status-success px-1.5 py-0.5 rounded bg-status-success/10">
                    <Check size={10} />
                    Loaded
                  </span>
                ) : isInstalled ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-accent-primary px-1.5 py-0.5 rounded bg-accent-primary/10">
                    <Check size={10} />
                    Installed
                  </span>
                ) : (
                  <button
                    onClick={() => handleDownload(req.modelId)}
                    disabled={downloading === req.modelId}
                    className="inline-flex items-center gap-1 text-[10px] text-white px-2 py-1 rounded bg-accent-primary hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {downloading === req.modelId ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Download size={10} />
                    )}
                    {downloading === req.modelId ? "Downloading..." : "Download"}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Hardware-selected variant info */}
        {compute.npu_available && (
          <div className="text-[10px] text-text-tertiary px-2 pt-1">
            Selected for your hardware: {compute.npu_tops} TOPS{" "}
            {compute.npu_tops >= 6 ? "(small variant, 640x640)" : compute.npu_tops >= 2 ? "(small variant, 640x640)" : "(nano variant, 320x320)"}
          </div>
        )}

        {/* Cache usage */}
        <div className="flex items-center justify-between text-[10px] text-text-tertiary px-2 pt-1">
          <span>Model cache</span>
          <span>
            {models.cache_used_mb} / {models.cache_max_mb} MB
          </span>
        </div>
        <div className="mx-2 h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-primary rounded-full transition-all"
            style={{
              width: `${Math.min((models.cache_used_mb / models.cache_max_mb) * 100, 100)}%`,
            }}
          />
        </div>
      </div>

      {requiredModels.every((req) =>
        models.installed.some((m) => m.id === req.modelId)
      ) ? (
        <p className="text-[11px] text-status-success flex items-center gap-1">
          <Check size={10} />
          All required models are ready
        </p>
      ) : (
        <p className="text-[11px] text-text-tertiary flex items-center gap-1">
          <AlertTriangle size={10} className="text-status-warning" />
          Some models need to be downloaded before enabling
        </p>
      )}
    </div>
  );
}
