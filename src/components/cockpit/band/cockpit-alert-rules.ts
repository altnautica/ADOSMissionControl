/**
 * The cockpit alert rules: which conditions raise a critical, warning or
 * advisory alert, from the raw samples the stores hold. Pure, so the rules are
 * testable without rendering and the component only owns subscriptions.
 *
 * Every telemetry-derived claim is drawn from a fresh sample only. A ring
 * buffer keeps its last sample forever, and a "FENCE BREACH" or "BATT CRIT"
 * kept on screen after the link died describes a vehicle state nobody has
 * heard about since; once the link goes quiet the link alert is the truth.
 *
 * @license GPL-3.0-only
 */

import type { BatteryBand } from "@/lib/battery-bands";
import { isFresh } from "@/lib/telemetry/freshness";
import type {
  EkfData,
  FenceStatusData,
  GpsData,
  SysStatusData,
  VibrationData,
} from "@/lib/types/telemetry";
import { linkStateFromHeartbeat } from "./link-state";

export type CockpitAlertLevel = "critical" | "warning" | "advisory";

export type CockpitAlertId =
  | "linkLost"
  | "battCrit"
  | "fcState"
  | "ekfFailsafe"
  | "fenceBreach"
  | "statusText"
  | "linkStale"
  | "battLow"
  | "gpsNo3d"
  | "videoFrozen"
  | "rcFailsafe"
  | "prearm"
  | "highVibration";

export interface CockpitAlert {
  id: CockpitAlertId;
  level: CockpitAlertLevel;
  /** FC-supplied text (STATUSTEXT, pre-arm reason, FC state name key). */
  detail?: string;
}

/** A STATUSTEXT line as received, stamped with the receive time. */
export interface ReceivedText {
  text: string;
  at: number;
}

export interface CockpitAlertInputs {
  armState: "armed" | "disarmed" | "unknown";
  /** Non-null from the arm transition until disarm; survives a lost link. */
  armedAt: number | null;
  lastHeartbeat: number;
  /** MAV_STATE from the last heartbeat. */
  systemStatus: number;
  /** Battery band under the operator's thresholds; undefined = unknown. */
  batteryBand: BatteryBand | undefined;
  fence: FenceStatusData | undefined;
  ekf: EkfData | undefined;
  sysStatus: SysStatusData | undefined;
  gps: GpsData | undefined;
  vibration: VibrationData | undefined;
  videoFrozen: boolean;
  criticalText: ReceivedText | null;
  prearmText: ReceivedText | null;
}

/** A critical STATUSTEXT stays on the stack this long after it arrives. */
export const STATUS_TEXT_HOLD_MS = 10_000;
/** ArduPilot repeats pre-arm failures every 30 s; hold one past the next. */
export const PREARM_HOLD_MS = 35_000;
/** Default FS_EKF_THRESH: an EKF failsafe needs two variances at or above it. */
const EKF_FAILSAFE_VARIANCE = 0.8;
/** Vibration (m/s/s) above which the autopilot's own tooling calls it high. */
const HIGH_VIBRATION = 30;
const SENSOR_RC_RECEIVER = 1 << 16;

/** MAV_STATE values that mean the autopilot itself declared a failsafe. */
const FC_STATE_DETAIL: Record<number, string> = {
  5: "fcCritical",
  6: "fcEmergency",
  8: "fcTermination",
};

const LEVEL_ORDER: Record<CockpitAlertLevel, number> = { critical: 0, warning: 1, advisory: 2 };

export function deriveCockpitAlerts(
  i: CockpitAlertInputs,
  now: number = Date.now(),
): CockpitAlert[] {
  const alerts: CockpitAlert[] = [];
  const armed = i.armState === "armed" || i.armedAt !== null;
  const link = linkStateFromHeartbeat(i.lastHeartbeat, now);
  const fresh = <T extends { timestamp: number }>(s: T | undefined): T | undefined =>
    s !== undefined && isFresh(s.timestamp, now) ? s : undefined;

  if (link === "lost" && armed) alerts.push({ id: "linkLost", level: "critical" });
  else if (link === "stale" || link === "lost") alerts.push({ id: "linkStale", level: "warning" });

  if (i.batteryBand === "critical") alerts.push({ id: "battCrit", level: "critical" });
  else if (i.batteryBand === "warning") alerts.push({ id: "battLow", level: "warning" });

  // The heartbeat's MAV_STATE only speaks for the aircraft while it is heard.
  const stateDetail = FC_STATE_DETAIL[i.systemStatus];
  if (stateDetail && (link === "ok" || link === "stale")) {
    alerts.push({ id: "fcState", level: "critical", detail: stateDetail });
  }

  const ekf = fresh(i.ekf);
  if (ekf && armed) {
    const high = [ekf.velocityVariance, ekf.posHorizVariance, ekf.compassVariance].filter(
      (v) => v >= EKF_FAILSAFE_VARIANCE,
    ).length;
    if (high >= 2) alerts.push({ id: "ekfFailsafe", level: "critical" });
  }

  const fence = fresh(i.fence);
  if (fence && fence.breachStatus > 0) alerts.push({ id: "fenceBreach", level: "critical" });

  if (i.criticalText && now - i.criticalText.at < STATUS_TEXT_HOLD_MS) {
    alerts.push({ id: "statusText", level: "critical", detail: i.criticalText.text });
  }

  const gps = fresh(i.gps);
  if (gps && armed && gps.fixType < 3) alerts.push({ id: "gpsNo3d", level: "warning" });

  if (i.videoFrozen) alerts.push({ id: "videoFrozen", level: "warning" });

  const sys = fresh(i.sysStatus);
  if (
    sys &&
    armed &&
    (sys.sensorsPresent & SENSOR_RC_RECEIVER) !== 0 &&
    (sys.sensorsHealthy & SENSOR_RC_RECEIVER) === 0
  ) {
    alerts.push({ id: "rcFailsafe", level: "warning" });
  }

  if (i.armState === "disarmed" && i.prearmText && now - i.prearmText.at < PREARM_HOLD_MS) {
    alerts.push({ id: "prearm", level: "advisory", detail: i.prearmText.text });
  }

  const vib = fresh(i.vibration);
  if (vib && Math.max(vib.vibrationX, vib.vibrationY, vib.vibrationZ) > HIGH_VIBRATION) {
    alerts.push({ id: "highVibration", level: "advisory" });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
