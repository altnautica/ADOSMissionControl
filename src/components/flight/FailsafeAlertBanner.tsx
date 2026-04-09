"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, X, ShieldAlert, Radio, Navigation, Cpu, Zap } from "lucide-react";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useDroneStore } from "@/stores/drone-store";

type FailsafeType = "LOW_BATTERY" | "GPS_LOST" | "RC_LOST" | "EKF_FAIL" | "MOTOR_FAIL" | "PREARM_FAIL" | "EMERGENCY";

interface FailsafeCondition {
  type: FailsafeType;
  label: string;
  icon: React.ReactNode;
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
  const [dismissed, setDismissed] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(0);

  // Re-show after 30s if conditions persist
  useEffect(() => {
    if (!dismissed) return;
    const timer = setInterval(() => {
      if (Date.now() - dismissedAt > 30000) {
        setDismissed(false);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [dismissed, dismissedAt]);

  // Don't show if not connected
  if (connectionState === "disconnected") return null;

  const conditions: FailsafeCondition[] = [];

  // DEC-108 bench mode gating: a drone sitting on a bench with no real
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
  const battRemaining = battery?.remaining ?? sysStatus?.batteryRemaining ?? -1;
  if (hasRealBattery && battRemaining >= 0 && battRemaining < 15) {
    conditions.push({ type: "LOW_BATTERY", label: `Battery Critical: ${battRemaining}%`, icon: FAILSAFE_ICONS.LOW_BATTERY });
  } else if (hasRealBattery && battRemaining >= 0 && battRemaining < 25) {
    conditions.push({ type: "LOW_BATTERY", label: `Battery Low: ${battRemaining}%`, icon: FAILSAFE_ICONS.LOW_BATTERY });
  }

  // Check sensor health from SYS_STATUS bitmasks — only in active flight
  if (sysStatus && isActiveFlight) {
    const present = sysStatus.sensorsPresent;
    const health = sysStatus.sensorsHealthy;

    // GPS (bit 5)
    if ((present & (1 << 5)) && !(health & (1 << 5))) {
      conditions.push({ type: "GPS_LOST", label: "GPS Unhealthy", icon: FAILSAFE_ICONS.GPS_LOST });
    }
    // RC (bit 16)
    if ((present & (1 << 16)) && !(health & (1 << 16))) {
      conditions.push({ type: "RC_LOST", label: "RC Signal Lost", icon: FAILSAFE_ICONS.RC_LOST });
    }
    // AHRS (bit 21)
    if ((present & (1 << 21)) && !(health & (1 << 21))) {
      conditions.push({ type: "EKF_FAIL", label: "AHRS/EKF Failure", icon: FAILSAFE_ICONS.EKF_FAIL });
    }
    // Motors (bit 15)
    if ((present & (1 << 15)) && !(health & (1 << 15))) {
      conditions.push({ type: "MOTOR_FAIL", label: "Motor Output Failure", icon: FAILSAFE_ICONS.MOTOR_FAIL });
    }
    // PreArm (bit 28)
    if ((present & (1 << 28)) && !(health & (1 << 28))) {
      conditions.push({ type: "PREARM_FAIL", label: "Pre-Arm Check Failed", icon: FAILSAFE_ICONS.PREARM_FAIL });
    }
  }

  // Check HEARTBEAT systemStatus — emergency states always show
  if (systemStatus === 5 || systemStatus === 6) {
    conditions.push({
      type: "EMERGENCY",
      label: systemStatus === 6 ? "CRITICAL STATE" : "EMERGENCY STATE",
      icon: FAILSAFE_ICONS.EMERGENCY,
    });
  }

  if (conditions.length === 0 || dismissed) return null;

  const isCritical = conditions.some(
    (c) => c.type === "EMERGENCY" || (c.type === "LOW_BATTERY" && battRemaining < 15)
  );

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
        onClick={() => {
          setDismissed(true);
          setDismissedAt(Date.now());
        }}
        className="text-white/80 hover:text-white flex-shrink-0 cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
