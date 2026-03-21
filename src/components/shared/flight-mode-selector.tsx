"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import type { FlightMode } from "@/lib/types";

interface FlightModeSelectorProps {
  value: FlightMode;
  onChange: (mode: FlightMode) => void;
  className?: string;
}

const MODE_ENTRIES: { value: string; labelKey: string; descKey: string }[] = [
  { value: "STABILIZE", labelKey: "stabilize", descKey: "stabilizeDesc" },
  { value: "ALT_HOLD", labelKey: "altHold", descKey: "altHoldDesc" },
  { value: "LOITER", labelKey: "loiter", descKey: "loiterDesc" },
  { value: "GUIDED", labelKey: "guided", descKey: "guidedDesc" },
  { value: "AUTO", labelKey: "auto", descKey: "autoDesc" },
  { value: "RTL", labelKey: "rtl", descKey: "rtlDesc" },
  { value: "LAND", labelKey: "land", descKey: "landDesc" },
  { value: "MANUAL", labelKey: "manual", descKey: "manualDesc" },
  { value: "ACRO", labelKey: "acro", descKey: "acroDesc" },
  { value: "FBWA", labelKey: "fbwa", descKey: "fbwaDesc" },
  { value: "FBWB", labelKey: "fbwb", descKey: "fbwbDesc" },
  { value: "CRUISE", labelKey: "cruise", descKey: "cruiseDesc" },
  { value: "AUTOTUNE", labelKey: "autoTune", descKey: "autoTuneDesc" },
  { value: "CIRCLE", labelKey: "circle", descKey: "circleDesc" },
  { value: "TRAINING", labelKey: "training", descKey: "trainingDesc" },
  { value: "QSTABILIZE", labelKey: "qstabilize", descKey: "qstabilizeDesc" },
  { value: "QHOVER", labelKey: "qhover", descKey: "qhoverDesc" },
  { value: "QLOITER", labelKey: "qloiter", descKey: "qloiterDesc" },
  { value: "QLAND", labelKey: "qland", descKey: "qlandDesc" },
  { value: "QRTL", labelKey: "qrtl", descKey: "qrtlDesc" },
  { value: "POSHOLD", labelKey: "posHold", descKey: "posHoldDesc" },
  { value: "BRAKE", labelKey: "brake", descKey: "brakeDesc" },
  { value: "SMART_RTL", labelKey: "smartRtl", descKey: "smartRtlDesc" },
  { value: "DRIFT", labelKey: "drift", descKey: "driftDesc" },
  { value: "SPORT", labelKey: "sport", descKey: "sportDesc" },
  { value: "FLIP", labelKey: "flip", descKey: "flipDesc" },
  { value: "THROW", labelKey: "throw", descKey: "throwDesc" },
];

export function FlightModeSelector({ value, onChange, className }: FlightModeSelectorProps) {
  const t = useTranslations("flightModes");

  const options: SelectOption[] = useMemo(
    () => MODE_ENTRIES.map((m) => ({
      value: m.value,
      label: t(m.labelKey),
      description: t(m.descKey),
    })),
    [t],
  );

  return (
    <Select
      options={options}
      value={value}
      onChange={(v) => onChange(v as FlightMode)}
      className={className}
    />
  );
}
