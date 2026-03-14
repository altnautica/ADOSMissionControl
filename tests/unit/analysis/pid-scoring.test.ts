import { describe, it, expect } from 'vitest';
import { scoreFFTQuality, scoreStepResponse, detectIssues } from '@/lib/analysis/pid-scoring';
import type {
  FFTResult,
  FFTAxisResult,
  StepResponseResult,
  StepResponseEvent,
  TrackingQualityResult,
  TrackingAxisResult,
  MotorAnalysis,
  MotorAnalysisResult,
} from '@/lib/analysis/types';

function makeCleanAxis(axis: 'roll' | 'pitch' | 'yaw'): FFTAxisResult {
  return { axis, spectrum: [], sampleRate: 1000, peaks: [], noiseFloorDb: -80 };
}

function makeAxisWithPeaks(
  axis: 'roll' | 'pitch' | 'yaw',
  peaks: Array<{ frequency: number; magnitudeDb: number; zone: 'propwash' | 'motor' | 'structural' | 'unknown' }>,
  noiseFloorDb = -80,
): FFTAxisResult {
  return { axis, spectrum: [], sampleRate: 1000, peaks, noiseFloorDb };
}

function makeCleanFFT(): FFTResult {
  return { roll: makeCleanAxis('roll'), pitch: makeCleanAxis('pitch'), yaw: makeCleanAxis('yaw') };
}

function makeStepEvent(overrides: Partial<StepResponseEvent> = {}): StepResponseEvent {
  return {
    startTimeUs: 0,
    durationMs: 100,
    axis: 'roll',
    riseTimeMs: 30,
    overshootPercent: 10,
    settlingTimeMs: 100,
    dampingRatio: 0.8,
    desired: [],
    actual: [],
    ...overrides,
  };
}

function makeEmptyStep(): StepResponseResult {
  return { roll: [], pitch: [], yaw: [] };
}

function makeTrackingAxis(axis: 'roll' | 'pitch' | 'yaw', score: number, rmsError = 5, phaseLagMs = 2): TrackingAxisResult {
  return { axis, rmsError, phaseLagMs, score, desired: [], actual: [], error: [] };
}

function makeGoodTracking(): TrackingQualityResult {
  return {
    roll: makeTrackingAxis('roll', 85),
    pitch: makeTrackingAxis('pitch', 85),
    yaw: makeTrackingAxis('yaw', 85),
    overallScore: 85,
  };
}

function makeMotor(index: number, overrides: Partial<MotorAnalysisResult> = {}): MotorAnalysisResult {
  return {
    motorIndex: index,
    averagePwm: 1500,
    saturationPercent: 0,
    oscillationScore: 10,
    hasOscillation: false,
    ...overrides,
  };
}

function makeMotorAnalysis(overrides: Partial<MotorAnalysis> = {}): MotorAnalysis {
  return {
    motors: [makeMotor(0), makeMotor(1), makeMotor(2), makeMotor(3)],
    imbalanceScore: 2,
    healthScore: 95,
    timeSeries: { motors: [], motorCount: 4 },
    ...overrides,
  };
}

// ============================================================
// scoreFFTQuality
// ============================================================

describe('scoreFFTQuality', () => {
  it('returns 100 when no peaks across all axes', () => {
    expect(scoreFFTQuality(makeCleanFFT())).toBe(100);
  });

  it('lowers score when high prominence peaks exist', () => {
    const fft: FFTResult = {
      roll: makeAxisWithPeaks('roll', [
        { frequency: 50, magnitudeDb: -20, zone: 'propwash' },
      ], -80),
      pitch: makeCleanAxis('pitch'),
      yaw: makeCleanAxis('yaw'),
    };
    const score = scoreFFTQuality(fft);
    expect(score).toBeLessThan(100);
  });

  it('handles mixed axes — some with peaks, some without', () => {
    const fft: FFTResult = {
      roll: makeAxisWithPeaks('roll', [
        { frequency: 50, magnitudeDb: -40, zone: 'propwash' },
      ], -80),
      pitch: makeCleanAxis('pitch'),
      yaw: makeAxisWithPeaks('yaw', [
        { frequency: 300, magnitudeDb: -50, zone: 'motor' },
      ], -80),
    };
    const score = scoreFFTQuality(fft);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });
});

