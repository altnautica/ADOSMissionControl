/**
 * PID analysis engine — barrel export.
 *
 * @license GPL-3.0-only
 */

// Types
export type {
  TimeSample,
  AxisTimeSeries,
  MotorTimeSeries,
  FFTBin,
  FFTAxisResult,
  FFTPeak,
  FFTResult,
  StepResponseEvent,
  StepResponseResult,
  TrackingAxisResult,
  TrackingQualityResult,
  MotorAnalysisResult,
  MotorAnalysis,
  VibrationSummary,
  LogMetadata,
  PidAnalysisResult,
  TuneIssue,
  ParameterSuggestion,
  AiRecommendation,
  AiAnalysisRequest,
  AiAnalysisResponse,
  ParamSafetyRange,
  WorkerInMessage,
  WorkerOutMessage,
  WizardStep,
  AnalysisMode,
} from "./types";

// FFT
export { computeFFT } from "./fft";

// Step response
export { extractStepResponses } from "./step-response";

// Tracking quality
export { analyzeTracking } from "./tracking-quality";

// Motor analysis
export { analyzeMotors } from "./motor-analysis";

// Safety
export { getSafetyRange, validateSuggestion } from "./pid-safety";
export type { SuggestionCheck } from "./pid-safety";

// Log extraction
export {
  extractLogData,
  extractVibration,
  extractLogMetadata,
} from "./log-extractor";
export type { ExtractedLogData } from "./log-extractor";
