"use client";

/**
 * @module ReadyStep
 * @description Final step. Big check mark and three community cards
 * (Discord, GitHub, Docs). Open App finalises onboarding via the supplied
 * callback so the parent persists collected preferences in one place.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PRIMARY_CTA_CLASS } from "../constants";
import { StepDots } from "../parts/StepDots";
import { BackButton } from "./BackButton";

interface Props {
  onFinish: () => void;
  back: () => void;
  dotStep: number;
  totalSteps: number;
}

export function ReadyStep({ onFinish, back, dotStep, totalSteps }: Props) {
  const t = useTranslations("welcome");

  return (
    <>
      <BackButton onClick={back} />

      <div className="text-center max-w-lg w-full">
        {/* Check mark */}
        <div className="w-14 h-14 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>

        <h2 className="text-2xl font-display font-semibold text-text-primary mb-1">
          {t("ready.title")}
        </h2>
        <p className="text-xs text-text-tertiary mb-6">
          {t("ready.communityDescription")}
        </p>

        {/* Community cards */}
        <div className="grid grid-cols-1 gap-3 mb-6 text-left">
          {/* Discord card */}
          <a
            href="https://discord.gg/uxbvuD4d5q"
            target="_blank"
            rel="noopener noreferrer"
            className="group border border-border-default bg-bg-secondary rounded-lg p-4 hover:border-[#5865F2]/50 transition-colors"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#5865F2]/10 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[#5865F2]">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary group-hover:text-[#5865F2] transition-colors">{t("ready.discordHeading")}</p>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
              {t("ready.discordDescription")}
            </p>
            <span className="text-[11px] font-medium text-[#5865F2] group-hover:underline">
              {t("ready.joinDiscord")} &rarr;
            </span>
          </a>

          {/* GitHub card */}
          <a
            href="https://github.com/altnautica/ADOSMissionControlGCS"
            target="_blank"
            rel="noopener noreferrer"
            className="group border border-border-default bg-bg-secondary rounded-lg p-4 hover:border-text-secondary/30 transition-colors"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-text-primary/5 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary group-hover:text-text-primary transition-colors">{t("ready.githubHeading")}</p>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
              {t("ready.githubDescription")}
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-primary group-hover:underline">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              {t("ready.starGitHub")} &rarr;
            </span>
          </a>

          {/* Docs card */}
          <a
            href="https://docs.altnautica.com"
            target="_blank"
            rel="noopener noreferrer"
            className="group border border-border-default bg-bg-secondary rounded-lg p-4 hover:border-accent-primary/50 transition-colors"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary group-hover:text-accent-primary transition-colors">{t("ready.docsHeading")}</p>
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
              {t("ready.docsDescription")}
            </p>
            <span className="text-[11px] font-medium text-accent-primary group-hover:underline">
              {t("ready.browseDocs")} &rarr;
            </span>
          </a>
        </div>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={onFinish}
          className={`${PRIMARY_CTA_CLASS} mb-4`}
        >
          {t("ready.openApp")}
        </button>

        <StepDots step={dotStep} total={totalSteps} />
      </div>
    </>
  );
}
