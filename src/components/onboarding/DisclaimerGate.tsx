"use client";

/**
 * @module DisclaimerGate
 * @description Standalone disclaimer block for onboarded users who have not
 * accepted the current disclaimer version (they onboarded before the
 * disclaimer step existed, or the text changed since). Renders the same
 * six-section body as the in-flow step and blocks the app until the
 * checkbox + accept button persist the current disclaimer version.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { DISCLAIMER_VERSION, PRIMARY_CTA_CLASS } from "./constants";
import { DisclaimerBody } from "./steps/DisclaimerBody";

export function DisclaimerGate() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const disclaimerAccepted = useSettingsStore((s) => s.disclaimerAccepted);
  const disclaimerVersion = useSettingsStore((s) => s.disclaimerVersion);
  const setDisclaimerAccepted = useSettingsStore((s) => s.setDisclaimerAccepted);
  const t = useTranslations("welcome");
  const [checked, setChecked] = useState(false);

  const acceptedCurrent = disclaimerAccepted && disclaimerVersion >= DISCLAIMER_VERSION;
  if (!hasHydrated || !onboarded || acceptedCurrent) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-bg-primary overflow-hidden flex items-center justify-center p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("disclaimer.title")}
    >
      <div className="w-full max-w-2xl">
        <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
          {t("disclaimer.title")}
        </h2>
        <p className="text-xs text-text-tertiary mb-6 text-center">
          {t("disclaimer.subtitle")}
        </p>

        <DisclaimerBody />

        <label className="flex items-start gap-3 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => setChecked(!checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-accent-primary rounded-sm border-border-default bg-bg-tertiary"
          />
          <span className="text-xs text-text-primary leading-relaxed">
            {t("disclaimer.acceptCheckbox")}
          </span>
        </label>

        <button
          type="button"
          disabled={!checked}
          onClick={() => setDisclaimerAccepted(DISCLAIMER_VERSION)}
          className={`${PRIMARY_CTA_CLASS} block w-fit mx-auto ${!checked ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
        >
          {t("disclaimer.acceptButton")}
        </button>
      </div>
    </div>
  );
}
