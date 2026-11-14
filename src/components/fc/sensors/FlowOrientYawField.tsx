"use client";

/**
 * @module fc/sensors/FlowOrientYawField
 * @description FLOW_ORIENT_YAW in centidegrees (-17999..18000, step 10) with
 * quick presets and live validation. A wrong value inverts the flow velocity
 * feedback (https://ardupilot.org/copter/docs/common-mtf-01.html), so an
 * invalid value is reported here and SensorsPanel refuses to save it.
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  FLOW_ORIENT_YAW_MAX,
  FLOW_ORIENT_YAW_MIN,
  FLOW_ORIENT_YAW_PRESETS,
  FLOW_ORIENT_YAW_STEP,
  legacyYawCdeg,
  validateFlowOrientYaw,
} from "@/lib/sensors/flow-orient-yaw";

interface FlowOrientYawFieldProps {
  label: ReactNode;
  /** The panel's current value; undefined while unread. */
  value: number | undefined;
  onChange: (cdeg: number) => void;
}

export function FlowOrientYawField({ label, value, onChange }: FlowOrientYawFieldProps) {
  const t = useTranslations("fcPanels.sensorsPanel.flowSetup");
  // The text being typed, so "-" or an empty field can pass through on the
  // way to a number without snapping to 0.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const check = shown.trim() === "" ? null : validateFlowOrientYaw(Number(shown));

  let error: string | undefined;
  if (check?.issue === "not_number") error = t("yawNotNumber");
  else if (check?.issue === "out_of_range") error = t("yawOutOfRange", { min: FLOW_ORIENT_YAW_MIN, max: FLOW_ORIENT_YAW_MAX });
  else if (check?.issue === "not_step") error = t("yawNotStep", { step: FLOW_ORIENT_YAW_STEP });
  else if (check?.issue === "legacy") {
    const step = Number(shown);
    error = t("yawLegacy", { value: shown, deg: check.degrees.toFixed(2), angle: step * 45, cdeg: legacyYawCdeg(step) });
  }

  const pick = (cdeg: number) => {
    setDraft(null);
    onChange(cdeg);
  };

  return (
    <div className="space-y-1.5">
      <Input
        label={label}
        type="number"
        step={FLOW_ORIENT_YAW_STEP}
        min={FLOW_ORIENT_YAW_MIN}
        max={FLOW_ORIENT_YAW_MAX}
        unit="cdeg"
        value={shown}
        error={error}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-text-tertiary">{t("yawPresets")}</span>
        {FLOW_ORIENT_YAW_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              value === v ? "border-accent-primary text-accent-primary" : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            {v} ({v > 0 && v < 18000 ? "+" : ""}{v / 100}°)
          </button>
        ))}
      </div>
      {check?.valid && (
        <p className="text-[10px] text-text-tertiary">{t("yawDegrees", { deg: check.degrees })}</p>
      )}
      <p className="text-[10px] text-status-warning">{t("yawCaution")}</p>
    </div>
  );
}
