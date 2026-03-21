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

interface LocaleProviderProps {
  children: React.ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const locale = useSettingsStore((s) => s.locale);
  const [messages, setMessages] = useState<Record<string, unknown>>({});

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

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
