"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { usePidAnalysisStore } from "@/stores/pid-analysis-store";
import { PidLogUploader } from "./PidLogUploader";
import { PidFFTChart } from "./PidFFTChart";
import { PidStepResponseChart } from "./PidStepResponseChart";
import { PidTrackingChart } from "./PidTrackingChart";
import { PidMotorChart } from "./PidMotorChart";
import { PidAnalysisSummary } from "./PidAnalysisSummary";
import { PidAiRecommendations } from "./PidAiRecommendations";
import { PidComparisonView } from "./PidComparisonView";
import { ChevronLeft, ChevronRight, AlertTriangle, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiSuggestionsGate } from "../shared/AiSuggestionsGate";
import { STEPS, ANALYSIS_TABS, StepIndicator, type AnalysisTab } from "./pid-wizard-steps";
import type { VehicleType } from "./pid-constants";
import type { StepResponseEvent } from "@/lib/analysis/types";

interface Props {
  vehicleType: VehicleType;
  params: Map<string, number>;
  setLocalValue: (name: string, value: number) => void;
  connected: boolean;
}

export function PidAnalysisWizard({ vehicleType, params, setLocalValue, connected }: Props) {
  const wizardStep = usePidAnalysisStore((s) => s.wizardStep);
  const setWizardStep = usePidAnalysisStore((s) => s.setWizardStep);
  const analysisResult = usePidAnalysisStore((s) => s.analysisResult);
  const aiRecommendations = usePidAnalysisStore((s) => s.aiRecommendations);
  const aiLoading = usePidAnalysisStore((s) => s.aiLoading);
  const analyzing = usePidAnalysisStore((s) => s.analyzing);
  const analyzeProgress = usePidAnalysisStore((s) => s.analyzeProgress);
  const error = usePidAnalysisStore((s) => s.error);
  const previousResult = usePidAnalysisStore((s) => s.previousResult);
  const startAnalysis = usePidAnalysisStore((s) => s.startAnalysis);
  const loadMockAnalysis = usePidAnalysisStore((s) => s.loadMockAnalysis);
  const requestAiAnalysis = usePidAnalysisStore((s) => s.requestAiAnalysis);
  const applyRecommendation = usePidAnalysisStore((s) => s.applyRecommendation);
  const applyAllRecommended = usePidAnalysisStore((s) => s.applyAllRecommended);
  const saveAsComparison = usePidAnalysisStore((s) => s.saveAsComparison);

  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("summary");
  const [selectedStepEvent, setSelectedStepEvent] = useState(0);

  const stepIndex = STEPS.findIndex((s) => s.id === wizardStep);

  const canGoNext = useMemo(() => {
    switch (wizardStep) {
      case "upload": return !!analysisResult;
      case "analysis": return !!analysisResult;
      case "recommendations": return true;
      case "apply": return false;
    }
  }, [wizardStep, analysisResult]);

  const canGoBack = stepIndex > 0;

  const handleNext = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx < STEPS.length) setWizardStep(STEPS[nextIdx].id);
  }, [stepIndex, setWizardStep]);

  const handleBack = useCallback(() => {
    const prevIdx = stepIndex - 1;
    if (prevIdx >= 0) setWizardStep(STEPS[prevIdx].id);
  }, [stepIndex, setWizardStep]);

  const handleRequestAi = useCallback(() => {
    const currentParams: Record<string, number> = {};
    params.forEach((v, k) => { currentParams[k] = v; });
    requestAiAnalysis(vehicleType, currentParams);
  }, [params, vehicleType, requestAiAnalysis]);

  // Get step response events for selected axis
  const stepEvents: StepResponseEvent[] = useMemo(() => {
    if (!analysisResult) return [];
    const allEvents = [
      ...analysisResult.stepResponse.roll,
      ...analysisResult.stepResponse.pitch,
      ...analysisResult.stepResponse.yaw,
    ];
    return allEvents;
  }, [analysisResult]);

  return (
    <div className="space-y-4">
      <StepIndicator wizardStep={wizardStep} setWizardStep={setWizardStep} />

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20 text-[10px] text-status-error">
          <AlertTriangle size={12} />
          <span>{error}</span>
        </div>
      )}

      {/* Step content */}
      {wizardStep === "upload" && (
        <PidLogUploader
          onFileSelect={startAnalysis}
          onLoadSample={loadMockAnalysis}
          analyzing={analyzing}
          progress={analyzeProgress}
          metadata={analysisResult?.metadata ?? null}
        />
      )}

      {wizardStep === "analysis" && analysisResult && (
        <div className="space-y-3">
          {/* Tab strip */}
          <div className="flex gap-0 border-b border-border-default">
            {ANALYSIS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAnalysisTab(tab.id)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-medium border-b-2 transition-colors cursor-pointer",
                  analysisTab === tab.id
                    ? "border-accent-primary text-accent-primary"
                    : "border-transparent text-text-tertiary hover:text-text-secondary",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {analysisTab === "summary" && <PidAnalysisSummary result={analysisResult} />}

          {analysisTab === "fft" && (
            <div className="space-y-4">
              <PidFFTChart data={analysisResult.fft.roll} color="#3A82FF" />
              <PidFFTChart data={analysisResult.fft.pitch} color="#22c55e" />
              <PidFFTChart data={analysisResult.fft.yaw} color="#f59e0b" />
            </div>
          )}

          {analysisTab === "step" && (
            <div className="space-y-3">
              {stepEvents.length === 0 ? (
                <div className="text-[10px] text-text-tertiary text-center py-6">
                  No step response events detected in this log.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-tertiary">Event:</span>
                    <Select
                      value={String(selectedStepEvent)}
                      onChange={(v) => setSelectedStepEvent(Number(v))}
                      className="min-w-[16rem]"
                      options={stepEvents.map((ev, i) => ({
                        value: String(i),
                        label: `${ev.axis} #${i + 1} (${ev.overshootPercent.toFixed(1)}% overshoot)`,
                      }))}
                    />
                  </div>
                  {stepEvents[selectedStepEvent] && (
                    <PidStepResponseChart
                      event={stepEvents[selectedStepEvent]}
                      color={{ roll: "#3A82FF", pitch: "#22c55e", yaw: "#f59e0b" }[stepEvents[selectedStepEvent].axis]}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {analysisTab === "tracking" && (
            <div className="space-y-4">
              <PidTrackingChart data={analysisResult.tracking.roll} color="#3A82FF" />
              <PidTrackingChart data={analysisResult.tracking.pitch} color="#22c55e" />
              <PidTrackingChart data={analysisResult.tracking.yaw} color="#f59e0b" />
            </div>
          )}

          {analysisTab === "motors" && (
            <PidMotorChart data={analysisResult.motors} />
          )}
        </div>
      )}

      {wizardStep === "recommendations" && (
        <div className="space-y-3">
          {analysisResult && aiRecommendations.length === 0 && !aiLoading && (
            <div className="flex justify-center">
              <AiSuggestionsGate onRequestAi={handleRequestAi} connected={connected} />
            </div>
          )}
          <PidAiRecommendations
            recommendations={aiRecommendations}
            onApply={(id) => applyRecommendation(id, setLocalValue)}
            onApplyAll={() => applyAllRecommended(setLocalValue)}
            aiLoading={aiLoading}
          />
        </div>
      )}

      {wizardStep === "apply" && analysisResult && (
        <div className="space-y-3">
          {/* SITL warning */}
          <div className="flex items-center gap-2 p-2 bg-status-warning/10 border border-status-warning/20 text-[10px] text-status-warning">
            <AlertTriangle size={12} />
            <span>Test these settings in SITL or in a safe environment before flying.</span>
          </div>

          <PidComparisonView
            before={previousResult}
            current={analysisResult}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Save size={12} />}
              onClick={saveAsComparison}
            >
              Save as Baseline
            </Button>
            <span className="text-[10px] text-text-tertiary">
              Save current analysis, then re-analyze after tuning to compare.
            </span>
          </div>

          <p className="text-[10px] text-text-tertiary">
            Applied values appear in the PID sliders above as unsaved changes.
            Use &quot;Save to Flight Controller&quot; to write them.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-border-default">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={12} />}
          disabled={!canGoBack}
          onClick={handleBack}
        >
          Back
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!canGoNext}
          onClick={handleNext}
        >
          Next
          <ChevronRight size={12} />
        </Button>
      </div>
    </div>
  );
}
