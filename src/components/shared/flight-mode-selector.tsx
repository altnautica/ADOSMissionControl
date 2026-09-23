"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import type { FlightMode } from "@/lib/types";
import { useDroneManager } from "@/stores/drone-manager";
import { useAvailableModes } from "@/hooks/use-available-modes";

interface FlightModeSelectorProps {
  value: FlightMode;
  onChange: (mode: FlightMode) => void;
  className?: string;
}

/** Translation keys for the modes that carry a label and description. */
const MODE_KEYS: Partial<Record<FlightMode, { labelKey: string; descKey: string }>> = {
  STABILIZE: { labelKey: "stabilize", descKey: "stabilizeDesc" },
  ALT_HOLD: { labelKey: "altHold", descKey: "altHoldDesc" },
  LOITER: { labelKey: "loiter", descKey: "loiterDesc" },
  GUIDED: { labelKey: "guided", descKey: "guidedDesc" },
  AUTO: { labelKey: "auto", descKey: "autoDesc" },
  RTL: { labelKey: "rtl", descKey: "rtlDesc" },
  LAND: { labelKey: "land", descKey: "landDesc" },
  MANUAL: { labelKey: "manual", descKey: "manualDesc" },
  ACRO: { labelKey: "acro", descKey: "acroDesc" },
  FBWA: { labelKey: "fbwa", descKey: "fbwaDesc" },
  FBWB: { labelKey: "fbwb", descKey: "fbwbDesc" },
  CRUISE: { labelKey: "cruise", descKey: "cruiseDesc" },
  AUTOTUNE: { labelKey: "autoTune", descKey: "autoTuneDesc" },
  CIRCLE: { labelKey: "circle", descKey: "circleDesc" },
  TRAINING: { labelKey: "training", descKey: "trainingDesc" },
  QSTABILIZE: { labelKey: "qstabilize", descKey: "qstabilizeDesc" },
  QHOVER: { labelKey: "qhover", descKey: "qhoverDesc" },
  QLOITER: { labelKey: "qloiter", descKey: "qloiterDesc" },
  QLAND: { labelKey: "qland", descKey: "qlandDesc" },
  QRTL: { labelKey: "qrtl", descKey: "qrtlDesc" },
  POSHOLD: { labelKey: "posHold", descKey: "posHoldDesc" },
  BRAKE: { labelKey: "brake", descKey: "brakeDesc" },
  SMART_RTL: { labelKey: "smartRtl", descKey: "smartRtlDesc" },
  DRIFT: { labelKey: "drift", descKey: "driftDesc" },
  SPORT: { labelKey: "sport", descKey: "sportDesc" },
  FLIP: { labelKey: "flip", descKey: "flipDesc" },
  THROW: { labelKey: "throw", descKey: "throwDesc" },
};

/** Offered when no firmware handler is known (no live link). */
const FALLBACK_MODES = Object.keys(MODE_KEYS) as FlightMode[];

/**
 * The modes the selector offers: the firmware handler's own mode table (the
 * same source the set-mode skill checks against), else the fallback list. The
 * current mode is always present so the live mode stays visible; when the
 * firmware table lacks it, it is listed but disabled.
 */
export function flightModeChoices(
  available: readonly FlightMode[] | null,
  current: FlightMode,
): { mode: FlightMode; disabled: boolean }[] {
  const modes = available ?? FALLBACK_MODES;
  const choices = modes.map((mode) => ({ mode, disabled: false }));
  if (!modes.includes(current)) choices.unshift({ mode: current, disabled: true });
  return choices;
}

export function FlightModeSelector({ value, onChange, className }: FlightModeSelectorProps) {
  const t = useTranslations("flightModes");
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const available = useAvailableModes(selectedDroneId);

  const options: SelectOption[] = useMemo(
    () =>
      flightModeChoices(available, value).map(({ mode, disabled }) => {
        const keys = MODE_KEYS[mode];
        return {
          value: mode,
          label: keys ? t(keys.labelKey) : mode,
          description: keys ? t(keys.descKey) : undefined,
          disabled,
        };
      }),
    [available, value, t],
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
