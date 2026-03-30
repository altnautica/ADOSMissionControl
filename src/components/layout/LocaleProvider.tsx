/**
 * @module LocaleProvider
 * @description Client-side locale provider for next-intl. Reads locale from settings store
 * and dynamically loads the matching message bundle. No path-prefix routing — locale is
 * stored in IndexedDB and applied client-side.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import enMessages from "../../../locales/en.json";

const ACCENT_PRESETS: Record<string, { primary: string; hover: string; secondary: string }> = {
  blue: { primary: "#3a82ff", hover: "#5b9aff", secondary: "#dff140" },
  green: { primary: "#22c55e", hover: "#34d06d", secondary: "#9bcc2f" },
  amber: { primary: "#f59e0b", hover: "#f7b13a", secondary: "#7a9900" },
  red: { primary: "#ef4444", hover: "#f16363", secondary: "#c4cf3a" },
  lime: { primary: "#84cc16", hover: "#9bdf2a", secondary: "#2f6feb" },
  purple: { primary: "#a855f7", hover: "#b975f9", secondary: "#e879f9" },
  pink: { primary: "#ec4899", hover: "#f06dae", secondary: "#f9a8d4" },
  cyan: { primary: "#06b6d4", hover: "#22d3ee", secondary: "#67e8f9" },
  orange: { primary: "#f97316", hover: "#fb923c", secondary: "#fdba74" },
};

interface LocaleProviderProps {
  children: React.ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const locale = useSettingsStore((s) => s.locale);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const [messages, setMessages] = useState<Record<string, unknown>>(
    enMessages as Record<string, unknown>
  );

  useEffect(() => {
    // Dynamic import based on locale — only loads the needed bundle
    import(`../../../locales/${locale}.json`)
      .then((m) => setMessages(m.default as Record<string, unknown>))
      .catch(() => {
        // Fallback to English if locale bundle fails to load
        import("../../../locales/en.json").then((m: { default: Record<string, unknown> }) =>
          setMessages(m.default as Record<string, unknown>)
        );
      });
  }, [locale]);

  useEffect(() => {
    // Update <html lang=""> attribute when locale changes
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = themeMode || "dark";
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const preset = ACCENT_PRESETS[accentColor] || ACCENT_PRESETS.blue;
    document.documentElement.style.setProperty(
      "--alt-accent-primary",
      preset.primary
    );
    document.documentElement.style.setProperty(
      "--alt-accent-primary-hover",
      preset.hover
    );
    document.documentElement.style.setProperty(
      "--alt-accent-secondary",
      preset.secondary
    );
  }, [accentColor]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
