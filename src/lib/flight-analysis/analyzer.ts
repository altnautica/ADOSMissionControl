/**
 * Flight analyzer — pure function over recorded telemetry frames.
 *
 * Walks the recording once and produces:
 *  - {@link FlightEvent}s — discrete moments worth marking on the timeline
 *  - {@link FlightFlag}s — higher-level summaries / anomaly hints
 *  - {@link HealthSummary} — averaged stats for the Health card
 *
 * No I/O. Tests are tracked separately.
 *
 * @module flight-analysis/analyzer
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import type { FlightEvent, FlightFlag, HealthSummary } from "@/lib/types";
import { AIRBORNE_ALT_M } from "./phase-detector";
import { THRESHOLDS } from "./thresholds";
import { knownRemainingPct } from "@/lib/battery";

export interface AnalyzeResult {
  events: FlightEvent[];
  flags: FlightFlag[];
  health: HealthSummary;
}

interface PositionFrame { lat: number; lon: number; relativeAlt?: number; alt?: number; groundSpeed?: number }
interface BatteryFrame { voltage: number; remaining: number }
interface GpsFrame { fixType: number; satellites: number; hdop: number }
interface VibrationFrame { vibrationX: number; vibrationY: number; vibrationZ: number }
interface SysStatusFrame { batteryRemaining: number }
interface EkfFrame {
  flags?: number;
  velocityVariance?: number;
  posHorizVariance?: number;
  posVertVariance?: number;
  compassVariance?: number;
}

/** Variance fields checked against the EKF levels, with their labels. */
const EKF_VARIANCE_FIELDS = [
  ["velocityVariance", "velocity"],
  ["posHorizVariance", "horizontal position"],
  ["posVertVariance", "vertical position"],
  ["compassVariance", "compass"],
] as const;

/**
 * EKF_STATUS_FLAGS bits that report a fault. Every other bit reports a
 * healthy estimate, so a healthy EKF sends a non-zero bitmask.
 */
const EKF_FAULT_BITS = [
  { bit: 128, type: "ekf_const_pos_mode", severity: "warning", label: "EKF in constant position mode" },
  { bit: 1024, type: "ekf_uninitialized", severity: "error", label: "EKF uninitialized" },
  { bit: 32768, type: "ekf_gps_glitch", severity: "warning", label: "EKF reports GPS glitching" },
] as const;

/** Minimum spacing between two EKF variance events. */
const EKF_VARIANCE_EVENT_SPACING_MS = 5000;

/**
 * Over-threshold vibration samples closer together than this belong to one
 * spike, reported once with its start, end and peak.
 */
const VIBRATION_SPIKE_MERGE_MS = 5000;

function vibrationSpikeLabel(peak: number, durationMs: number): string {
  const base = `Vibration spike (peak RMS ${peak.toFixed(1)} m/s²`;
  return durationMs > 0 ? `${base}, ${(durationMs / 1000).toFixed(1)} s)` : `${base})`;
}

