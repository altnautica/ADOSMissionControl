/**
 * Zustand store for PID analysis state.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  PidAnalysisResult,
  AiRecommendation,
  WizardStep,
  AnalysisMode,
  WorkerOutMessage,
} from "@/lib/analysis/types";
import type { VehicleType } from "@/components/fc/pid/pid-constants";
import { validateSuggestion } from "@/lib/analysis/pid-safety";
import { requestAiPidAnalysis } from "./pid-analysis-ai";
import { formatErrorMessage } from "@/lib/utils";

/** Where validated suggestions are written, and what they are checked against. */
export interface SuggestionTarget {
  vehicleType: VehicleType;
  /** Values confirmed on the flight controller (loaded or saved, no pending local edit). */
  fcParams: ReadonlyMap<string, number>;
  setLocalValue: (name: string, value: number) => void;
}

/** Count of suggested parameter changes by outcome after an apply. */
export interface ApplySummary {
  applied: number;
  clamped: number;
  rejected: number;
}

function applySuggestions(recs: AiRecommendation[], target: SuggestionTarget): ApplySummary {
  const summary: ApplySummary = { applied: 0, clamped: 0, rejected: 0 };
  for (const rec of recs) {
    for (const p of rec.parameters) {
      const check = validateSuggestion(
        p.param,
        target.fcParams.get(p.param),
        p.suggestedValue,
        target.vehicleType,
      );
      if (check.status === "rejected") {
        summary.rejected++;
        continue;
      }
      target.setLocalValue(p.param, check.value);
      if (check.status === "clamped") summary.clamped++;
      else summary.applied++;
    }
  }
  return summary;
}

interface PidAnalysisState {
  // Analysis state
  analysisResult: PidAnalysisResult | null;
  aiRecommendations: AiRecommendation[];
  aiSummary: string;

  // Loading states
  analyzing: boolean;
  analyzeProgress: { stage: string; percent: number } | null;
  aiLoading: boolean;
  error: string | null;

  // AI usage tracking
  aiRemainingUses: number | null;
  aiWeeklyLimit: number | null;

  // UI state
  wizardStep: WizardStep;
  analysisMode: AnalysisMode;
  logFileName: string | null;

  // Comparison
  previousResult: PidAnalysisResult | null;
}

interface PidAnalysisActions {
  // Core actions
  startAnalysis: (file: File) => void;
  loadMockAnalysis: () => void;
  requestAiAnalysis: (
    vehicleType: VehicleType,
    currentParams: Record<string, number>,
  ) => Promise<void>;

  // Recommendation actions. Every suggestion is validated against the FC's
  // confirmed value; rejected ones are skipped, the rest may be limited.
  applyRecommendation: (id: string, target: SuggestionTarget) => ApplySummary;
  applyAllRecommended: (target: SuggestionTarget) => ApplySummary;

  // Usage tracking
  setAiUsageInfo: (remaining: number | null, weeklyLimit: number | null) => void;

  // UI actions
  setWizardStep: (step: WizardStep) => void;
  setAnalysisMode: (mode: AnalysisMode) => void;
  saveAsComparison: () => void;

  // Reset
  reset: () => void;
  clearRecommendations: () => void;
}

const initialState: PidAnalysisState = {
  analysisResult: null,
  aiRecommendations: [],
  aiSummary: "",
  analyzing: false,
  analyzeProgress: null,
  aiLoading: false,
  error: null,
  aiRemainingUses: null,
  aiWeeklyLimit: null,
  wizardStep: "upload",
  analysisMode: "wizard",
  logFileName: null,
  previousResult: null,
};

let activeWorker: Worker | null = null;

