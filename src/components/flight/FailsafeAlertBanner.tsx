"use client";

import { useState } from "react";
import { AlertTriangle, X, ShieldAlert, Radio, Navigation, Cpu, Zap } from "lucide-react";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useClockTick } from "@/lib/agent/freshness";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { knownRemainingPct } from "@/lib/battery-bands";

type FailsafeType = "LOW_BATTERY" | "GPS_LOST" | "RC_LOST" | "EKF_FAIL" | "MOTOR_FAIL" | "PREARM_FAIL" | "EMERGENCY";

interface FailsafeCondition {
  type: FailsafeType;
  label: string;
  icon: React.ReactNode;
  /** 1 = warning, 2 = critical, 3 = the FC has declared an emergency. */
  severity: 1 | 2 | 3;
}

/** A dismissal: which drone, the severity seen per condition type, and when. */
interface Dismissal {
  droneId: string | null;
  severity: Partial<Record<FailsafeType, number>>;
  at: number;
}

/** A dismissed warning stays hidden this long while nothing new appears. */
const DISMISS_MS = 30_000;
/** A critical or emergency condition can only be snoozed this long. */
const CRITICAL_SNOOZE_MS = 10_000;

/**
 * Whether a dismissal still hides the current conditions. It never hides a
 * different drone's alerts, a condition type that was not on screen when it was
 * dismissed, or a condition that has since escalated in severity.
 */
function isSuppressed(
  dismissal: Dismissal | null,
  droneId: string | null,
  conditions: FailsafeCondition[],
  now: number,
): boolean {
  if (!dismissal || dismissal.droneId !== droneId) return false;
  for (const c of conditions) {
    if ((dismissal.severity[c.type] ?? 0) < c.severity) return false;
  }
  const window = conditions.some((c) => c.severity >= 2) ? CRITICAL_SNOOZE_MS : DISMISS_MS;
  return now - dismissal.at < window;
}

const FAILSAFE_ICONS: Record<FailsafeType, React.ReactNode> = {
  LOW_BATTERY: <Zap size={12} />,
  GPS_LOST: <Navigation size={12} />,
  RC_LOST: <Radio size={12} />,
  EKF_FAIL: <Cpu size={12} />,
  MOTOR_FAIL: <ShieldAlert size={12} />,
  PREARM_FAIL: <ShieldAlert size={12} />,
  EMERGENCY: <AlertTriangle size={12} />,
};