export function analyzeFlight(frames: TelemetryFrame[]): AnalyzeResult {
  const events: FlightEvent[] = [];
  const flags: FlightFlag[] = [];

  // Trackers
  let airborne = false;
  let takeoffT: number | undefined;
  let landT: number | undefined;
  let lastBatteryAlertedLow = false;
  let lastBatteryAlertedCritical = false;
  let batteryBelowReported = false;
  let lastSatCount: number | undefined;
  let lastGpsFixOk = true;
  let vibrationSpike: FlightEvent | undefined;
  let vibrationSpikeEndT = -Infinity;
  let vibrationSpikePeak = 0;
  // Health accumulators
  let satSum = 0;
  let satN = 0;
  let hdopSum = 0;
  let hdopN = 0;
  let vibrationRmsSum = 0;
  let vibrationRmsN = 0;
  let maxVibrationRms = 0;
  let batteryStartPct: number | undefined;
  let batteryEndPct: number | undefined;
  let lastEkfVarianceT = -Infinity;
  let prevEkfFlags: number | undefined;

  // For battery sag (voltage drop within ~1 s)
  const batteryVoltageWindow: { t: number; v: number }[] = [];
  const SAG_WINDOW_MS = 1000;
  let sagFlagged = false;

  for (const frame of frames) {
    const t = frame.offsetMs;

    if (frame.channel === "position" || frame.channel === "globalPosition") {
      // Takeoff and land are the height-above-home crossings of the airborne
      // threshold, so a bench arm/disarm that never leaves the ground
      // records neither. A log that ends in the air has no land event.
      const d = frame.data as PositionFrame;
      if (typeof d.relativeAlt === "number") {
        const nowAirborne = d.relativeAlt > AIRBORNE_ALT_M;
        if (nowAirborne && !airborne) {
          if (takeoffT === undefined) {
            takeoffT = t;
            events.push({ t, type: "takeoff", severity: "info", label: "Takeoff" });
          }
          landT = undefined;
        } else if (!nowAirborne && airborne) {
          landT = t;
        }
        airborne = nowAirborne;
      }
    } else if (frame.channel === "battery") {
      const d = frame.data as BatteryFrame;
      const remaining = knownRemainingPct(d.remaining);
      if (remaining !== null) {
        if (batteryStartPct === undefined) batteryStartPct = remaining;
        batteryEndPct = remaining;

        if (!lastBatteryAlertedCritical && remaining <= THRESHOLDS.batteryCriticalPct) {
          events.push({
            t,
            type: "battery_critical",
            severity: "error",
            label: `Battery critical (${remaining}%)`,
            data: { remaining },
          });
          lastBatteryAlertedCritical = true;
        } else if (!lastBatteryAlertedLow && remaining <= THRESHOLDS.batteryLowPct) {
          events.push({
            t,
            type: "battery_low",
            severity: "warning",
            label: `Battery low (${remaining}%)`,
            data: { remaining },
          });
          lastBatteryAlertedLow = true;
        }
      }

      if (typeof d.voltage === "number") {
        // Sag detection: voltage drop > threshold within SAG_WINDOW_MS
        batteryVoltageWindow.push({ t, v: d.voltage });
        // Trim old window entries
        while (
          batteryVoltageWindow.length > 0 &&
          t - batteryVoltageWindow[0].t > SAG_WINDOW_MS
        ) {
          batteryVoltageWindow.shift();
        }
        if (!sagFlagged && batteryVoltageWindow.length >= 2) {
          const vMax = Math.max(...batteryVoltageWindow.map((x) => x.v));
          const vMin = Math.min(...batteryVoltageWindow.map((x) => x.v));
          if (vMax - vMin >= THRESHOLDS.batterySagVolts) {
            flags.push({
              type: "battery_sag",
              severity: "warning",
              message: `Battery sag detected: ${(vMax - vMin).toFixed(2)} V drop within ${SAG_WINDOW_MS} ms`,
              suggestion: "Check battery health and current draw.",
            });
            sagFlagged = true;
          }
        }
      }
    } else if (frame.channel === "gps") {
      const d = frame.data as GpsFrame;
      if (typeof d.satellites === "number") {
        satSum += d.satellites;
        satN += 1;

        if (lastSatCount !== undefined) {
          const drop = lastSatCount - d.satellites;
          if (drop >= THRESHOLDS.gpsGlitchSatDrop) {
            events.push({
              t,
              type: "gps_glitch",
              severity: "warning",
              label: `GPS sats dropped ${drop} → ${d.satellites}`,
              data: { from: lastSatCount, to: d.satellites },
            });
          }
        }
        lastSatCount = d.satellites;
      }
      if (typeof d.hdop === "number") {
        hdopSum += d.hdop;
        hdopN += 1;
      }
      if (typeof d.fixType === "number") {
        const fixOk = d.fixType >= 3;
        if (lastGpsFixOk && !fixOk) {
          events.push({
            t,
            type: "gps_lost",
            severity: "error",
            label: "GPS fix lost",
            data: { fixType: d.fixType },
          });
        }
        lastGpsFixOk = fixOk;
      }
    } else if (frame.channel === "vibration") {
      const d = frame.data as VibrationFrame;
      const rms = Math.sqrt(
        ((d.vibrationX ?? 0) ** 2 + (d.vibrationY ?? 0) ** 2 + (d.vibrationZ ?? 0) ** 2) / 3,
      );
      vibrationRmsSum += rms;
      vibrationRmsN += 1;
      if (rms > maxVibrationRms) maxVibrationRms = rms;
      if (rms >= THRESHOLDS.vibrationSpikeRms) {
        if (vibrationSpike && t - vibrationSpikeEndT <= VIBRATION_SPIKE_MERGE_MS) {
          vibrationSpikeEndT = t;
          if (rms > vibrationSpikePeak) vibrationSpikePeak = rms;
          vibrationSpike.label = vibrationSpikeLabel(vibrationSpikePeak, t - vibrationSpike.t);
          vibrationSpike.data = { rms: vibrationSpikePeak, endT: t };
        } else {
          vibrationSpike = {
            t,
            type: "vibration_spike",
            severity: "warning",
            label: vibrationSpikeLabel(rms, 0),
            data: { rms, endT: t },
          };
          vibrationSpikeEndT = t;
          vibrationSpikePeak = rms;
          events.push(vibrationSpike);
        }
      }
    } else if (frame.channel === "sysStatus") {
      const d = frame.data as SysStatusFrame;
      const remaining = knownRemainingPct(d.batteryRemaining);
      // SYS_STATUS carries the same remaining % as BATTERY_STATUS. It is a
      // reading, not an autopilot failsafe, and is reported once only when
      // the battery stream has not already raised the critical event.
      if (
        !batteryBelowReported &&
        !lastBatteryAlertedCritical &&
        remaining !== null &&
        remaining < THRESHOLDS.batteryCriticalPct
      ) {
        events.push({
          t,
          type: "battery_below",
          severity: "warning",
          label: `Battery below ${THRESHOLDS.batteryCriticalPct}%`,
          data: { remaining },
        });
        batteryBelowReported = true;
      }
    } else if (frame.channel === "ekf") {
      const d = frame.data as EkfFrame;
      let worstField: (typeof EKF_VARIANCE_FIELDS)[number] | undefined;
      let worstValue = -Infinity;
      for (const field of EKF_VARIANCE_FIELDS) {
        const value = d[field[0]];
        if (typeof value === "number" && value > worstValue) {
          worstValue = value;
          worstField = field;
        }
      }
      if (
        worstField &&
        worstValue >= THRESHOLDS.ekfVarianceWarn &&
        t - lastEkfVarianceT >= EKF_VARIANCE_EVENT_SPACING_MS
      ) {
        events.push({
          t,
          type: "ekf_variance",
          severity: worstValue >= THRESHOLDS.ekfVarianceError ? "error" : "warning",
          label: `EKF ${worstField[1]} variance ${worstValue.toFixed(2)}`,
          data: { field: worstField[0], value: worstValue },
        });
        lastEkfVarianceT = t;
      }
      // Fault bits are reported when they turn on. A bit already set on the
      // first sample (a non-GPS flight in constant position mode) is the
      // flight's normal state, not an event.
      if (typeof d.flags === "number") {
        if (prevEkfFlags !== undefined) {
          for (const fault of EKF_FAULT_BITS) {
            if ((d.flags & fault.bit) !== 0 && (prevEkfFlags & fault.bit) === 0) {
              events.push({
                t,
                type: fault.type,
                severity: fault.severity,
                label: fault.label,
                data: { flags: d.flags },
              });
            }
          }
        }
        prevEkfFlags = d.flags;
      }
    }
  }

  if (landT !== undefined) {
    events.push({ t: landT, type: "land", severity: "info", label: "Land" });
  }

  // ── Aggregate flags ─────────────────────────────────────────

  const meanSats = satN > 0 ? satSum / satN : undefined;
  const meanHdop = hdopN > 0 ? hdopSum / hdopN : undefined;
  const meanVibrationRms = vibrationRmsN > 0 ? vibrationRmsSum / vibrationRmsN : undefined;

  if (meanVibrationRms !== undefined && meanVibrationRms >= THRESHOLDS.vibrationHighRmsMean) {
    flags.push({
      type: "vibration_high",
      severity: "warning",
      message: `Mean vibration RMS ${meanVibrationRms.toFixed(1)} m/s² (threshold ${THRESHOLDS.vibrationHighRmsMean}).`,
      suggestion: "Check prop balance, motor mounts, frame rigidity.",
    });
  }
  if (
    (meanSats !== undefined && meanSats < THRESHOLDS.gpsPoorMeanSats) ||
    (meanHdop !== undefined && meanHdop > THRESHOLDS.gpsPoorMeanHdop)
  ) {
    flags.push({
      type: "gps_quality_poor",
      severity: "warning",
      message: `GPS quality below threshold (sats avg ${meanSats?.toFixed(1) ?? "—"}, HDOP avg ${meanHdop?.toFixed(2) ?? "—"}).`,
      suggestion: "Avoid magnetic interference; check antenna mounting and sky visibility.",
    });
  }

  // ── Health summary ──────────────────────────────────────────

  const batteryHealthPct =
    batteryStartPct !== undefined && batteryEndPct !== undefined
      ? Math.max(0, Math.min(100, batteryStartPct - batteryEndPct))
      : undefined;

  const health: HealthSummary = {
    avgSatellites: meanSats !== undefined ? Math.round(meanSats * 10) / 10 : undefined,
    avgHdop: meanHdop !== undefined ? Math.round(meanHdop * 100) / 100 : undefined,
    maxVibrationRms: vibrationRmsN > 0 ? Math.round(maxVibrationRms * 10) / 10 : undefined,
    batteryHealthPct,
  };

  return { events, flags, health };
}
