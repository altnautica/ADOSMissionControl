import React from "react";
import type { EnumOption } from "../frame/enum-options";

export const CAMERA_PARAMS: string[] = [];

export const OPTIONAL_CAMERA_PARAMS = [
  "CAM1_TYPE", "CAM1_DURATION", "CAM1_SERVO_OFF", "CAM1_SERVO_ON", "CAM1_TRIGG_DIST",
];

/** ArduPilot CAM1_TYPE (AP_Camera_Params). */
export const CAM_TYPE_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — None" },
  { value: "1", label: "1 — Servo" },
  { value: "2", label: "2 — Relay" },
  { value: "3", label: "3 — GoPro in Solo Gimbal" },
  { value: "4", label: "4 — Mount (Siyi/Topotek/Viewpro/Xacti)" },
  { value: "5", label: "5 — MAVLink" },
  { value: "6", label: "6 — MAVLinkCamV2 (Gremsy/AVT)" },
  { value: "7", label: "7 — Scripting" },
  { value: "8", label: "8 — RunCam" },
];

/** PX4 TRIG_MODE, which the PX4 handler maps CAM1_TYPE to. */
export const PX4_TRIG_MODE_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — Time based, on command" },
  { value: "2", label: "2 — Time based, always on" },
  { value: "3", label: "3 — Distance based, always on" },
  { value: "4", label: "4 — Distance based, on command (survey)" },
];

export function CameraCard({
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
