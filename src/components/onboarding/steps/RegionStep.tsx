"use client";

/**
 * @module RegionStep
 * @description Onboarding step for the default operating region applied to
 * paired drones. Default is Unrestricted: a drone's radio works out of the
 * box anywhere and the operator is responsible for legal RF operation in
 * their jurisdiction. Pinning a region restores the strict regulatory gate
 * and the region's legal power limit; it is re-confirmable per drone on the
 * System tab. Local form state lives in the parent so the user can move
 * back and forth without losing the entry.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import {
  COMMON_REGIONS,
  OTHER_REGION_VALUE,
  UNRESTRICTED_VALUE,
  normalizeRegionCode,
} from "@/lib/operating-region";
import { PRIMARY_CTA_CLASS } from "../constants";
import { StepDots } from "../parts/StepDots";
import { UnrestrictedRegionBadge } from "@/components/command/system/UnrestrictedRegionBadge";
import { BackButton } from "./BackButton";

interface Props {
  /** Current picker selection: the unrestricted sentinel, a region code,
   * or the "other" sentinel. */
  selection: string;
  /** Free-text ISO code when the "other" option is chosen. */
  otherCode: string;
  setSelection: (value: string) => void;
  setOtherCode: (value: string) => void;
  next: () => void;
  back: () => void;
  dotStep: number;
  totalSteps: number;
}

export function RegionStep({
  selection,
  otherCode,
  setSelection,
  setOtherCode,
  next,
  back,
  dotStep,
  totalSteps,
}: Props) {
  const t = useTranslations("welcome.region");
  const tCommon = useTranslations("common");

  const options = [
    {
      value: UNRESTRICTED_VALUE,
      label: t("optionUnrestricted"),
      description: t("optionUnrestrictedHint"),
    },
    ...COMMON_REGIONS.map((r) => ({
      value: r.code,
      label: `${r.name} (${r.code})`,
    })),
    {
      value: OTHER_REGION_VALUE,
      label: t("optionOther"),
      description: t("optionOtherHint"),
    },
  ];

  const isUnrestricted = selection === UNRESTRICTED_VALUE;
  // An "Other" entry that is not a two-letter code must never fall through
  // to the unrestricted default; hold the step until it is valid.
  const otherInvalid =
    selection === OTHER_REGION_VALUE && normalizeRegionCode(otherCode) === null;

  return (
    <>
      <BackButton onClick={back} />

      <div className="w-full max-w-lg">
        <h2 className="text-xl font-display font-semibold text-text-primary mb-2 text-center">
          {t("title")}
        </h2>
        <p className="text-sm text-text-secondary mb-6 text-center">
          {t("subtitle")}
        </p>

        <div className="space-y-4">
          <Select
            label={t("pickerLabel")}
            value={selection}
            onChange={setSelection}
            options={options}
            searchable
          />

          {selection === OTHER_REGION_VALUE ? (
            <div>
              <label className="mb-1 block text-xs text-text-secondary">
                {t("otherFieldLabel")}
              </label>
              <input
                type="text"
                value={otherCode}
                maxLength={2}
                placeholder={t("otherFieldPlaceholder")}
                onChange={(e) => setOtherCode(e.target.value)}
                className="h-9 w-full rounded border border-border-default bg-bg-tertiary px-2 font-mono text-sm uppercase text-text-primary focus:border-accent-primary focus:outline-none"
              />
              {otherInvalid ? (
                <p role="alert" className="mt-1 text-[11px] text-status-error">
                  {t("otherInvalid")}
                </p>
              ) : null}
            </div>
          ) : null}

          {isUnrestricted ? (
            <div className="flex items-center gap-2 rounded border border-status-warning/30 bg-status-warning/5 px-3 py-2">
              <UnrestrictedRegionBadge compact />
              <span className="text-[11px] text-text-tertiary">
                {t("unrestrictedNote")}
              </span>
            </div>
          ) : null}

          <p className="text-[11px] text-text-tertiary">{t("perDroneNote")}</p>
        </div>

        <button
          type="button"
          onClick={next}
          disabled={otherInvalid}
          className={`${PRIMARY_CTA_CLASS} mt-8 block w-fit mx-auto ${otherInvalid ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
        >
          {tCommon("continue")} →
        </button>

        <StepDots step={dotStep} total={totalSteps} />
      </div>
    </>
  );
}
