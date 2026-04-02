/**
 * @module i18n
 * @description Locale configuration for next-intl (client-side only, no path-prefix routing).
 * @license GPL-3.0-only
 */

export const locales = ['en', 'de', 'zh', 'fr', 'es', 'pt', 'ja', 'ko', 'id', 'hi', 'ta', 'kn', 'te', 'mr', 'pa', 'gu'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, { native: string; english: string; flag: string }> = {
  en: { native: 'English', english: 'English', flag: '🇺🇸' },
  de: { native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  zh: { native: '中文', english: 'Chinese', flag: '🇨🇳' },
  fr: { native: 'Français', english: 'French', flag: '🇫🇷' },
  es: { native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  pt: { native: 'Português', english: 'Portuguese', flag: '🇧🇷' },
  ja: { native: '日本語', english: 'Japanese', flag: '🇯🇵' },
  ko: { native: '한국어', english: 'Korean', flag: '🇰🇷' },
  id: { native: 'Bahasa Indonesia', english: 'Indonesian', flag: '🇮🇩' },
  hi: { native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  ta: { native: 'தமிழ்', english: 'Tamil', flag: '🇮🇳' },
  kn: { native: 'ಕನ್ನಡ', english: 'Kannada', flag: '🇮🇳' },
  te: { native: 'తెలుగు', english: 'Telugu', flag: '🇮🇳' },
  mr: { native: 'मराठी', english: 'Marathi', flag: '🇮🇳' },
  pa: { native: 'ਪੰਜਾਬੀ', english: 'Punjabi', flag: '🇮🇳' },
  gu: { native: 'ગુજરાતી', english: 'Gujarati', flag: '🇮🇳' },
};
