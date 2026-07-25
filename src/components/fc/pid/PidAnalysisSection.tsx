"use client";

import { useState, useCallback } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePidAnalysisStore } from "@/stores/pid-analysis-store";
import { PidAnalysisWizard } from "./PidAnalysisWizard";
import { PidLogUploader } from "./PidLogUploader";
import { PidAnalysisSummary } from "./PidAnalysisSummary";
import { PidFFTChart } from "./PidFFTChart";
import { PidStepResponseChart } from "./PidStepResponseChart";
import { PidTrackingChart } from "./PidTrackingChart";
import { PidMotorChart } from "./PidMotorChart";
import { PidAiRecommendations } from "./PidAiRecommendations";
import { PidLiveAnalysis } from "./PidLiveAnalysis";
import { AiSuggestionsGate } from "../shared/AiSuggestionsGate";
import type { VehicleType } from "./pid-constants";
import type { AnalysisMode } from "@/lib/analysis/types";

interface PidAnalysisSectionProps {
  vehicleType: VehicleType;
  params: Map<string, number>;
  setLocalValue: (name: string, value: number) => void;
  connected: boolean;
}

const AXIS_COLORS = { roll: "#3A82FF", pitch: "#22c55e", yaw: "#f59e0b" };

type QuickTab = "fft" | "step" | "tracking" | "motors";

