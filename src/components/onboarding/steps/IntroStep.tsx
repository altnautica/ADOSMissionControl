"use client";

/**
 * @module IntroStep
 * @description Brand moment with tagline, description, badges, and privacy
 * promise. Two-column layout on md+ viewports.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { isElectron } from "@/lib/utils";
import { PRIMARY_CTA_CLASS } from "../constants";
import { StepDots } from "../parts/StepDots";
import { BackButton } from "./BackButton";

interface Props {
  next: () => void;
  back: () => void;
  dotStep: number;
  totalSteps: number;
}

export function IntroStep({ next, back, dotStep, totalSteps }: Props) {
  const tk = useTranslations("onboarding.introStep");
  const t = useTranslations("welcome");
  // The browser line ("Runs in your browser") is wrong in the desktop app.
  // Read after mount so the server render and first client render agree.
  const desktop = useHasMounted() && isElectron();

  return (
    <>
      <BackButton onClick={back} />

      {/* Left: brand lockup */}
      <div className="flex-none md:w-2/5 flex flex-col items-center justify-center p-8 pt-14 sm:p-10 md:p-16 border-b md:border-b-0 md:border-e border-border-default">
        <div className="text-center">
          <p className="font-display text-4xl sm:text-5xl md:text-7xl font-bold text-accent-primary leading-none">ADOS</p>
          <p className="font-display text-lg sm:text-xl md:text-2xl font-semibold text-text-primary mt-2">{tk("mission")}</p>
          <p className="font-display text-lg sm:text-xl md:text-2xl font-semibold text-text-primary">{tk("control")}</p>
          <div className="mt-4 sm:mt-6 w-16 h-px bg-accent-primary mx-auto opacity-50" />
        </div>
      </div>

      {/* Right: copy */}
      <div className="flex-1 flex flex-col justify-center p-6 sm:p-10 md:p-16 overflow-y-auto">
        <p className="text-lg font-semibold text-text-primary leading-snug mb-4">
          {t("intro.tagline")}
        </p>
        <p className="text-sm text-text-secondary leading-relaxed mb-8">
          {t(desktop ? "intro.descriptionDesktop" : "intro.description")}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-8">
          <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
            {t("intro.openBeta")}
          </span>
          <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
            {t("intro.freeForever")}
          </span>
          <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
            {t("intro.openSource")}
          </span>
        </div>

        {/* Privacy promise */}
        <p className="text-xs text-text-tertiary flex items-center gap-1.5 mb-8">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span><strong className="text-text-secondary">{t("intro.privacy")}</strong> {t("intro.privacyDetail")}</span>
        </p>

        <button
          type="button"
          onClick={next}
          className={`${PRIMARY_CTA_CLASS} self-start`}
        >
          {t("intro.getStarted")} →
        </button>

        <StepDots step={dotStep} total={totalSteps} />
      </div>
    </>
  );
}