export const usePidAnalysisStore = create<PidAnalysisState & PidAnalysisActions>(
  (set, get) => ({
    ...initialState,

    // ── Core actions ──────────────────────────────────────────────────────

    startAnalysis: (file: File) => {
      // Terminate any running worker
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }

      set({
        analyzing: true,
        analyzeProgress: { stage: "Reading file", percent: 0 },
        error: null,
        analysisResult: null,
        aiRecommendations: [],
        aiSummary: "",
        logFileName: file.name,
        wizardStep: "analysis",
      });

      const worker = new Worker(
        new URL("../lib/analysis/pid-analysis-worker.ts", import.meta.url),
      );
      activeWorker = worker;

      worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            set({ analyzeProgress: { stage: msg.stage, percent: msg.percent } });
            break;
          case "result":
            set({
              analysisResult: msg.data,
              analyzing: false,
              analyzeProgress: null,
              wizardStep: "recommendations",
            });
            activeWorker = null;
            worker.terminate();
            break;
          case "error":
            set({
              error: msg.message,
              analyzing: false,
              analyzeProgress: null,
            });
            activeWorker = null;
            worker.terminate();
            break;
        }
      };

      worker.onerror = (e) => {
        set({
          error: e.message || "Analysis worker crashed",
          analyzing: false,
          analyzeProgress: null,
        });
        activeWorker = null;
      };

      // Read file and send buffer to worker
      file.arrayBuffer().then((buffer) => {
        worker.postMessage({ type: "analyze", buffer }, [buffer]);
      });
    },

    loadMockAnalysis: () => {
      set({
        analyzing: true,
        analyzeProgress: { stage: "Loading mock data", percent: 50 },
        error: null,
        logFileName: "demo-flight.bin",
        wizardStep: "analysis",
      });

      // Dynamic import to avoid bundling mock data in production
      import("@/mock/mock-pid-analysis").then(
        ({ MOCK_PID_ANALYSIS_RESULT, MOCK_AI_RECOMMENDATIONS, MOCK_AI_SUMMARY }) => {
          set({
            analysisResult: MOCK_PID_ANALYSIS_RESULT,
            aiRecommendations: MOCK_AI_RECOMMENDATIONS,
            aiSummary: MOCK_AI_SUMMARY,
            analyzing: false,
            analyzeProgress: null,
            wizardStep: "recommendations",
          });
        },
      ).catch((err) => {
        set({
          error: `Failed to load mock data: ${formatErrorMessage(err)}`,
          analyzing: false,
          analyzeProgress: null,
        });
      });
    },

    requestAiAnalysis: async (
      vehicleType: VehicleType,
      currentParams: Record<string, number>,
    ) => {
      const { analysisResult } = get();
      if (!analysisResult) return;

      set({ aiLoading: true, error: null });

      try {
        const result = await requestAiPidAnalysis(analysisResult, vehicleType, currentParams);

        if (result.needsAuth) {
          set({ aiLoading: false });
          window.dispatchEvent(new CustomEvent("open-signin"));
          return;
        }

        if (result.error) {
          set({
            error: result.error,
            aiLoading: false,
            ...(result.rateLimited ? { aiRemainingUses: 0, aiWeeklyLimit: result.weeklyLimit } : {}),
          });
          return;
        }

        set({
          aiRecommendations: result.recommendations,
          aiSummary: result.summary,
          aiLoading: false,
          aiRemainingUses: result.remaining,
          aiWeeklyLimit: result.weeklyLimit,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        set({ error: message, aiLoading: false });
      }
    },

    // ── Recommendation actions ────────────────────────────────────────────

    applyRecommendation: (id: string, target: SuggestionTarget) => {
      const rec = get().aiRecommendations.find((r) => r.id === id);
      return applySuggestions(rec ? [rec] : [], target);
    },

    applyAllRecommended: (target: SuggestionTarget) =>
      applySuggestions(get().aiRecommendations.filter((r) => r.confidence >= 80), target),

    // ── Usage tracking ──────────────────────────────────────────────────

    setAiUsageInfo: (remaining: number | null, weeklyLimit: number | null) =>
      set({ aiRemainingUses: remaining, aiWeeklyLimit: weeklyLimit }),

    // ── UI actions ────────────────────────────────────────────────────────

    setWizardStep: (step: WizardStep) => set({ wizardStep: step }),

    setAnalysisMode: (mode: AnalysisMode) => set({ analysisMode: mode }),

    saveAsComparison: () => {
      const { analysisResult } = get();
      if (analysisResult) {
        set({ previousResult: analysisResult });
      }
    },

    // ── Reset ─────────────────────────────────────────────────────────────

    reset: () => {
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }
      set(initialState);
    },

    clearRecommendations: () => {
      set({ aiRecommendations: [], aiSummary: "" });
    },
  }),
);
