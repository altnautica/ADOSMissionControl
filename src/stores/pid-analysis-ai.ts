/**
 * AI analysis request logic for PID analysis store.
 *
 * Builds the condensed metrics payload and handles the API call
 * to /api/pid-analysis, including rate limiting and auth handling.
 *
 * @license GPL-3.0-only
 */

import type {
  PidAnalysisResult,
  AiRecommendation,
  AiAnalysisResponse,
  AiAnalysisRequest,
} from "@/lib/analysis/types";
import type { VehicleType } from "@/components/fc/pid/pid-constants";

export interface AiRequestResult {
  recommendations: AiRecommendation[];
  summary: string;
  remaining: number | null;
  weeklyLimit: number | null;
  error: string | null;
  rateLimited: boolean;
  needsAuth: boolean;
  notConfigured: boolean;
}

/**
 * Send analysis metrics to the AI endpoint and return parsed results.
 */
export async function requestAiPidAnalysis(
  analysisResult: PidAnalysisResult,
  vehicleType: VehicleType,
  currentParams: Record<string, number>,
): Promise<AiRequestResult> {
  // Build condensed metrics for the AI request
  const fftPeaks = (["roll", "pitch", "yaw"] as const).flatMap((axis) =>
    analysisResult.fft[axis].peaks.map((p) => ({
      axis,
      frequency: p.frequency,
      magnitudeDb: p.magnitudeDb,
      zone: p.zone,
    })),
  );

  // Only measured axes are sent: an axis without step events or rate data
  // is left out rather than reported as zeros.
  const stepResponse = (["roll", "pitch", "yaw"] as const).flatMap((axis) => {
    const events = analysisResult.stepResponse[axis];
    const count = events.length;
    if (count === 0) return [];
    return [{
      axis,
      avgOvershoot: events.reduce((s, e) => s + e.overshootPercent, 0) / count,
      avgUndershoot: events.reduce((s, e) => s + e.undershootPercent, 0) / count,
      avgRiseTime: events.reduce((s, e) => s + e.riseTimeMs, 0) / count,
      avgSettlingTime: events.reduce((s, e) => s + e.settlingTimeMs, 0) / count,
      avgDamping: events.reduce((s, e) => s + e.dampingRatio, 0) / count,
    }];
  });

  const tracking = (["roll", "pitch", "yaw"] as const).flatMap((axis) => {
    const { rmsError, score } = analysisResult.tracking[axis];
    return rmsError === null || score === null ? [] : [{ axis, rmsError, score }];
  });

  const body: AiAnalysisRequest = {
    vehicleType,
    currentParams,
    analysisMetrics: {
      tuneScore: analysisResult.tuneScore,
      fftPeaks,
      stepResponse,
      tracking,
      motorImbalance: analysisResult.motors.imbalanceScore,
      vibrationLevel: analysisResult.vibration?.level ?? null,
      issues: analysisResult.issues.map((i) => ({
        severity: i.severity,
        title: i.title,
        description: i.description,
      })),
    },
  };

  const res = await fetch("/api/pid-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    return {
      recommendations: [], summary: "", remaining: null, weeklyLimit: null,
      error: null, rateLimited: false, needsAuth: true, notConfigured: false,
    };
  }

  if (res.status === 503) {
    return {
      recommendations: [], summary: "", remaining: null, weeklyLimit: null,
      error: "AI analysis is not configured on this server. Set GROQ_API_KEY to enable it.",
      rateLimited: false, needsAuth: false, notConfigured: true,
    };
  }

  const data: AiAnalysisResponse = await res.json();

  if (res.status === 429) {
    return {
      recommendations: [], summary: "", remaining: 0, weeklyLimit: data.weeklyLimit ?? null,
      error: "Weekly AI analysis limit reached. Resets Monday.",
      rateLimited: true, needsAuth: false, notConfigured: false,
    };
  }

  if (data.error) {
    return {
      recommendations: [], summary: "", remaining: data.remaining ?? null,
      weeklyLimit: data.weeklyLimit ?? null,
      error: data.error, rateLimited: false, needsAuth: false, notConfigured: false,
    };
  }

  return {
    recommendations: data.recommendations,
    summary: data.summary,
    remaining: data.remaining ?? null,
    weeklyLimit: data.weeklyLimit ?? null,
    error: null, rateLimited: false, needsAuth: false, notConfigured: false,
  };
}
