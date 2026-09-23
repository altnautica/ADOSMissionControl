"use client";

import { Sailboat } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

const SECTIONS: ParamSection[] = [
  {
    title: "Sailboat",
    fields: [
      { param: "SAIL_ENABLE", label: "Sailboat Enable", kind: "enum" },
      { param: "SAIL_ANGLE_MIN", label: "Min Sail Angle (deg)", kind: "number", min: 0, max: 90, step: 1 },
      { param: "SAIL_ANGLE_MAX", label: "Max Sail Angle (deg)", kind: "number", min: 0, max: 90, step: 1 },
      { param: "SAIL_ANGLE_IDEAL", label: "Ideal Angle of Attack (deg)", kind: "number", min: 0, max: 90, step: 1 },
      { param: "SAIL_HEEL_MAX", label: "Max Heel (deg)", kind: "number", min: 0, max: 90, step: 1 },
      { param: "SAIL_NO_GO_ANGLE", label: "No-Go Angle (deg)", kind: "number", min: 0, max: 90, step: 1 },
      { param: "SAIL_WNDSPD_MIN", label: "Min Wind Speed (m/s)", kind: "number", min: 0, max: 5, step: 0.1 },
      { param: "SAIL_XTRACK_MAX", label: "Max Cross-Track (m)", kind: "number", min: 0, max: 50, step: 1 },
      { param: "SAIL_LOIT_RADIUS", label: "Loiter Radius (m)", kind: "number", min: 0, max: 50, step: 1 },
    ],
  },
  {
    title: "Wind Vane",
    fields: [
      { param: "WNDVN_TYPE", label: "Wind Vane Type", kind: "enum" },
      { param: "WNDVN_DIR_PIN", label: "Direction Pin", kind: "number", min: -1, max: 103, step: 1 },
      { param: "WNDVN_SPEED_TYPE", label: "Speed Sensor Type", kind: "enum" },
      { param: "WNDVN_DIR_OFS", label: "Direction Offset (deg)", kind: "number", min: 0, max: 360, step: 1 },
    ],
  },
];

export function SailboatPanel() {
  return (
    <ParamFieldsPanel
      panelId="sailboat"
      title="Sailboat"
      subtitle="Sail control and wind-vane setup for a sailing vehicle"
      icon={<Sailboat size={16} />}
      sectionIcon={<Sailboat size={14} />}
      sections={SECTIONS}
      gate={{
        param: "SAIL_ENABLE",
        off: (v) => v === 0,
        message: "This vehicle is not configured as a sailboat (SAIL_ENABLE = 0).",
      }}
    />
  );
}
