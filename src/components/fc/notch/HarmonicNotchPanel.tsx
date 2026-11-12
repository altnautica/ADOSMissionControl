"use client";

import { useTranslations } from "next-intl";
import { Activity } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

const SECTIONS: ParamSection[] = [
  {
    title: "Harmonic Notch 1",
    fields: [
      { param: "INS_HNTCH_ENABLE", label: "Enable", kind: "enum" },
      { param: "INS_HNTCH_MODE", label: "Tracking Mode", kind: "enum" },
      { param: "INS_HNTCH_FREQ", label: "Center Frequency (Hz)", kind: "number", min: 10, max: 495, step: 1 },
      { param: "INS_HNTCH_BW", label: "Bandwidth (Hz)", kind: "number", min: 5, max: 250, step: 1 },
      { param: "INS_HNTCH_ATT", label: "Attenuation (dB)", kind: "number", min: 5, max: 50, step: 1 },
      { param: "INS_HNTCH_REF", label: "Reference Value", kind: "number", min: 0, max: 1, step: 0.01 },
      { param: "INS_HNTCH_HMNCS", label: "Harmonics", kind: "bitmask" },
      { param: "INS_HNTCH_OPTS", label: "Options", kind: "bitmask" },
    ],
  },
  {
    title: "In-flight FFT",
    collapsible: true,
    defaultOpen: false,
    fields: [
      { param: "FFT_ENABLE", label: "FFT Enable", kind: "enum" },
      { param: "FFT_MINHZ", label: "Min Frequency (Hz)", kind: "number", min: 10, max: 200, step: 1 },
      { param: "FFT_MAXHZ", label: "Max Frequency (Hz)", kind: "number", min: 50, max: 495, step: 1 },
      { param: "FFT_SNR_REF", label: "SNR Threshold (dB)", kind: "number", min: 0, max: 50, step: 1 },
    ],
  },
];

export function HarmonicNotchPanel() {
  const tr = useTranslations("fcPanels.harmonicNotchPanel");
  return (
    <ParamFieldsPanel
      panelId="notch"
      title={tr("harmonicNotchFilter")}
      subtitle={tr("dynamicNotchFilterInFlight")}
      icon={<Activity size={16} />}
      sectionIcon={<Activity size={14} />}
      sections={SECTIONS}
      gate={{
        param: "INS_HNTCH_ENABLE",
        off: (v) => v === 0,
        message: "The harmonic notch is disabled (INS_HNTCH_ENABLE = 0).",
      }}
    />
  );
}
