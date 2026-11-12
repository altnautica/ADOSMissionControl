/**
 * Calibration status subscription logic — subscribes to MAVLink STATUSTEXT,
 * MAG_CAL_PROGRESS, MAG_CAL_REPORT, ACCEL_CAL_POS, and ATTITUDE for
 * calibration progress tracking.
 */

import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import {
  type CalibrationState,
  INITIAL_STATE,
  ACCEL_STEPS,
  TYPE_KEYWORDS,
} from "./calibration-types";
import type { DroneProtocol } from "@/lib/protocol/types";
import { addSub, cleanupSubs, resetTimeout } from "./cal-sub-helpers";
import { subscribeCompassCalibration } from "./compass-cal-subscriptions";

// Re-export helpers so existing importers don't break
export { addSub, cleanupSubs, resetTimeout } from "./cal-sub-helpers";

export function subscribeToCalibrationStatus(
  manager: { subsRef: React.MutableRefObject<Map<string, (() => void)[]>>; timeoutRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>> },
  protocol: DroneProtocol,
  setter: React.Dispatch<React.SetStateAction<CalibrationState>>,
  stepCount: number,
  calType: string,
  /** Announces a calibration that finished (`ok`) or failed; the caller words it. */
  notify: (calType: string, ok: boolean) => void,
  isPx4 = false,
) {
  cleanupSubs(manager, calType);

  const keywords = TYPE_KEYWORDS[calType] ?? [];
  // ArduPilot compass cal owns its timeout via the MAG_CAL stall detector below, so
  // the generic timer must not shadow it. PX4 (any type, incl. compass, which reports
  // through the [cal] STATUSTEXT parser) keeps the generic backstop.
  if (calType !== "compass" || isPx4) resetTimeout(manager, calType, setter);

  const statusUnsub = protocol.onStatusText(({ text }) => {
    const lower = text.toLowerCase();
    const typeRelevant =
      keywords.some((kw) => lower.includes(kw)) || lower.includes(calType);

    // The flight controller ends a calibration with a bare terminal STATUSTEXT that
    // carries no per-sensor keyword — ArduPilot emits exactly "Calibration successful"
    // / "Calibration FAILED". Those must reach the running calibration even though the
    // keyword gate ("accel", "place vehicle", …) would otherwise drop them. Fuzzy
    // completion phrases still require type relevance. Only one calibration runs at a
    // time (the status === "in_progress" guard prevents any double-application), and a
    // terminal string that explicitly names a different sensor domain is not applied to
    // this subscription, so concurrent cals cannot cross-complete.
    const isTerminalSuccess =
      lower.includes("calibration successful") ||
      lower.includes("calibration done") ||
      lower.includes("calibration complete") ||
      (lower.includes("calibrated") && lower.includes("requires reboot"));
    const isFuzzySuccess =
      lower.includes("trim ok") ||
      lower.includes("trim saved") ||
      lower.includes("cal done") ||
      lower.includes("offsets saved") ||
      lower.includes("offsets complete") ||
      lower.includes("cal complete");
    const isSuccessMessage = isTerminalSuccess || isFuzzySuccess;
    const isFailureMessage =
      lower.includes("calibration failed") || lower.includes("cal failed");
    // Non-compass subscriptions ignore a terminal that names "compass" (and vice
    // versa) so an unrelated sensor's terminal string never finishes this cal.
    const namesOtherSensor = calType === "compass"
      ? false
      : lower.includes("compass");
    const terminalForThisCal = !namesOtherSensor;

    if (isSuccessMessage) {
      // Fuzzy phrases require type relevance; terminal strings apply to the running cal.
      if (!(isTerminalSuccess ? terminalForThisCal : typeRelevant)) return;
      if (calType === "compass") {
        setter((prev) => ({ ...prev, message: text }));
        return;
      }
      const rebootTypes = ["accel", "compass", "level", "compassmot", "esc"];
      setter((prev) => {
        if (prev.status !== "in_progress") return prev;
        return {
          ...INITIAL_STATE,
          status: "success",
          currentStep: stepCount,
          progress: 100,
          message: text,
          needsReboot: rebootTypes.includes(calType),
        };
      });
      notify(calType, true);
      useDiagnosticsStore.getState().logCalibration(calType, "success");
      cleanupSubs(manager, calType);
      return;
    }

    if (isFailureMessage) {
      // "Calibration FAILED" is terminal and carries no keyword — accept it for the
      // running cal (unless it names a different sensor).
      if (!(typeRelevant || terminalForThisCal)) return;
      if (calType === "compass") {
        setter((prev) => ({ ...prev, message: `${text} — retrying automatically...` }));
        return;
      }
      setter((prev) => ({ ...prev, status: "error", message: text, waitingForConfirm: false }));
      notify(calType, false);
      useDiagnosticsStore.getState().logCalibration(calType, "failed");
      cleanupSubs(manager, calType);
      return;
    }

    if (!typeRelevant) return;

    if (calType === "accel" && lower.match(/place vehicle/)) {
      setter((prev) => ({ ...prev, message: text }));
      return;
    }

    const pctMatch = text.match(/(\d+)%/);
    if (pctMatch) {
      setter((prev) => ({ ...prev, progress: parseInt(pctMatch[1], 10), message: text }));
      return;
    }

    setter((prev) => ({ ...prev, message: text }));
    // Compass owns its timeout via the MAG_CAL stall detector; don't let an
    // informational STATUSTEXT reset it to the generic error timer.
    if (calType !== "compass") resetTimeout(manager, calType, setter);
  });
  addSub(manager, calType, statusUnsub);

  // Fast-completion fallback for simple calibrations
  const FAST_CAL_TYPES = ["gyro", "level", "baro", "airspeed"];
  if (FAST_CAL_TYPES.includes(calType)) {
    let sawRelevantMsg = false;
    const fastUnsub = protocol.onStatusText(({ text: t }) => {
      const l = t.toLowerCase();
      const kws = TYPE_KEYWORDS[calType] ?? [];
      if (kws.some((kw) => l.includes(kw)) || l.includes(calType)) {
        sawRelevantMsg = true;
      }
    });
    // Primary timer: 5s if we saw a relevant STATUSTEXT
    const fastTimer = setTimeout(() => {
      if (sawRelevantMsg) {
        fastUnsub();
        setter((prev) => {
          if (prev.status !== "in_progress") return prev;
          const rebootTypes = ["accel", "compass", "level", "compassmot", "esc"];
          cleanupSubs(manager, calType);
          return {
            ...INITIAL_STATE,
            status: "success",
            currentStep: stepCount,
            progress: 100,
            message: prev.message || `${calType} calibration complete`,
            needsReboot: rebootTypes.includes(calType),
          };
        });
        notify(calType, true);
        useDiagnosticsStore.getState().logCalibration(calType, "success");
      }
    }, 5000);
    // Secondary timer: 8s fallback when no STATUSTEXT arrives but COMMAND_ACK confirmed success
    const noMsgFallbackTimer = setTimeout(() => {
      fastUnsub();
      if (sawRelevantMsg) return; // already handled by primary timer
      setter((prev) => {
        if (prev.status !== "in_progress") return prev;
        if (!prev.commandAccepted) return prev; // no ACK confirmation, let timeout handle it
        const rebootTypes = ["accel", "compass", "level", "compassmot", "esc"];
        cleanupSubs(manager, calType);
        return {
          ...INITIAL_STATE,
          status: "success",
          currentStep: stepCount,
          progress: 100,
          message: `${calType} calibration complete (no status feedback from FC)`,
          needsReboot: rebootTypes.includes(calType),
        };
      });
      notify(calType, true);
      useDiagnosticsStore.getState().logCalibration(calType, "success");
    }, 8000);
    addSub(manager, calType, fastUnsub);
    addSub(manager, calType, () => clearTimeout(fastTimer));
    addSub(manager, calType, () => clearTimeout(noMsgFallbackTimer));
  }

  // Accel-specific: subscribe to position requests from FC
  if (calType === "accel" && protocol.onAccelCalPos) {
    const accelPosUnsub = protocol.onAccelCalPos(({ position }) => {
      const stepIndex = position - 1;
      setter((prev) => ({
        ...prev,
        currentStep: stepIndex,
        progress: ((stepIndex + 1) / stepCount) * 100,
        waitingForConfirm: true,
        accelCalPosition: position,
        message: `Place vehicle ${ACCEL_STEPS[stepIndex]?.label ?? `position ${position}`} — press any key or click Confirm`,
      }));
      resetTimeout(manager, calType, setter);
    });
    addSub(manager, calType, accelPosUnsub);
  }

  // Compass-specific: MAG_CAL_PROGRESS + MAG_CAL_REPORT (ArduPilot). PX4 compass
  // reports via the [cal] STATUSTEXT parser, so the MAG stall detector stays off there.
  if (calType === "compass") {
    subscribeCompassCalibration(manager, protocol, setter, calType, notify, isPx4);
  }
}
