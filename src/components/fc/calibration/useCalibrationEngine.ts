"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  type CalibrationState,
  type CalibrationLogEntry,
  type CompassParams,
  INITIAL_STATE,
  ACCEL_STEPS,
  COMPASS_PARAM_NAMES,
  LOG_KEYWORDS,
  MAX_LOG_ENTRIES,
} from "./calibration-types";
import {
  addSub, cleanupSubs,
  subscribeToCalibrationStatus,
} from "./calibration-subscriptions";
import { subscribePx4CalStatus } from "./px4-cal-parser";
import { compassSaveEntries } from "./compass-save-entries";
import { describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";

// ── Calibration snapshot params (before/after comparison) ──
const CAL_SNAPSHOT_PARAMS: Record<string, string[]> = {
  accel: ["INS_ACCOFFS_X", "INS_ACCOFFS_Y", "INS_ACCOFFS_Z", "INS_ACCSCAL_X", "INS_ACCSCAL_Y", "INS_ACCSCAL_Z"],
  gyro: ["INS_GYROFFS_X", "INS_GYROFFS_Y", "INS_GYROFFS_Z"],
  compass: ["COMPASS_OFS_X", "COMPASS_OFS_Y", "COMPASS_OFS_Z", "COMPASS_DIA_X", "COMPASS_DIA_Y", "COMPASS_DIA_Z"],
  level: ["AHRS_TRIM_X", "AHRS_TRIM_Y", "AHRS_TRIM_Z"],
  baro: ["GND_ABS_PRESS", "GND_TEMP"],
  airspeed: ["ARSPD_OFFSET"],
};

export function useCalibrationEngine() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";

  const [accel, setAccel] = useState<CalibrationState>(INITIAL_STATE);
  const [gyro, setGyro] = useState<CalibrationState>(INITIAL_STATE);
  const [compass, setCompass] = useState<CalibrationState>(INITIAL_STATE);
  const [level, setLevel] = useState<CalibrationState>(INITIAL_STATE);
  const [airspeed, setAirspeed] = useState<CalibrationState>(INITIAL_STATE);
  const [baro, setBaro] = useState<CalibrationState>(INITIAL_STATE);
  const [esc, setEsc] = useState<CalibrationState>(INITIAL_STATE);
  const [compassmot, setCompassmot] = useState<CalibrationState>(INITIAL_STATE);
  const [logEntries, setLogEntries] = useState<CalibrationLogEntry[]>([]);

  // PX4 calibration state
  const [px4CalActiveType, setPx4CalActiveType] = useState<string | null>(null);
  const px4CalActiveTypeRef = useRef<string | null>(null);
  const px4CalCompletedSidesRef = useRef<Set<number>>(new Set());
  useEffect(() => { px4CalActiveTypeRef.current = px4CalActiveType; }, [px4CalActiveType]);

  const [px4QuickLevel, setPx4QuickLevel] = useState<CalibrationState>(INITIAL_STATE);
  const [px4GnssMagCal, setPx4GnssMagCal] = useState<CalibrationState>(INITIAL_STATE);

  const [baroPressure, setBaroPressure] = useState<{ pressAbs: number; temperature: number } | null>(null);
  const [calSnapshot, setCalSnapshot] = useState<Map<string, number> | null>(null);
  const [calDiff, setCalDiff] = useState<Array<{ name: string; before: number; after: number }> | null>(null);
  const [calDiffType, setCalDiffType] = useState<string | null>(null);

  const [compassParams, setCompassParams] = useState<CompassParams>({
    COMPASS_USE: undefined, COMPASS_ORIENT: undefined, COMPASS_AUTO_ROT: undefined,
    COMPASS_OFFS_MAX: undefined, COMPASS_LEARN: undefined, COMPASS_EXTERNAL: undefined,
  });

  const subsRef = useRef<Map<string, (() => void)[]>>(new Map());
  const timeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const manager = { subsRef, timeoutRef };

  // Global log subscription
  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    const unsub = protocol.onStatusText(({ severity, text }) => {
      const lower = text.toLowerCase();
      if (LOG_KEYWORDS.some((kw) => lower.includes(kw))) {
        setLogEntries((prev) => {
          const next = [...prev, { timestamp: Date.now(), text, severity }];
          return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
        });
      }
    });
    return unsub;
  }, [selectedProtocol]);

  // PX4 calibration STATUSTEXT parser
  useEffect(() => {
    if (!isPx4) return;
    const protocol = selectedProtocol;
    if (!protocol) return;
    return subscribePx4CalStatus(protocol, px4CalActiveTypeRef, px4CalCompletedSidesRef, {
      setAccel, setCompass, setGyro, setLevel, setPx4QuickLevel, setPx4GnssMagCal, setPx4CalActiveType,
    }, toast, manager);
  // manager wraps stable refs (subsRef/timeoutRef); excluded so the parser isn't re-subscribed every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPx4, selectedProtocol, toast]);

  // Fetch compass params. A failed read is `null` ("unavailable"), not a
  // permanent "loading".
  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    Promise.allSettled(COMPASS_PARAM_NAMES.map((n) => protocol.getParameter(n))).then((results) => {
      const vals: CompassParams = { COMPASS_USE: null, COMPASS_ORIENT: null, COMPASS_AUTO_ROT: null, COMPASS_OFFS_MAX: null, COMPASS_LEARN: null, COMPASS_EXTERNAL: null };
      COMPASS_PARAM_NAMES.forEach((n, i) => { const r = results[i]; vals[n] = r.status === "fulfilled" ? r.value.value : null; });
      setCompassParams(vals);
    });
  }, [selectedProtocol]);

  // Subscribe to SCALED_PRESSURE
  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol?.onScaledPressure) return;
    const unsub = protocol.onScaledPressure(({ pressAbs, temperature }) => { setBaroPressure({ pressAbs, temperature }); });
    return unsub;
  }, [selectedProtocol]);

  // Cleanup on unmount
  useEffect(() => { return () => { for (const type of subsRef.current.keys()) cleanupSubs(manager, type); }; }, []);

  // Before/after diff
  const fetchCalDiff = useCallback(async (type: string, snapshot: Map<string, number>) => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    const paramNames = CAL_SNAPSHOT_PARAMS[type];
    if (!paramNames || paramNames.length === 0) return;
    const results = await Promise.allSettled(paramNames.map((n) => protocol.getParameter(n)));
    const diffs: Array<{ name: string; before: number; after: number }> = [];
    paramNames.forEach((name, i) => { const r = results[i]; if (r.status !== "fulfilled") return; const after = r.value.value; const before = snapshot.get(name); if (before !== undefined && before !== after) diffs.push({ name, before, after }); });
    if (diffs.length > 0) { setCalDiff(diffs); setCalDiffType(type); }
  }, [selectedProtocol]);

  const calStates = useMemo(() => [
    { type: "accel", state: accel }, { type: "gyro", state: gyro },
    { type: "compass", state: compass }, { type: "level", state: level },
    { type: "airspeed", state: airspeed }, { type: "baro", state: baro },
  ], [accel, gyro, compass, level, airspeed, baro]);

  const lastSuccessRef = useRef<string | null>(null);
  useEffect(() => {
    const succeeded = calStates.find((c) => c.state.status === "success");
    if (succeeded && succeeded.type !== lastSuccessRef.current && calSnapshot) {
      lastSuccessRef.current = succeeded.type;
      const timer = setTimeout(() => fetchCalDiff(succeeded.type, calSnapshot), 1500);
      return () => clearTimeout(timer);
    }
    if (!succeeded) lastSuccessRef.current = null;
  }, [calStates, calSnapshot, fetchCalDiff]);

  // Keyboard handler for accel cal confirm
  useEffect(() => {
    if (!accel.waitingForConfirm) return;
    const handler = (e: KeyboardEvent) => { if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; e.preventDefault(); confirmAccelPosition(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accel.waitingForConfirm, accel.accelCalPosition]);

  const confirmAccelPosition = useCallback(() => {
    const protocol = selectedProtocol;
    if (!protocol?.confirmAccelCalPos || accel.accelCalPosition === null) return;
    protocol.confirmAccelCalPos(accel.accelCalPosition);
    setAccel((prev) => ({ ...prev, waitingForConfirm: false }));
  }, [selectedProtocol, accel.accelCalPosition]);

  const cancelCalibration = useCallback(async (type: string, setter: React.Dispatch<React.SetStateAction<CalibrationState>>) => {
    const protocol = selectedProtocol;
    if (protocol) { if (type === "compass" && protocol.cancelCompassCal) protocol.cancelCompassCal(); else if (protocol.cancelCalibration) protocol.cancelCalibration(); }
    cleanupSubs(manager, type);
    useDiagnosticsStore.getState().logCalibration(type, "cancelled");
    setPx4CalActiveType(null);
    setter(INITIAL_STATE);
  }, [selectedProtocol]);

  const forceCompassSave = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    // Only fits the FC reported as successful are written; a rejected fit
    // (bad radius, bad orientation) never lands in COMPASS_OFS*.
    const { entries, saved, skipped } = compassSaveEntries(compass.compassResults, calSnapshot);
    if (entries.length === 0) {
      toast("No compass produced a successful fit; nothing was saved. Retry the calibration.", "error");
      return;
    }
    try {
      const outcome = await writeParamBatch(protocol, entries, "calibration");
      const { message } = describeParamBatch(outcome);
      const skippedNote = skipped.length > 0 ? ` Compass ${skipped.map((id) => id + 1).join(", ")} not saved (fit failed).` : "";
      if (outcome.failures.length > 0 || outcome.flash === "failed") {
        const detail = outcome.failures.length > 0 ? ` Failed: ${outcome.failures.join(", ")}` : "";
        setCompass((prev) => ({ ...prev, status: "error", waitingForConfirm: false, message: `${message}.${detail}${skippedNote}` }));
        toast(`${message}${detail}`, "error");
        return;
      }
      const flashNote = outcome.flash === "unacknowledged" ? "Flash commit sent (unacknowledged)." : "Saved to flash.";
      const savedNote = `Compass ${saved.map((id) => id + 1).join(", ")} offsets written. ${flashNote} Reboot to apply.${skippedNote}`;
      setCompass((prev) => ({ ...prev, status: "success", waitingForConfirm: false, needsReboot: true, message: savedNote }));
      toast(message, skipped.length > 0 || outcome.flash === "unacknowledged" ? "info" : "success");
    } catch { toast("Failed to write compass offsets", "error"); }
  }, [selectedProtocol, compass.compassResults, calSnapshot, toast]);

  const acceptCompass = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.acceptCompassCal) return;
    try {
      const result = await protocol.acceptCompassCal();
      if (!result.success) { toast("FC rejected accept — saving successful fits directly", "info"); await forceCompassSave(); return; }
      // The FC stores accepted offsets itself; the flash commit is the
      // belt-and-braces step, and its outcome is reported, not assumed.
      const flashResult = await protocol.commitParamsToFlash();
      const flashNote = !flashResult.success
        ? "Flash commit failed; offsets may be RAM-only."
        : flashResult.acknowledged === false ? "Flash commit sent (unacknowledged)." : "Saved to flash.";
      setCompass((prev) => ({ ...prev, status: "success", waitingForConfirm: false, progress: 100, needsReboot: true, message: `Compass calibration accepted. ${flashNote} Reboot to apply.` }));
      cleanupSubs(manager, "compass");
      toast(`Compass calibration accepted. ${flashNote}`, flashResult.success ? "success" : "warning");
    } catch { toast("Accept failed — try Force Save", "error"); }
  }, [selectedProtocol, forceCompassSave, toast]);

  const startCalibration = useCallback(async (
    type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot",
    setter: React.Dispatch<React.SetStateAction<CalibrationState>>,
    stepCount: number,
  ) => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    setCalDiff(null); setCalDiffType(null);
    const paramNames = CAL_SNAPSHOT_PARAMS[type];
    if (paramNames && paramNames.length > 0) {
      const results = await Promise.allSettled(paramNames.map((n) => protocol.getParameter(n)));
      const snap = new Map<string, number>();
      paramNames.forEach((name, i) => { const r = results[i]; if (r.status === "fulfilled") snap.set(name, r.value.value); });
      setCalSnapshot(snap);
    } else { setCalSnapshot(null); }
    if (!isPx4 && type === "compass" && typeof compassParams.COMPASS_AUTO_ROT === "number" && compassParams.COMPASS_AUTO_ROT !== 3) {
      const autoRot = await protocol.setParameter("COMPASS_AUTO_ROT", 3).catch(() => null);
      if (autoRot?.success) {
        setCompassParams((p) => ({ ...p, COMPASS_AUTO_ROT: 3 }));
        toast("COMPASS_AUTO_ROT set to 3 (lenient) to prevent orientation flickering", "info");
      } else {
        toast(`COMPASS_AUTO_ROT was not changed: ${autoRot?.message ?? "no reply"}. Calibrating with the current setting.`, "warning");
      }
    }
    if (isPx4) { setPx4CalActiveType(type); px4CalCompletedSidesRef.current = new Set(); }
    setter({ ...INITIAL_STATE, status: "in_progress", message: "Starting calibration..." });
    subscribeToCalibrationStatus(manager, protocol, setter, stepCount, type, toast, isPx4);
    try {
      const result = await protocol.startCalibration(type);
      if (!result.success) {
        cleanupSubs(manager, type); if (isPx4) setPx4CalActiveType(null);
        const msg = result.resultCode === 5 ? "Calibration already in progress — cancel first or wait for it to finish" : result.resultCode === 1 ? "FC temporarily busy — wait a moment and retry" : result.message || "Calibration command rejected";
        setter((prev) => ({ ...prev, status: "error", message: msg }));
        toast(`${type.charAt(0).toUpperCase() + type.slice(1)} calibration: ${msg}`, "error");
      } else {
        setter((prev) => ({ ...prev, commandAccepted: true }));
        toast(`${type.charAt(0).toUpperCase() + type.slice(1)} calibration started`, "info");
      }
    } catch {
      cleanupSubs(manager, type); if (isPx4) setPx4CalActiveType(null);
      setter((prev) => ({ ...prev, status: "error", message: "Failed to send calibration command" }));
      toast("Failed to send calibration command", "error");
    }
  }, [selectedProtocol, toast, compassParams.COMPASS_AUTO_ROT, setCompassParams, isPx4]);

  const startPx4QuickLevel = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    setPx4CalActiveType("quick-level");
    setPx4QuickLevel({ ...INITIAL_STATE, status: "in_progress", message: "Starting quick level calibration..." });
    subscribeToCalibrationStatus(manager, protocol, setPx4QuickLevel, 1, "level", toast, true);
    try {
      const result = await protocol.startCalibration("level");
      if (!result.success) { cleanupSubs(manager, "level"); setPx4CalActiveType(null); setPx4QuickLevel((prev) => ({ ...prev, status: "error", message: result.message || "Quick level command rejected" })); toast("Quick level calibration failed", "error"); }
      else toast("Quick level calibration started", "info");
    } catch { cleanupSubs(manager, "level"); setPx4CalActiveType(null); setPx4QuickLevel((prev) => ({ ...prev, status: "error", message: "Failed to send quick level command" })); toast("Failed to send quick level command", "error"); }
  }, [selectedProtocol, toast]);

  const startPx4GnssMagCal = useCallback(async (yawDeg: number) => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    setPx4CalActiveType("gnss-mag");
    setPx4GnssMagCal({ ...INITIAL_STATE, status: "in_progress", message: `Calibrating compass for a vehicle yaw of ${yawDeg}°...` });
    try {
      const result = protocol.startGnssMagCal ? await protocol.startGnssMagCal(yawDeg) : { success: false, resultCode: -1, message: "Known-heading compass calibration is not supported by this firmware" };
      if (!result.success) { setPx4CalActiveType(null); setPx4GnssMagCal((prev) => ({ ...prev, status: "error", message: result.message || "Known-heading compass calibration was rejected. Ensure the vehicle has a position fix." })); toast("Compass calibration failed", "error"); }
      else { setPx4GnssMagCal(() => ({ ...INITIAL_STATE, status: "success", progress: 100, message: `Compass calibrated against the magnetic model for a vehicle yaw of ${yawDeg}°.`, needsReboot: true })); setPx4CalActiveType(null); toast("Compass calibration complete", "success"); useDiagnosticsStore.getState().logCalibration("gnss-mag", "success"); }
    } catch { setPx4CalActiveType(null); setPx4GnssMagCal((prev) => ({ ...prev, status: "error", message: "Failed to send the compass calibration command" })); toast("Failed to send the compass calibration command", "error"); }
  }, [selectedProtocol, toast]);

  return {
    accel, setAccel, gyro, setGyro, compass, setCompass,
    level, setLevel, airspeed, setAirspeed, baro, setBaro,
    esc, setEsc, compassmot, setCompassmot,
    logEntries, setLogEntries, baroPressure,
    compassParams, setCompassParams,
    calDiff, setCalDiff, calDiffType, setCalDiffType,
    px4QuickLevel, setPx4QuickLevel, px4GnssMagCal, isPx4,
    startCalibration, cancelCalibration,
    confirmAccelPosition, acceptCompass, forceCompassSave,
    startPx4QuickLevel, startPx4GnssMagCal,
  };
}