// ============================================================
// scoreStepResponse
// ============================================================

describe('scoreStepResponse', () => {
  it('returns 50 when no events', () => {
    expect(scoreStepResponse(makeEmptyStep())).toBe(50);
  });

  it('returns near 100 for perfect response', () => {
    const step: StepResponseResult = {
      roll: [makeStepEvent({ riseTimeMs: 20, overshootPercent: 5, settlingTimeMs: 50, dampingRatio: 0.8 })],
      pitch: [],
      yaw: [],
    };
    const score = scoreStepResponse(step);
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it('penalizes slow rise time (>50ms)', () => {
    const fast = scoreStepResponse({
      roll: [makeStepEvent({ riseTimeMs: 30 })],
      pitch: [],
      yaw: [],
    });
    const slow = scoreStepResponse({
      roll: [makeStepEvent({ riseTimeMs: 100 })],
      pitch: [],
      yaw: [],
    });
    expect(slow).toBeLessThan(fast);
  });

  it('penalizes high overshoot (>20%)', () => {
    const low = scoreStepResponse({
      roll: [makeStepEvent({ overshootPercent: 10 })],
      pitch: [],
      yaw: [],
    });
    const high = scoreStepResponse({
      roll: [makeStepEvent({ overshootPercent: 60 })],
      pitch: [],
      yaw: [],
    });
    expect(high).toBeLessThan(low);
  });

  it('penalizes long settling time (>200ms)', () => {
    const fast = scoreStepResponse({
      roll: [makeStepEvent({ settlingTimeMs: 100 })],
      pitch: [],
      yaw: [],
    });
    const slow = scoreStepResponse({
      roll: [makeStepEvent({ settlingTimeMs: 500 })],
      pitch: [],
      yaw: [],
    });
    expect(slow).toBeLessThan(fast);
  });

  it('penalizes under-damped (dampingRatio < 0.5)', () => {
    const good = scoreStepResponse({
      roll: [makeStepEvent({ dampingRatio: 0.8 })],
      pitch: [],
      yaw: [],
    });
    const under = scoreStepResponse({
      roll: [makeStepEvent({ dampingRatio: 0.2 })],
      pitch: [],
      yaw: [],
    });
    expect(under).toBeLessThan(good);
  });

  it('penalizes over-damped (dampingRatio > 1.5)', () => {
    const good = scoreStepResponse({
      roll: [makeStepEvent({ dampingRatio: 0.8 })],
      pitch: [],
      yaw: [],
    });
    const over = scoreStepResponse({
      roll: [makeStepEvent({ dampingRatio: 3.0 })],
      pitch: [],
      yaw: [],
    });
    expect(over).toBeLessThan(good);
  });
});

// ============================================================
// detectIssues
// ============================================================

describe('detectIssues', () => {
  it('returns empty issues for clean tune', () => {
    const issues = detectIssues(
      makeCleanFFT(),
      makeEmptyStep(),
      makeGoodTracking(),
      makeMotorAnalysis(),
      'good',
    );
    expect(issues).toHaveLength(0);
  });

  it('detects propwash oscillation with prominence > 10', () => {
    const fft: FFTResult = {
      roll: makeAxisWithPeaks('roll', [
        { frequency: 50, magnitudeDb: -60, zone: 'propwash' },
      ], -80),
      pitch: makeCleanAxis('pitch'),
      yaw: makeCleanAxis('yaw'),
    };
    const issues = detectIssues(fft, makeEmptyStep(), makeGoodTracking(), makeMotorAnalysis(), 'good');
    const propwash = issues.filter((i) => i.title.includes('Propwash'));
    expect(propwash.length).toBeGreaterThanOrEqual(1);
    expect(propwash[0].severity).toBe('warning');
  });

  it('detects critical propwash at prominence > 20', () => {
    const fft: FFTResult = {
      roll: makeAxisWithPeaks('roll', [
        { frequency: 50, magnitudeDb: -50, zone: 'propwash' },
      ], -80),
      pitch: makeCleanAxis('pitch'),
      yaw: makeCleanAxis('yaw'),
    };
    const issues = detectIssues(fft, makeEmptyStep(), makeGoodTracking(), makeMotorAnalysis(), 'good');
    const propwash = issues.filter((i) => i.title.includes('Propwash'));
    expect(propwash.length).toBeGreaterThanOrEqual(1);
    expect(propwash[0].severity).toBe('critical');
  });

  it('detects motor oscillation', () => {
    const motors = makeMotorAnalysis({
      motors: [makeMotor(0, { hasOscillation: true, oscillationScore: 60 }), makeMotor(1), makeMotor(2), makeMotor(3)],
    });
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), makeGoodTracking(), motors, 'good');
    const osc = issues.filter((i) => i.title.includes('oscillation'));
    expect(osc.length).toBeGreaterThanOrEqual(1);
  });

  it('detects motor saturation (saturationPercent > 5)', () => {
    const motors = makeMotorAnalysis({
      motors: [makeMotor(0, { saturationPercent: 10 }), makeMotor(1), makeMotor(2), makeMotor(3)],
    });
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), makeGoodTracking(), motors, 'good');
    const sat = issues.filter((i) => i.title.includes('saturation'));
    expect(sat.length).toBeGreaterThanOrEqual(1);
    expect(sat[0].severity).toBe('warning');
  });

  it('detects motor imbalance (imbalanceScore > 10)', () => {
    const motors = makeMotorAnalysis({ imbalanceScore: 15 });
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), makeGoodTracking(), motors, 'good');
    const imb = issues.filter((i) => i.title.includes('imbalance'));
    expect(imb.length).toBe(1);
    expect(imb[0].severity).toBe('warning');
  });

  it('detects poor tracking (score < 50)', () => {
    const tracking: TrackingQualityResult = {
      roll: makeTrackingAxis('roll', 30, 20, 10),
      pitch: makeTrackingAxis('pitch', 85),
      yaw: makeTrackingAxis('yaw', 85),
      overallScore: 67,
    };
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), tracking, makeMotorAnalysis(), 'good');
    const poor = issues.filter((i) => i.title.includes('Poor tracking'));
    expect(poor.length).toBe(1);
    expect(poor[0].affectedAxis).toBe('roll');
  });

  it('detects high overshoot (avgOvershoot > 30)', () => {
    const step: StepResponseResult = {
      roll: [makeStepEvent({ overshootPercent: 40 }), makeStepEvent({ overshootPercent: 50 })],
      pitch: [],
      yaw: [],
    };
    const issues = detectIssues(makeCleanFFT(), step, makeGoodTracking(), makeMotorAnalysis(), 'good');
    const overshoot = issues.filter((i) => i.title.includes('overshoot'));
    expect(overshoot.length).toBe(1);
    expect(overshoot[0].affectedAxis).toBe('roll');
  });

  it('adds critical issue for bad vibration', () => {
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), makeGoodTracking(), makeMotorAnalysis(), 'bad');
    const vib = issues.filter((i) => i.title.includes('vibration'));
    expect(vib.length).toBe(1);
    expect(vib[0].severity).toBe('critical');
  });

  it('adds warning issue for marginal vibration', () => {
    const issues = detectIssues(makeCleanFFT(), makeEmptyStep(), makeGoodTracking(), makeMotorAnalysis(), 'marginal');
    const vib = issues.filter((i) => i.title.includes('vibration'));
    expect(vib.length).toBe(1);
    expect(vib[0].severity).toBe('warning');
  });
});
