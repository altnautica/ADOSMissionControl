"use client";

import { useTranslations } from "next-intl";
import { Wind } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

const SECTIONS: ParamSection[] = [
  {
    title: "Airspeed Sensor",
    fields: [
      { param: "ARSPD_TYPE", label: "Sensor Type", kind: "enum" },
      { param: "ARSPD_USE", label: "Use for Control", kind: "enum" },
      { param: "ARSPD_RATIO", label: "Calibration Ratio", kind: "number", min: 0.5, max: 5, step: 0.01 },
      { param: "ARSPD_AUTOCAL", label: "In-flight Autocal", kind: "enum" },
      { param: "ARSPD_PIN", label: "Analog Pin", kind: "number", min: 0, max: 103, step: 1 },
      { param: "ARSPD_OPTIONS", label: "Options", kind: "bitmask" },
    ],
  },
  {
    title: "Speed Envelope",
    fields: [
      { param: "AIRSPEED_MIN", label: "Min Airspeed (m/s)", kind: "number", min: 5, max: 50, step: 0.5 },
      { param: "AIRSPEED_CRUISE", label: "Cruise Airspeed (m/s)", kind: "number", min: 5, max: 60, step: 0.5 },
      { param: "AIRSPEED_MAX", label: "Max Airspeed (m/s)", kind: "number", min: 5, max: 80, step: 0.5 },
    ],
  },
];

export function AirspeedPanel() {
  const tr = useTranslations("fcPanels.airspeedPanel");
  return (
    <ParamFieldsPanel
      panelId="airspeed"
      title={tr("airspeed")}
      subtitle={tr("airspeedSensorCalibrationAndThe")}
      icon={<Wind size={16} />}
      sectionIcon={<Wind size={14} />}
      sections={SECTIONS}
      gate={{
        param: "ARSPD_USE",
        off: (v) => v === 0,
        message: "Airspeed is not used for control (ARSPD_USE = 0). Enable it to fly airspeed-controlled.",
      }}
    />
  );
}
