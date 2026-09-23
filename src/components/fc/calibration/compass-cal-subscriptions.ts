/**
 * Compass calibration subscription logic — MAG_CAL_PROGRESS, MAG_CAL_REPORT,
 * and ATTITUDE subscriptions for compass calibration progress tracking.
 */

import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import {
  type CalibrationState,
  MAG_CAL_FAIL_MESSAGES,
} from "./calibration-types";
import type { DroneProtocol } from "@/lib/protocol/types";
import { type SubsManager, addSub, cleanupSubs, resetTimeout } from "./cal-sub-helpers";

export function subscribeCompassCalibration(
  manager: SubsManager,
  protocol: DroneProtocol,
  setter: React.Dispatch<React.SetStateAction<CalibrationState>>,
  calType: string,
  toast: (msg: string, status?: "success" | "warning" | "error" | "info") => void,
  isPx4 = false,
) {
  // Stall detection (ArduPilot MAG_CAL path only). ArduPilot streams MAG_CAL_PROGRESS
  // per compass and ends each with a MAG_CAL_REPORT. A compass that never finishes
  // collecting (marginal external mag, operator stops rotating) keeps streaming a flat
  // progress and never reports — which previously reset the safety timeout on every
  // frame, so the wizard ran forever. Instead: re-arm the timer only on *forward*
  // progress, and when it fires, finalize gracefully from whatever the FC returned.
  // PX4 compass reports through the [cal] STATUSTEXT parser and never emits MAG_CAL_*,
  // so this detector is disabled there (it would wrongly error a healthy PX4 cal).
  const STALL_MS = 30_000;
  const lastPct = new Map<number, number>();

  const finalizeStalled = (prev: CalibrationState): CalibrationState => {
    const results = Array.from(prev.compassResults.values());
    const failResult = results.find((r) => r.calStatus >= 5);
    if (results.some((r) => r.calStatus === 4)) {
      // At least one compass produced good offsets — let the operator accept/save them.
      useDiagnosticsStore.getState().logCalibration(calType, "success");
      return {
        ...prev,
        status: "waiting_accept",
        waitingForConfirm: true,
        progress: 100,
        message: "Calibration stopped advancing — review the offsets below and click Accept to save, or Retry.",
      };
    }
    if (failResult) {
      const failInfo = MAG_CAL_FAIL_MESSAGES[failResult.calStatus];
      useDiagnosticsStore.getState().logCalibration(calType, "failed");
      return {
        ...prev,
        status: "cal_warning",
        waitingForConfirm: true,
        message: (failInfo?.message ?? `Compass calibration reported errors (status ${failResult.calStatus})`) + " — no compass produced a usable fit. Retry the calibration.",
        failureFixes: failInfo?.fixes ?? [],
      };
    }
    useDiagnosticsStore.getState().logCalibration(calType, "failed");
    return {
      ...prev,
      status: "error",
      message: "Compass calibration stalled — no result from the flight controller. Rotate slowly through all orientations (roll, pitch, yaw) and retry.",
    };
  };

  const armStall = () => {
    if (isPx4) return;
    resetTimeout(manager, calType, setter, STALL_MS, finalizeStalled);
  };
  // Cover "no progress ever" (e.g. DO_START_MAG_CAL silently ignored).
  armStall();

  if (protocol.onMagCalProgress) {
    const magProgressUnsub = protocol.onMagCalProgress(({ compassId, completionPct, calStatus, completionMask }) => {
      const advanced = completionPct > (lastPct.get(compassId) ?? -1);
      if (advanced) lastPct.set(compassId, completionPct);
      setter((prev) => {
        const cp = new Map(prev.compassProgress);
        const cs = new Map(prev.compassStatus);
        const cm = new Map(prev.compassCompletionMask);
        cp.set(compassId, completionPct);
        cs.set(compassId, calStatus);
        cm.set(compassId, completionMask);
        const values = Array.from(cp.values());
        const avgProgress = values.reduce((a, b) => a + b, 0) / values.length;
        const sectorCount = completionMask.reduce((sum, byte) => {
          let bits = byte;
          let count = 0;
          while (bits) { count += bits & 1; bits >>= 1; }
          return sum + count;
        }, 0);
        const statusText = calStatus <= 2 ? "Collecting samples" : "Refining fit";
        return {
          ...prev,
          compassProgress: cp,
          compassStatus: cs,
          compassCompletionMask: cm,
          progress: avgProgress,
          message: `Compass ${compassId}: ${statusText} — ${Math.round(completionPct)}% (${sectorCount}/80 sectors)`,
        };
      });
      // Only real forward progress defers the stall timer; a stuck compass repeating a
      // flat pct no longer keeps the calibration alive forever.
      if (advanced) armStall();
    });
    addSub(manager, calType, magProgressUnsub);
  }

  if (protocol.onAttitude) {
    const attUnsub = protocol.onAttitude(({ rollSpeed, pitchSpeed, yawSpeed }) => {
      setter((prev) => {
        if (prev.status !== "in_progress") return prev;
        const cd = new Map(prev.compassDirection);
        for (const id of prev.compassProgress.keys()) {
          cd.set(id, { x: rollSpeed, y: pitchSpeed, z: yawSpeed });
        }
        return { ...prev, compassDirection: cd };
      });
    });
    addSub(manager, calType, attUnsub);
  }

  if (protocol.onMagCalReport) {
    const magReportUnsub = protocol.onMagCalReport(({
      compassId, calStatus, autosaved, ofsX, ofsY, ofsZ, fitness,
      diagX, diagY, diagZ, offdiagX, offdiagY, offdiagZ,
      orientationConfidence, oldOrientation, newOrientation, scaleFactor,
    }) => {
      setter((prev) => {
        const cr = new Map(prev.compassResults);
        cr.set(compassId, {
          ofsX, ofsY, ofsZ, fitness, calStatus,
          diagX, diagY, diagZ, offdiagX, offdiagY, offdiagZ,
          orientationConfidence, oldOrientation, newOrientation, scaleFactor,
        });
        const cs = new Map(prev.compassStatus);
        cs.set(compassId, calStatus);

        if (autosaved === 1 && calStatus === 4) {
          const allDone = Array.from(prev.compassProgress.keys()).every((id) => cr.has(id));
          if (allDone || prev.compassProgress.size === 0) {
            cleanupSubs(manager, calType);
            useDiagnosticsStore.getState().logCalibration(calType, "success", {
              offsets: { ofsX, ofsY, ofsZ },
              fitness,
              compassId,
            });
            return {
              ...prev,
              compassResults: cr,
              compassStatus: cs,
              status: "success",
              progress: 100,
              needsReboot: true,
              message: "All compasses calibrated successfully. Reboot required for new offsets to take effect.",
            };
          }
        }

        if (calStatus >= 5) {
          const passedIds = Array.from(cr.entries()).filter(([, r]) => r.calStatus === 4).map(([id]) => id);
          const failedIds = Array.from(cr.entries()).filter(([, r]) => r.calStatus >= 5).map(([id]) => id);
          const failInfo = MAG_CAL_FAIL_MESSAGES[calStatus];
          let msg: string;
          let fixes: string[] = [];
          if (passedIds.length > 0 && failedIds.length > 0) {
            msg = `Compass ${passedIds.join(", ")} succeeded, Compass ${failedIds.join(", ")} failed. You can force-save the good offsets or retry all.`;
          } else {
            msg = failInfo?.message ?? `Compass ${compassId} calibration warning (status ${calStatus})`;
            fixes = failInfo?.fixes ?? [];
          }
          cleanupSubs(manager, calType);
          useDiagnosticsStore.getState().logCalibration(calType, "failed", {
            offsets: { ofsX, ofsY, ofsZ },
            fitness,
            compassId,
          });
          return {
            ...prev,
            compassResults: cr,
            compassStatus: cs,
            status: "cal_warning",
            waitingForConfirm: true,
            message: msg + " — review offsets below and Force Save if acceptable, or Retry.",
            failureFixes: fixes,
          };
        }

        if (calStatus === 4 && autosaved === 0) {
          const allDone = Array.from(prev.compassProgress.keys()).every((id) => cr.has(id));
          if (allDone || prev.compassProgress.size === 0) {
            return {
              ...prev,
              compassResults: cr,
              compassStatus: cs,
              status: "waiting_accept",
              waitingForConfirm: true,
              progress: 100,
              message: "Calibration complete — review offsets and click Accept to save",
            };
          }
        }
        return {
          ...prev,
          compassResults: cr,
          compassStatus: cs,
        };
      });
    });
    addSub(manager, calType, magReportUnsub);
  }
}