export function FailsafeAlertBanner() {
  const sysStatus = useTelemetryLatest("sysStatus");
  const battery = useTelemetryLatest("battery");
  const systemStatus = useDroneStore((s) => s.systemStatus);
  const connectionState = useDroneStore((s) => s.connectionState);
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const [dismissal, setDismissal] = useState<Dismissal | null>(null);
  // Re-render once a second so a snooze expires on time.
  useClockTick();

  // Don't show if not connected
  if (connectionState === "disconnected") return null;

  const conditions: FailsafeCondition[] = [];

  // bench mode gating: a drone sitting on a bench with no real
  // battery, no GPS lock, and no flight reports a flood of false-positive
  // failsafe conditions. The fix is NOT to lower the thresholds — they're
  // correct for in-flight use — but to require that the alarm condition is
  // GROUNDED in real telemetry before it shows.
  //
  // - LOW_BATTERY: only fires when the FC reports a plausible voltage
  //   (>= 1.0V). A disconnected battery reads ~0.01V and the percentage
  //   field is meaningless until the battery is actually wired.
  // - AHRS_FAIL / PREARM_FAIL / GPS_LOST / RC_LOST / MOTOR_FAIL: only fire
  //   when the vehicle is in an active flight state (systemStatus >= 4 =
  //   ACTIVE/CRITICAL/EMERGENCY). On the bench the FC sits in
  //   STANDBY (3) or BOOT (1), where these checks are normally failing
  //   for benign reasons (no GPS lock indoors, mag not calibrated yet).
  // - EMERGENCY: always shows — that's the FC's own active emergency state.
  //
  // MAV_STATE: 0=UNINIT, 1=BOOT, 2=CALIBRATING, 3=STANDBY, 4=ACTIVE,
  //            5=CRITICAL, 6=EMERGENCY, 7=POWEROFF, 8=FLIGHT_TERMINATION
  const isActiveFlight = systemStatus !== null && systemStatus >= 4;
  const battVoltage = battery?.voltage ?? 0;
  const hasRealBattery = battVoltage >= 1.0;

  // Check battery — only when a real battery is connected
  const battRemaining =
    knownRemainingPct(battery?.remaining) ?? knownRemainingPct(sysStatus?.batteryRemaining);
  if (hasRealBattery && battRemaining !== null && battRemaining < 15) {
    conditions.push({ type: "LOW_BATTERY", label: `Battery Critical: ${battRemaining}%`, icon: FAILSAFE_ICONS.LOW_BATTERY, severity: 2 });
  } else if (hasRealBattery && battRemaining !== null && battRemaining < 25) {
    conditions.push({ type: "LOW_BATTERY", label: `Battery Low: ${battRemaining}%`, icon: FAILSAFE_ICONS.LOW_BATTERY, severity: 1 });
  }

  // Check sensor health from SYS_STATUS bitmasks — only in active flight
  if (sysStatus && isActiveFlight) {
    const present = sysStatus.sensorsPresent;
    const health = sysStatus.sensorsHealthy;

    // GPS (bit 5)
    if ((present & (1 << 5)) && !(health & (1 << 5))) {
      conditions.push({ type: "GPS_LOST", label: "GPS Unhealthy", icon: FAILSAFE_ICONS.GPS_LOST, severity: 1 });
    }
    // RC (bit 16)
    if ((present & (1 << 16)) && !(health & (1 << 16))) {
      conditions.push({ type: "RC_LOST", label: "RC Signal Lost", icon: FAILSAFE_ICONS.RC_LOST, severity: 1 });
    }
    // AHRS (bit 21)
    if ((present & (1 << 21)) && !(health & (1 << 21))) {
      conditions.push({ type: "EKF_FAIL", label: "AHRS/EKF Failure", icon: FAILSAFE_ICONS.EKF_FAIL, severity: 1 });
    }
    // Motors (bit 15)
    if ((present & (1 << 15)) && !(health & (1 << 15))) {
      conditions.push({ type: "MOTOR_FAIL", label: "Motor Output Failure", icon: FAILSAFE_ICONS.MOTOR_FAIL, severity: 1 });
    }
    // PreArm (bit 28)
    if ((present & (1 << 28)) && !(health & (1 << 28))) {
      conditions.push({ type: "PREARM_FAIL", label: "Pre-Arm Check Failed", icon: FAILSAFE_ICONS.PREARM_FAIL, severity: 1 });
    }
  }

  // Check HEARTBEAT systemStatus — critical, emergency and flight-termination
  // states always show.
  if (systemStatus === 5 || systemStatus === 6 || systemStatus === 8) {
    conditions.push({
      type: "EMERGENCY",
      // MAV_STATE 5 = CRITICAL, 6 = EMERGENCY, 8 = FLIGHT_TERMINATION.
      label:
        systemStatus === 8
          ? "FLIGHT TERMINATION"
          : systemStatus === 6
            ? "EMERGENCY STATE"
            : "CRITICAL STATE",
      icon: FAILSAFE_ICONS.EMERGENCY,
      severity: systemStatus === 5 ? 2 : 3,
    });
  }

  if (conditions.length === 0) return null;
  if (isSuppressed(dismissal, droneId, conditions, Date.now())) return null;

  const isCritical = conditions.some((c) => c.severity >= 2);

  return (
    <div
      className={`flex-shrink-0 px-4 py-2 flex items-center gap-3 ${
        isCritical
          ? "bg-status-error/90 animate-pulse"
          : "bg-status-warning/80"
      }`}
    >
      <AlertTriangle size={16} className="text-white flex-shrink-0" />
      <div className="flex items-center gap-2 flex-wrap flex-1">
        {conditions.map((c) => (
          <span
            key={c.type}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/20 text-white text-xs font-semibold"
          >
            {c.icon}
            {c.label}
          </span>
        ))}
      </div>
      <button
        aria-label="Dismiss failsafe alerts"
        onClick={() => {
          const severity: Dismissal["severity"] = {};
          for (const c of conditions) severity[c.type] = c.severity;
          setDismissal({ droneId, severity, at: Date.now() });
        }}
        className="text-white/80 hover:text-white flex-shrink-0 cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
