/**
 * Flight phase detector.
 *
 * Walks recorded telemetry frames and segments the flight into
 * pre_arm / takeoff / climb / cruise / hover / descent / land / post_disarm.
 * Classification uses instantaneous altitude + groundspeed + a 3 s
 * hysteresis window to keep noisy verticalSpeed from flapping the phase
 * label on every sample.
 *
 * Pure function — no I/O, no side effects, safe to call from workers.
 *
 * @module flight-analysis/phase-detector
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import type { FlightPhase } from "@/lib/types";

type PhaseType = FlightPhase["type"];

// ── Tunables ─────────────────────────────────────────────────

/** Min time a new phase must persist before we accept it (ms). */
const HYSTERESIS_MS = 3000;

/** Vertical speed threshold for climb/descent in m/s. */
const VS_CLIMB_MS = 1.0;
const VS_DESCENT_MS = -1.0;

/** Ground speed threshold for cruise in m/s. */
const CRUISE_GS_MS = 2.0;

/** Hover ground speed ceiling for copters (m/s). */
const HOVER_GS_MS = 1.0;

/** Minimum altitude AGL (m) to be considered airborne at all. */
const AIRBORNE_ALT_M = 2.0;

/** First-N-seconds window classified as takeoff after leaving the ground. */
const TAKEOFF_WINDOW_MS = 8000;

/** Last-N-seconds window classified as land before disarm. */
const LAND_WINDOW_MS = 8000;

// ── Input parsing ────────────────────────────────────────────

interface Sample {
  tMs: number;
  alt: number;
  groundSpeed: number;
}

/** Extract time-ordered (alt, groundSpeed) samples from position + vfr frames. */
function extractSamples(frames: TelemetryFrame[]): Sample[] {
  const samples: Sample[] = [];
  for (const f of frames) {
    if (f.channel === "position" || f.channel === "globalPosition") {
      const d = f.data as { relativeAlt?: number; alt?: number; groundSpeed?: number };
      const alt = typeof d.relativeAlt === "number" ? d.relativeAlt : d.alt ?? 0;
      const gs = typeof d.groundSpeed === "number" ? d.groundSpeed : 0;
      samples.push({ tMs: f.offsetMs, alt, groundSpeed: gs });
    } else if (f.channel === "vfr") {
      const d = f.data as { alt?: number; groundspeed?: number };
      if (typeof d.alt === "number" || typeof d.groundspeed === "number") {
        samples.push({
          tMs: f.offsetMs,
          alt: d.alt ?? 0,
          groundSpeed: d.groundspeed ?? 0,
        });
      }
    }
  }
  samples.sort((a, b) => a.tMs - b.tMs);
  return samples;
}

/** Compute instantaneous vertical speed between adjacent samples. */
function verticalSpeedAt(samples: Sample[], idx: number): number {
  if (idx === 0) return 0;
  const prev = samples[idx - 1];
  const cur = samples[idx];
  const dt = (cur.tMs - prev.tMs) / 1000;
  if (dt <= 0) return 0;
  return (cur.alt - prev.alt) / dt;
}

// ── Raw classification ───────────────────────────────────────

function classifySample(
  s: Sample,
  verticalSpeed: number,
  phaseStartMs: number,
  durationMs: number,
): PhaseType {
  // Takeoff window: first TAKEOFF_WINDOW_MS after leaving the ground.
  if (s.tMs <= TAKEOFF_WINDOW_MS && s.alt > AIRBORNE_ALT_M && verticalSpeed > 0.5) {
    return "takeoff";
  }
  // Landing window: last LAND_WINDOW_MS before disarm.
  if (durationMs - s.tMs <= LAND_WINDOW_MS && s.alt < AIRBORNE_ALT_M * 2 && verticalSpeed < 0.5) {
    return "land";
  }

  // Ground state.
  if (s.alt < AIRBORNE_ALT_M && s.groundSpeed < HOVER_GS_MS) {
    return s.tMs < TAKEOFF_WINDOW_MS ? "pre_arm" : "post_disarm";
  }

  // Airborne classification.
  if (verticalSpeed > VS_CLIMB_MS) return "climb";
  if (verticalSpeed < VS_DESCENT_MS) return "descent";
  if (s.groundSpeed < HOVER_GS_MS && s.alt > AIRBORNE_ALT_M) return "hover";
  if (s.groundSpeed >= CRUISE_GS_MS) return "cruise";

  // Fallback: keep whatever we were doing (approximated to cruise).
  return "cruise";

  // (The phaseStartMs + durationMs parameters are reserved for future rules.)
  void phaseStartMs;
}

// ── Hysteresis + merge ───────────────────────────────────────

/**
 * Walk raw classifications and emit phase runs. Requires a new phase to
 * persist ≥ HYSTERESIS_MS before we commit to switching.
 */
function mergeRuns(classified: { tMs: number; type: PhaseType; s: Sample }[]): FlightPhase[] {
  if (classified.length === 0) return [];

  const result: FlightPhase[] = [];
  let curType: PhaseType = classified[0].type;
  let curStart = classified[0].tMs;
  let curSpeedSum = 0;
  let curSpeedN = 0;
  let curMaxAlt = 0;

  let pendingType: PhaseType | null = null;
  let pendingSince = 0;

  for (let i = 0; i < classified.length; i++) {
    const c = classified[i];

    // Accumulate stats for the running phase.
    if (c.type === curType) {
      curSpeedSum += c.s.groundSpeed;
      curSpeedN += 1;
      if (c.s.alt > curMaxAlt) curMaxAlt = c.s.alt;
      pendingType = null;
      continue;
    }

    // Different classification — require it to hold for HYSTERESIS_MS.
    if (pendingType !== c.type) {
      pendingType = c.type;
      pendingSince = c.tMs;
      continue;
    }

    if (c.tMs - pendingSince >= HYSTERESIS_MS) {
      // Commit the current run.
      result.push({
        type: curType,
        startMs: curStart,
        endMs: pendingSince,
        avgSpeed: curSpeedN > 0 ? Math.round((curSpeedSum / curSpeedN) * 10) / 10 : undefined,
        maxAlt: curMaxAlt > 0 ? Math.round(curMaxAlt) : undefined,
      });
      // Switch.
      curType = pendingType;
      curStart = pendingSince;
      curSpeedSum = c.s.groundSpeed;
      curSpeedN = 1;
      curMaxAlt = c.s.alt;
      pendingType = null;
    }
  }

  // Commit the final run.
  const last = classified[classified.length - 1];
  result.push({
    type: curType,
    startMs: curStart,
    endMs: last.tMs,
    avgSpeed: curSpeedN > 0 ? Math.round((curSpeedSum / curSpeedN) * 10) / 10 : undefined,
    maxAlt: curMaxAlt > 0 ? Math.round(curMaxAlt) : undefined,
  });

  return result;
}

// ── Public entry ─────────────────────────────────────────────

/**
 * Segment a recording into flight phases. Returns an empty array when the
 * input is too sparse to classify anything meaningful.
 */
export function detectPhases(frames: TelemetryFrame[]): FlightPhase[] {
  const samples = extractSamples(frames);
  if (samples.length < 2) return [];

  const durationMs = samples[samples.length - 1].tMs;
  const classified: { tMs: number; type: PhaseType; s: Sample }[] = samples.map((s, idx) => {
    const vs = verticalSpeedAt(samples, idx);
    const type = classifySample(s, vs, samples[0].tMs, durationMs);
    return { tMs: s.tMs, type, s };
  });

  return mergeRuns(classified);
}
