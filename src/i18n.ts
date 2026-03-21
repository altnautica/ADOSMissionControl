/**
 * @module i18n
 * @description Locale configuration for next-intl (client-side only, no path-prefix routing).
 * @license GPL-3.0-only
 */

export const locales = ['en', 'de', 'zh', 'fr', 'es', 'hi', 'ta'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, { native: string; english: string; flag: string }> = {
  en: { native: 'English', english: 'English', flag: '🇺🇸' },
  de: { native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  zh: { native: '中文', english: 'Chinese', flag: '🇨🇳' },
  fr: { native: 'Français', english: 'French', flag: '🇫🇷' },
  es: { native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  hi: { native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  ta: { native: 'தமிழ்', english: 'Tamil', flag: '🇮🇳' },
};
