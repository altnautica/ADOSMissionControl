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

type AccentPair = { primary: string; hover: string };

/** Dark-theme presets, plus a darker `light` pair per hue that keeps white
 *  text on an accent fill at 4.5:1 or better on the light theme. */
const ACCENT_PRESETS: Record<string, AccentPair & { light: AccentPair }> = {
  blue: { primary: "#3a82ff", hover: "#5b9aff", light: { primary: "#2563eb", hover: "#1d4ed8" } },
  green: { primary: "#22c55e", hover: "#34d06d", light: { primary: "#15803d", hover: "#166534" } },
  amber: { primary: "#f59e0b", hover: "#f7b13a", light: { primary: "#b45309", hover: "#92400e" } },
  red: { primary: "#ef4444", hover: "#f16363", light: { primary: "#dc2626", hover: "#b91c1c" } },
  lime: { primary: "#84cc16", hover: "#9bdf2a", light: { primary: "#4d7c0f", hover: "#3f6212" } },
  purple: { primary: "#a855f7", hover: "#b975f9", light: { primary: "#9333ea", hover: "#7e22ce" } },
  pink: { primary: "#ec4899", hover: "#f06dae", light: { primary: "#be185d", hover: "#9d174d" } },
  cyan: { primary: "#06b6d4", hover: "#22d3ee", light: { primary: "#0e7490", hover: "#155e75" } },
  orange: { primary: "#f97316", hover: "#fb923c", light: { primary: "#c2410c", hover: "#9a3412" } },
};

/** The theme actually applied to the document, which a kiosk or another
 *  surface may set directly on `<html data-theme>`. */
function useAppliedTheme(fallback: string): string {
  const [applied, setApplied] = useState(fallback);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const read = () => setApplied(root.getAttribute("data-theme") || fallback);
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [fallback]);
  return applied;
}

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
] as const;

type Messages = Record<string, unknown>;
type LocaleImporter = (locale: string) => Promise<{ default: unknown }>;

const EN_MESSAGES = enMessages as Messages;

const importLocaleBundle: LocaleImporter = (locale) =>
  import(`../../../locales/${locale}.json`);

/**
 * Resolve the message bundle for a locale. English is already in the static
 * import, so it never triggers a dynamic import or a merge; any other locale
 * loads its bundle and falls back to English for missing keys (or entirely,
 * if the bundle fails to load).
 */
export async function loadLocaleMessages(
  locale: string,
  importLocale: LocaleImporter = importLocaleBundle,
): Promise<Messages> {
  if (locale === "en") return EN_MESSAGES;
  try {
    const m = await importLocale(locale);
    return mergeMessages(EN_MESSAGES, m.default as Messages);
  } catch {
    return EN_MESSAGES;
  }
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const locale = useSettingsStore((s) => s.locale);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const [messages, setMessages] = useState<Messages>(EN_MESSAGES);

  useEffect(() => {
    let cancelled = false;
    loadLocaleMessages(locale).then((m) => {
      if (!cancelled) setMessages(m);
    });
    return () => {
      cancelled = true;
    };
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

  const appliedTheme = useAppliedTheme(themeMode || "dark");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement.style;
    // Night vision always wins: the operator's accent is a bright hue that
    // would override the nvg theme's own accent (badges, chips, buttons) and
    // break dark adaptation. Keyed on the theme applied to the document, so
    // nvg set directly on `<html>` drops the override too.
    if (appliedTheme === "nvg") {
      for (const name of ACCENT_VARS) root.removeProperty(name);
      return;
    }
    const preset = ACCENT_PRESETS[accentColor] || ACCENT_PRESETS.blue;
    const pair = appliedTheme === "light" ? preset.light : preset;
    root.setProperty("--alt-accent-primary", pair.primary);
    root.setProperty("--alt-accent-primary-hover", pair.hover);
  }, [accentColor, appliedTheme]);

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
