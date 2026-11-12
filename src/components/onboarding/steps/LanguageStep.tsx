"use client";

/**
 * @module LanguageStep
 * @description First onboarding step. Locale grid with flag tiles. Selecting
 * a tile updates the persisted settings locale immediately so subsequent
 * steps render in the chosen language.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { locales, localeNames } from "@/i18n";
import { PRIMARY_CTA_CLASS } from "../constants";
import { StepDots } from "../parts/StepDots";

interface Props {
  selectedLocale: string;
  onLocaleChange: (code: string) => void;
  next: () => void;
  dotStep: number;
  totalSteps: number;
}

export function LanguageStep({ selectedLocale, onLocaleChange, next, dotStep, totalSteps }: Props) {
  const tk = useTranslations("onboarding.languageStep");
  const t = useTranslations("welcome");
  const setLocale = useSettingsStore((s) => s.setLocale);

  return (
    <>
      {/* Brand header */}
      <div className="text-center mb-10">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.25em] text-accent-primary">ADOS</p>
        <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-medium mt-0.5">{tk("missionControl")}</p>
      </div>

      <h2 className="text-xl font-display font-semibold text-text-primary mb-8 text-center">
        {t("language.title")}
      </h2>

      {/* Language grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 w-full max-w-xl mb-8 sm:mb-10">
        {(locales as readonly string[]).map((code) => {
          const info = localeNames[code as keyof typeof localeNames];
          const isSelected = selectedLocale === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => {
                onLocaleChange(code);
                setLocale(code);
              }}
              className={`flex flex-col items-center gap-1 p-4 border rounded-sm transition-all ${
                isSelected
                  ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                  : "border-border-default bg-bg-secondary text-text-secondary hover:border-accent-primary/50"
              }`}
            >
              <span className="text-2xl">{info.flag}</span>
              <span className="text-sm font-medium">{info.native}</span>
              <span className="text-[10px] text-text-tertiary">{info.english}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={next}
        className={PRIMARY_CTA_CLASS}
      >
        {t("language.continue")} →
      </button>

      <StepDots step={dotStep} total={totalSteps} />
    </>
  );
}
