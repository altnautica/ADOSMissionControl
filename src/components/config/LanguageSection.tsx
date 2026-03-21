/**
 * @module LanguageSection
 * @description Language picker for the Settings/Config page. Instantly switches locale
 * by writing to settings-store (persisted to IndexedDB). No page reload required.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { locales, localeNames } from "@/i18n";

export function LanguageSection() {
  const t = useTranslations("settings");
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-text-primary">{t("language")}</h3>
        <p className="text-[11px] text-text-tertiary mt-0.5">{t("languageDescription")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(locales as readonly string[]).map((code) => {
          const info = localeNames[code as keyof typeof localeNames];
          const isSelected = locale === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              className={`flex flex-col items-center gap-1 p-3 border rounded-sm text-center transition-all ${
                isSelected
                  ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                  : "border-border-default bg-bg-secondary text-text-secondary hover:border-accent-primary/50"
              }`}
            >
              <span className="text-xl">{info.flag}</span>
              <span className="text-xs font-medium">{info.native}</span>
              <span className="text-[9px] text-text-tertiary">{info.english}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-text-tertiary mt-3">
        {t("languageNote")} —{" "}
        <a
          href="https://github.com/altnautica/ADOSMissionControl"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-primary hover:underline"
        >
          GitHub
        </a>
      </p>
    </div>
  );
}
