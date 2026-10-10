"use client";

/**
 * @module cockpit/confirm/AltitudeStepper
 * @description The take-off altitude on the confirm sheet: a clamped stepper
 * whose value is the altitude actually commanded.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import type { ConfirmAltitude } from "@/lib/skills/types";

interface AltitudeStepperProps {
  spec: ConfirmAltitude;
  value: number;
  onChange: (altitudeM: number) => void;
}

export function AltitudeStepper({ spec, value, onChange }: AltitudeStepperProps) {
  const t = useTranslations("cockpit.confirm");
  const set = (next: number) =>
    onChange(Math.max(spec.minM, Math.min(spec.maxM, Math.round(next))));

  const stepClass =
    "flex h-10 w-10 items-center justify-center rounded-md border border-border-default text-text-primary hover:border-accent-primary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary";

  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="skill-confirm-altitude" className="text-xs text-text-secondary">
        {t("altitude")}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => set(value - spec.stepM)}
          disabled={value <= spec.minM}
          aria-label={t("altitudeDecrease")}
          className={stepClass}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          id="skill-confirm-altitude"
          type="number"
          inputMode="numeric"
          min={spec.minM}
          max={spec.maxM}
          step={spec.stepM}
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) set(next);
          }}
          className="h-10 w-16 rounded-md border border-border-default bg-bg-primary text-center font-mono text-sm tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
        <span className="text-xs text-text-tertiary">{t("altitudeUnit")}</span>
        <button
          type="button"
          onClick={() => set(value + spec.stepM)}
          disabled={value >= spec.maxM}
          aria-label={t("altitudeIncrease")}
          className={stepClass}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
