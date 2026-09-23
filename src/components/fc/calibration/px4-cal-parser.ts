/**
 * PX4 calibration STATUSTEXT parser — subscribes to [cal] messages and
 * drives calibration state for PX4-specific progress, side detection, and
 * completion/failure events.
 */

import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import {
  type CalibrationState,
  INITIAL_STATE,
  ACCEL_STEPS,
} from "./calibration-types";
import { type SubsManager, resetTimeout } from "./cal-sub-helpers";
import type { DroneProtocol } from "@/lib/protocol/types";

/**
 * PX4 accel-calibration orientation names (commander detect_orientation_str:
 * back = tail down, front = nose down, up = upside down, down = right side up)
 * mapped to the ACCEL_STEPS wizard index.
 */
export const PX4_ORIENTATION_STEP: Record<string, number> = {
  down: 0, // Level
  left: 1, // Left Side
  right: 2, // Right Side
  front: 3, // Nose Down
  back: 4, // Nose Up
  up: 5, // Back (upside down)
};

export function subscribePx4CalStatus(
  protocol: DroneProtocol,
  px4CalActiveTypeRef: React.MutableRefObject<string | null>,
  px4CalCompletedSidesRef: React.MutableRefObject<Set<number>>,
  setters: {
    setAccel: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setCompass: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setGyro: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setLevel: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setPx4QuickLevel: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setPx4GnssMagCal: React.Dispatch<React.SetStateAction<CalibrationState>>;
    setPx4CalActiveType: React.Dispatch<React.SetStateAction<string | null>>;
  },
  toast: (msg: string, status?: "success" | "warning" | "error" | "info") => void,
  manager: SubsManager,
): () => void {
  const { setAccel, setCompass, setGyro, setLevel, setPx4QuickLevel, setPx4GnssMagCal, setPx4CalActiveType } = setters;

  // PX4 reports calibration via [cal] STATUSTEXT (not MAG_CAL_*), so the completion
  // signal is text-only. Re-arm a stall timer on each real [cal] progress event so a
  // slow-but-advancing PX4 cal never false-times-out, while one that genuinely stops
  // sending still ends instead of hanging. quick-level's generic timer is keyed "level".
  const PX4_STALL_MS = 60_000;
  const timeoutKey = (t: string | null) => (t === "quick-level" ? "level" : (t ?? ""));
  const activeSetter = (): React.Dispatch<React.SetStateAction<CalibrationState>> | undefined => {
    const map: Record<string, React.Dispatch<React.SetStateAction<CalibrationState>>> = {
      accel: setAccel, compass: setCompass, gyro: setGyro, level: setLevel,
      "quick-level": setPx4QuickLevel, "gnss-mag": setPx4GnssMagCal,
    };
    return map[px4CalActiveTypeRef.current ?? ""];
  };
  const bumpTimeout = () => {
    const s = activeSetter();
    if (s) resetTimeout(manager, timeoutKey(px4CalActiveTypeRef.current), s, PX4_STALL_MS,
      (prev) => ({ ...prev, status: "error", waitingForConfirm: false, message: "PX4 calibration stalled — no further progress from the flight controller. Restart the calibration." }));
  };
  const clearActiveTimeout = () => {
    const key = timeoutKey(px4CalActiveTypeRef.current);
    const t = manager.timeoutRef.current.get(key);
    if (t) { clearTimeout(t); manager.timeoutRef.current.delete(key); }
  };

  return protocol.onStatusText(({ text }) => {
    if (!text.startsWith("[cal]")) return;

    const progressMatch = text.match(/\[cal\] progress <(\d+)>/);
    if (progressMatch) {
      const pct = parseInt(progressMatch[1], 10);
      const calSetters: Record<string, React.Dispatch<React.SetStateAction<CalibrationState>>> = {
        accel: setAccel, compass: setCompass, gyro: setGyro, level: setLevel,
        "quick-level": setPx4QuickLevel,
      };
      const s = calSetters[px4CalActiveTypeRef.current ?? ""];
      if (s) { s((prev) => prev.status === "in_progress" ? { ...prev, progress: pct, message: `PX4 calibration: ${pct}%` } : prev); bumpTimeout(); }
      return;
    }

    const sideMatch = text.match(/\[cal\] (\w+) side done/);
    if (sideMatch) {
      const sideMap: Record<string, number> = { back: 1, front: 2, left: 3, right: 4, up: 5, down: 6 };
      const pos = sideMap[sideMatch[1].toLowerCase()];
      if (pos && px4CalActiveTypeRef.current === "accel") {
        const completedCount = new Set([...px4CalCompletedSidesRef.current, pos]).size;
        px4CalCompletedSidesRef.current = new Set([...px4CalCompletedSidesRef.current, pos]);
        setAccel((prev) => prev.status !== "in_progress" ? prev : {
          ...prev, currentStep: completedCount,
          progress: (completedCount / ACCEL_STEPS.length) * 100,
          message: `${sideMatch[1]} side done. Rotate to a different side.`,
          waitingForConfirm: false,
        });
        bumpTimeout();
      }
      return;
    }

    const orientMatch = text.match(/\[cal\] orientation detected: (\w+)/);
    if (orientMatch && px4CalActiveTypeRef.current === "accel") {
      const stepIdx = PX4_ORIENTATION_STEP[orientMatch[1].toLowerCase()];
      if (stepIdx !== undefined) { setAccel((prev) => prev.status === "in_progress" ? { ...prev, currentStep: stepIdx, message: `Detected: ${orientMatch[1]}. Hold still...` } : prev); bumpTimeout(); }
      return;
    }

    if (text.includes("calibration done")) {
      const calSetters: Record<string, React.Dispatch<React.SetStateAction<CalibrationState>>> = {
        accel: setAccel, compass: setCompass, gyro: setGyro, level: setLevel,
        "quick-level": setPx4QuickLevel, "gnss-mag": setPx4GnssMagCal,
      };
      const s = calSetters[px4CalActiveTypeRef.current ?? ""];
      if (s) s((prev) => prev.status !== "in_progress" ? prev : { ...INITIAL_STATE, status: "success", progress: 100, message: text, needsReboot: ["accel", "compass", "level"].includes(px4CalActiveTypeRef.current ?? "") });
      const label = px4CalActiveTypeRef.current ?? "PX4";
      toast(`${label.charAt(0).toUpperCase() + label.slice(1)} calibration complete`, "success");
      useDiagnosticsStore.getState().logCalibration(px4CalActiveTypeRef.current ?? "px4", "success");
      clearActiveTimeout();
      setPx4CalActiveType(null);
      return;
    }

    if (text.includes("calibration failed")) {
      const calSetters: Record<string, React.Dispatch<React.SetStateAction<CalibrationState>>> = {
        accel: setAccel, compass: setCompass, gyro: setGyro, level: setLevel,
        "quick-level": setPx4QuickLevel, "gnss-mag": setPx4GnssMagCal,
      };
      const s = calSetters[px4CalActiveTypeRef.current ?? ""];
      if (s) s((prev) => ({ ...prev, status: "error", message: text, waitingForConfirm: false }));
      const label = px4CalActiveTypeRef.current ?? "PX4";
      toast(`${label.charAt(0).toUpperCase() + label.slice(1)} calibration failed`, "error");
      useDiagnosticsStore.getState().logCalibration(px4CalActiveTypeRef.current ?? "px4", "failed");
      clearActiveTimeout();
      setPx4CalActiveType(null);
      return;
    }
  });
}
