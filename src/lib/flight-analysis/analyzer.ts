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
import { THRESHOLDS } from "./thresholds";

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

export function analyzeFlight(frames: TelemetryFrame[]): AnalyzeResult {
  const events: FlightEvent[] = [];
  const flags: FlightFlag[] = [];

  // Trackers
  let firstPosT: number | undefined;
  let lastPosT: number | undefined;
  let lastBatteryRemaining: number | undefined;
  let lastBatteryAlertedLow = false;
  let lastBatteryAlertedCritical = false;
  let lastSatCount: number | undefined;
  let lastGpsFixOk = true;

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
      const d = frame.data as PositionFrame;
      if (firstPosT === undefined) {
        firstPosT = t;
        events.push({ t, type: "takeoff", severity: "info", label: "Takeoff" });
      }
      lastPosT = t;
    } else if (frame.channel === "battery") {
      const d = frame.data as BatteryFrame;
      // -1 is the autopilot's "remaining not measured", not an empty pack.
      if (typeof d.remaining === "number" && d.remaining >= 0) {
        if (batteryStartPct === undefined) batteryStartPct = d.remaining;
        batteryEndPct = d.remaining;

        if (!lastBatteryAlertedCritical && d.remaining <= THRESHOLDS.batteryCriticalPct) {
          events.push({
            t,
            type: "battery_critical",
            severity: "error",
            label: `Battery critical (${d.remaining}%)`,
            data: { remaining: d.remaining },
          });
          lastBatteryAlertedCritical = true;
        } else if (!lastBatteryAlertedLow && d.remaining <= THRESHOLDS.batteryLowPct) {
          events.push({
            t,
            type: "battery_low",
            severity: "warning",
            label: `Battery low (${d.remaining}%)`,
            data: { remaining: d.remaining },
          });
          lastBatteryAlertedLow = true;
        }
        lastBatteryRemaining = d.remaining;
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
        events.push({
          t,
          type: "vibration_spike",
          severity: "warning",
          label: `Vibration spike (RMS ${rms.toFixed(1)} m/s²)`,
          data: { rms },
        });
      }
    } else if (frame.channel === "sysStatus") {
      const d = frame.data as SysStatusFrame;
      if (typeof d.batteryRemaining === "number" && d.batteryRemaining >= 0 && d.batteryRemaining < THRESHOLDS.batteryCriticalPct) {
        // Treat as a failsafe-class event once.
        if (!events.some((e) => e.type === "failsafe_battery")) {
          events.push({
            t,
            type: "failsafe_battery",
            severity: "error",
            label: "Battery failsafe",
            data: { remaining: d.batteryRemaining },
          });
        }
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

  // Add final landing event from last position frame.
  if (lastPosT !== undefined && lastPosT !== firstPosT) {
    events.push({ t: lastPosT, type: "land", severity: "info", label: "Land" });
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

  let batteryHealthPct: number | undefined;
  if (batteryStartPct !== undefined && batteryEndPct !== undefined) {
    batteryHealthPct = Math.max(0, Math.min(100, batteryStartPct - batteryEndPct));
  } else if (lastBatteryRemaining !== undefined) {
    batteryHealthPct = Math.max(0, 100 - lastBatteryRemaining);
  }

  const health: HealthSummary = {
    avgSatellites: meanSats !== undefined ? Math.round(meanSats * 10) / 10 : undefined,
    avgHdop: meanHdop !== undefined ? Math.round(meanHdop * 100) / 100 : undefined,
    maxVibrationRms: vibrationRmsN > 0 ? Math.round(maxVibrationRms * 10) / 10 : undefined,
    batteryHealthPct,
  };

  return { events, flags, health };
}
