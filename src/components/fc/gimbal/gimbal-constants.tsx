import React from "react";
import type { EnumOption } from "../frame/enum-options";

export const GIMBAL_PARAMS: string[] = [];

export const OPTIONAL_GIMBAL_PARAMS = [
  "MNT1_TYPE", "MNT1_PITCH_MIN", "MNT1_PITCH_MAX",
  "MNT1_ROLL_MIN", "MNT1_ROLL_MAX",
  "MNT1_YAW_MIN", "MNT1_YAW_MAX",
  "MNT1_RC_RATE", "MNT1_DEFLT_MODE",
  "MNT1_RC_IN_TILT", "MNT1_RC_IN_ROLL", "MNT1_RC_IN_PAN",
];

/** ArduPilot MNT1_RC_IN_* take an RC channel number (0 = disabled). */
export const RC_INPUT_CHANNEL_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Disabled" },
  ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` })),
];

/** PX4 MNT_MAN_* (which the PX4 handler maps MNT1_RC_IN_* to) take an AUX index. */
export const PX4_MAN_INPUT_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Disabled" },
  ...Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1), label: `AUX${i + 1}` })),
];

/** ArduPilot MNT1_TYPE (AP_Mount_Params). */
export const MNT_TYPE_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — None" },
  { value: "1", label: "1 — Servo" },
  { value: "2", label: "2 — 3DR Solo" },
  { value: "3", label: "3 — Alexmos Serial" },
  { value: "4", label: "4 — SToRM32 MAVLink" },
  { value: "5", label: "5 — SToRM32 Serial" },
  { value: "6", label: "6 — MAVLink (Gremsy/AVT)" },
  { value: "7", label: "7 — BrushlessPWM" },
  { value: "8", label: "8 — Siyi" },
  { value: "9", label: "9 — Scripting" },
  { value: "10", label: "10 — Xacti" },
  { value: "11", label: "11 — Viewpro" },
  { value: "12", label: "12 — Topotek" },
  { value: "13", label: "13 — CADDX" },
  { value: "14", label: "14 — XFRobot" },
];

/** PX4 MNT_MODE_IN, which the PX4 handler maps MNT1_TYPE to; -1 disables the mount. */
export const PX4_MNT_MODE_IN_OPTIONS: readonly EnumOption[] = [
  { value: "-1", label: "-1 — Disabled" },
  { value: "0", label: "0 — Auto (RC and MAVLink v2)" },
  { value: "1", label: "1 — RC" },
  { value: "2", label: "2 — MAVLink ROI (v1)" },
  { value: "3", label: "3 — MAVLink DO_MOUNT (v1)" },
  { value: "4", label: "4 — MAVLink gimbal protocol v2" },
  { value: "5", label: "5 — Fixed world-frame attitude" },
];

/** MAV_MOUNT_MODE, used for MNT1_DEFLT_MODE and the live mount-mode command. */
export const MNT_MODE_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Retract" },
  { value: "1", label: "1 — Neutral" },
  { value: "2", label: "2 — MAVLink Targeting" },
  { value: "3", label: "3 — RC Targeting" },
  { value: "4", label: "4 — GPS Point" },
  { value: "5", label: "5 — SysID Target" },
  { value: "6", label: "6 — Home Location" },
];

export function GimbalCard({
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

export function LiveStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary block">{label}</span>
      <span className="text-sm font-mono text-text-primary">
        {value}
        <span className="text-[10px] text-text-tertiary ml-0.5">{unit}</span>
      </span>
    </div>
  );
}