export function PidAnalysisSection({
  vehicleType,
  params,
  setLocalValue,
  connected,
}: PidAnalysisSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const analysisMode = usePidAnalysisStore((s) => s.analysisMode);
  const setAnalysisMode = usePidAnalysisStore((s) => s.setAnalysisMode);
  const analysisResult = usePidAnalysisStore((s) => s.analysisResult);
  const aiRecommendations = usePidAnalysisStore((s) => s.aiRecommendations);
  const aiLoading = usePidAnalysisStore((s) => s.aiLoading);
  const analyzing = usePidAnalysisStore((s) => s.analyzing);
  const analyzeProgress = usePidAnalysisStore((s) => s.analyzeProgress);
  const startAnalysis = usePidAnalysisStore((s) => s.startAnalysis);
  const loadMockAnalysis = usePidAnalysisStore((s) => s.loadMockAnalysis);
  const requestAiAnalysis = usePidAnalysisStore((s) => s.requestAiAnalysis);
  const applyRecommendation = usePidAnalysisStore((s) => s.applyRecommendation);
  const applyAllRecommended = usePidAnalysisStore((s) => s.applyAllRecommended);

  const [quickTab, setQuickTab] = useState<QuickTab>("fft");
  const [stepEventIdx, setStepEventIdx] = useState(0);

  const handleRequestAi = useCallback(() => {
    const paramsObj: Record<string, number> = {};
    params.forEach((value, key) => {
      paramsObj[key] = value;
    });
    requestAiAnalysis(vehicleType, paramsObj);
  }, [params, vehicleType, requestAiAnalysis]);

  return (
    <div className="border border-border-default bg-bg-secondary">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50"
      >
        <Brain size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">AI Analysis &amp; Tuning</h2>
        <span className="text-[10px] text-text-tertiary ml-auto">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      <div className={cn(
        "grid transition-all duration-200 ease-in-out",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="overflow-hidden px-4 pb-4 space-y-4">
          {/* Live analysis strip */}
          <PidLiveAnalysis connected={connected} />

          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-bg-tertiary/50 p-0.5 w-fit">
            {(["wizard", "quick"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setAnalysisMode(mode)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  analysisMode === mode
                    ? "bg-accent-primary text-white"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {mode === "wizard" ? "Wizard" : "Quick"}
              </button>
            ))}
          </div>

          {/* Wizard mode */}
          {analysisMode === "wizard" && (
            <PidAnalysisWizard
              vehicleType={vehicleType}
              params={params}
              setLocalValue={setLocalValue}
              connected={connected}
            />
          )}

          {/* Quick mode */}
          {analysisMode === "quick" && (
            <div className="space-y-4">
              {/* Uploader */}
              <PidLogUploader
                onFileSelect={startAnalysis}
                onLoadSample={loadMockAnalysis}
                analyzing={analyzing}
                progress={analyzeProgress}
                metadata={analysisResult?.metadata ?? null}
              />

              {/* Results */}
              {analysisResult && (
                <>
                  <PidAnalysisSummary result={analysisResult} />

                  {/* Chart tabs */}
                  <div className="space-y-3">
                    <div className="flex gap-1 bg-bg-tertiary/50 p-0.5">
                      {(["fft", "step", "tracking", "motors"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setQuickTab(tab)}
                          className={cn(
                            "px-3 py-1.5 text-[10px] font-medium transition-colors cursor-pointer",
                            quickTab === tab
                              ? "bg-accent-primary text-white"
                              : "text-text-secondary hover:text-text-primary",
                          )}
                        >
                          {tab === "fft" ? "FFT" : tab === "step" ? "Step Response" : tab === "tracking" ? "Tracking" : "Motors"}
                        </button>
                      ))}
                    </div>

                    {quickTab === "fft" && (
                      <div className="space-y-3">
                        {(["roll", "pitch", "yaw"] as const).map((axis) => (
                          <div key={axis}>
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1 block">
                              {axis}
                            </span>
                            <PidFFTChart data={analysisResult.fft[axis]} color={AXIS_COLORS[axis]} />
                          </div>
                        ))}
                      </div>
                    )}

                    {quickTab === "step" && (
                      <div className="space-y-3">
                        {(["roll", "pitch", "yaw"] as const).map((axis) => {
                          const events = analysisResult.stepResponse[axis];
                          if (events.length === 0) {
                            return (
                              <div key={axis} className="text-[10px] text-text-tertiary py-4 text-center">
                                No step events on {axis}
                              </div>
                            );
                          }
                          const safeIdx = Math.min(stepEventIdx, events.length - 1);
                          return (
                            <div key={axis}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">
                                  {axis}
                                </span>
                                {events.length > 1 && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => setStepEventIdx(Math.max(0, safeIdx - 1))}
                                      disabled={safeIdx === 0}
                                      className="text-[9px] text-text-tertiary hover:text-text-primary disabled:opacity-30 cursor-pointer"
                                    >
                                      Prev
                                    </button>
                                    <span className="text-[9px] text-text-tertiary">
                                      {safeIdx + 1}/{events.length}
                                    </span>
                                    <button
                                      onClick={() => setStepEventIdx(Math.min(events.length - 1, safeIdx + 1))}
                                      disabled={safeIdx >= events.length - 1}
                                      className="text-[9px] text-text-tertiary hover:text-text-primary disabled:opacity-30 cursor-pointer"
                                    >
                                      Next
                                    </button>
                                  </div>
                                )}
                              </div>
                              <PidStepResponseChart event={events[safeIdx]} color={AXIS_COLORS[axis]} />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {quickTab === "tracking" && (
                      <div className="space-y-3">
                        {(["roll", "pitch", "yaw"] as const).map((axis) => (
                          <div key={axis}>
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1 block">
                              {axis}
                            </span>
                            <PidTrackingChart data={analysisResult.tracking[axis]} color={AXIS_COLORS[axis]} />
                          </div>
                        ))}
                      </div>
                    )}

                    {quickTab === "motors" && (
                      <PidMotorChart data={analysisResult.motors} />
                    )}
                  </div>

                  {/* AI Recommendations */}
                  <div className="space-y-2">
                    {aiRecommendations.length === 0 && !aiLoading && (
                      <AiSuggestionsGate onRequestAi={handleRequestAi} connected={connected} />
                    )}
                    <PidAiRecommendations
                      recommendations={aiRecommendations}
                      onApply={(id) => applyRecommendation(id, setLocalValue)}
                      onApplyAll={() => applyAllRecommended(setLocalValue)}
                      aiLoading={aiLoading}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
