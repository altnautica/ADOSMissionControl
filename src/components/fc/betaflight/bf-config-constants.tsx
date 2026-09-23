import React from "react";
import { FEATURE_FLAG } from "@/lib/protocol/msp/msp-constants";

export const BF_CONFIG_PARAM_NAMES = [
  "BF_FEATURE_MASK",
  "BF_AUTO_DISARM_DELAY",
  "BF_SMALL_ANGLE",
  "BF_BEEPER_DISABLED_MASK",
] as const;

export const bfConfigParamNames = [...BF_CONFIG_PARAM_NAMES];

export interface FeatureDef {
  bit: number;
  label: string;
  description: string;
  /** First MSP API version (major, minor) whose firmware no longer has the bit. */
  removedInApi?: readonly [number, number];
}

/**
 * Betaflight features_e (config/feature.h). VBAT (bit 1) is gone from every
 * supported release; DYNAMIC_FILTER (bit 29) was removed in 4.3 (MSP API 1.44)
 * and is offered only to firmware that still reads it.
 */
export const FEATURE_DEFS: FeatureDef[] = [
  { bit: FEATURE_FLAG.RX_PPM, label: "RX_PPM", description: "PPM receiver input" },
  { bit: FEATURE_FLAG.RX_SERIAL, label: "RX_SERIAL", description: "Serial receiver (SBUS, CRSF, etc.)" },
  { bit: FEATURE_FLAG.MOTOR_STOP, label: "MOTOR_STOP", description: "Stop motors when armed at zero throttle" },
  { bit: FEATURE_FLAG.SOFTSERIAL, label: "SOFTSERIAL", description: "Software serial ports" },
  { bit: FEATURE_FLAG.GPS, label: "GPS", description: "GPS support" },
  { bit: FEATURE_FLAG.RANGEFINDER, label: "RANGEFINDER", description: "Rangefinder" },
  { bit: FEATURE_FLAG.TELEMETRY, label: "TELEMETRY", description: "Telemetry output (FrSky, CRSF, etc.)" },
  { bit: FEATURE_FLAG.LED_STRIP, label: "LED_STRIP", description: "Addressable LED strip" },
  { bit: FEATURE_FLAG.OSD, label: "OSD", description: "On-screen display" },
  { bit: FEATURE_FLAG.AIRMODE, label: "AIRMODE", description: "Airmode (full PID authority at zero throttle)" },
  { bit: FEATURE_FLAG.RX_SPI, label: "RX_SPI", description: "SPI receiver (built-in)" },
  { bit: FEATURE_FLAG.ESC_SENSOR, label: "ESC_SENSOR", description: "ESC telemetry sensor" },
  { bit: FEATURE_FLAG.ANTI_GRAVITY, label: "ANTI_GRAVITY", description: "Anti-gravity (I-term boost on throttle changes)" },
  { bit: FEATURE_FLAG.DYNAMIC_FILTER, label: "DYNAMIC_FILTER", description: "Dynamic notch filter", removedInApi: [1, 44] },
];

/**
 * The feature toggles the connected firmware reads. Without a known MSP API
 * version, bits removed from any current release are left out.
 */
export function featureDefsForApi(api: { major: number; minor: number } | undefined): FeatureDef[] {
  return FEATURE_DEFS.filter((f) => {
    if (!f.removedInApi) return true;
    if (!api) return false;
    const [major, minor] = f.removedInApi;
    return api.major < major || (api.major === major && api.minor < minor);
  });
}

export interface BeeperDef {
  bit: number;
  label: string;
}

export const BEEPER_DEFS: BeeperDef[] = [
  { bit: 0, label: "GYRO_CALIBRATED" },
  { bit: 1, label: "RX_LOST" },
  { bit: 2, label: "RX_LOST_LANDING" },
  { bit: 3, label: "DISARMING" },
  { bit: 4, label: "ARMING" },
  { bit: 5, label: "ARMING_GPS_FIX" },
  { bit: 6, label: "BAT_CRIT_LOW" },
  { bit: 7, label: "BAT_LOW" },
  { bit: 8, label: "GPS_STATUS" },
  { bit: 9, label: "RX_SET" },
  { bit: 10, label: "ACC_CALIBRATION" },
  { bit: 11, label: "ACC_CALIBRATION_FAIL" },
  { bit: 12, label: "READY_BEEP" },
  { bit: 13, label: "MULTI_BEEPS" },
  { bit: 14, label: "DISARM_REPEAT" },
  { bit: 15, label: "ARMED" },
  { bit: 16, label: "SYSTEM_INIT" },
  { bit: 17, label: "USB" },
  { bit: 18, label: "BLACKBOX_ERASE" },
  { bit: 19, label: "CRASH_FLIP" },
  { bit: 20, label: "CAM_CONNECTION_OPEN" },
  { bit: 21, label: "CAM_CONNECTION_CLOSE" },
  { bit: 22, label: "RC_SMOOTHING_INIT_FAIL" },
];

export function BfCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
