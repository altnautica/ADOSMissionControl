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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMessages(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];

    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeMessages(baseValue, overrideValue);
    } else {
      merged[key] = overrideValue;
    }
  }

  return merged;
}

/** The accent variables the operator's accent choice writes inline on the root. */
const ACCENT_VARS = [
  "--alt-accent-primary",
  "--alt-accent-primary-hover",
  "--alt-accent-secondary",
] as const;

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
      .then((m) => {
        const localeMessages = m.default as Record<string, unknown>;
        const fallbackMessages = enMessages as Record<string, unknown>;
        setMessages(mergeMessages(fallbackMessages, localeMessages));
      })
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
    const root = document.documentElement.style;
    // Night vision always wins: the operator's accent is a bright hue that
    // would override the nvg theme's own accent (badges, chips, buttons) and
    // break dark adaptation. Drop the override while nvg is active; the
    // accent comes back when the theme changes.
    if (themeMode === "nvg") {
      for (const name of ACCENT_VARS) root.removeProperty(name);
      return;
    }
    const preset = ACCENT_PRESETS[accentColor] || ACCENT_PRESETS.blue;
    root.setProperty("--alt-accent-primary", preset.primary);
    root.setProperty("--alt-accent-primary-hover", preset.hover);
    root.setProperty("--alt-accent-secondary", preset.secondary);
  }, [accentColor, themeMode]);

  /* UTC is deterministic across server + client render boundaries, which
   * avoids the next-intl ENVIRONMENT_FALLBACK hydration crash. Times
   * displayed through next-intl formatters are UTC-based; use the host
   * browser timezone explicitly with `new Date().toLocaleString(...)` when
   * wall-clock display is required. */
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
