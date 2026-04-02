/**
 * @module i18n
 * @description Locale configuration for next-intl (client-side only, no path-prefix routing).
 * @license GPL-3.0-only
 */

export const locales = ['en', 'hi', 'gu', 'kn', 'mr', 'pa', 'ta', 'te', 'zh', 'fr', 'de', 'id', 'ja', 'ko', 'pt', 'es'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, { native: string; english: string; flag: string }> = {
  en: { native: 'English', english: 'English', flag: '🇺🇸' },
  hi: { native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  gu: { native: 'ગુજરાતી', english: 'Gujarati', flag: '🇮🇳' },
  kn: { native: 'ಕನ್ನಡ', english: 'Kannada', flag: '🇮🇳' },
  mr: { native: 'मराठी', english: 'Marathi', flag: '🇮🇳' },
  pa: { native: 'ਪੰਜਾਬੀ', english: 'Punjabi', flag: '🇮🇳' },
  ta: { native: 'தமிழ்', english: 'Tamil', flag: '🇮🇳' },
  te: { native: 'తెలుగు', english: 'Telugu', flag: '🇮🇳' },
  zh: { native: '中文', english: 'Chinese', flag: '🇨🇳' },
  fr: { native: 'Français', english: 'French', flag: '🇫🇷' },
  de: { native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  id: { native: 'Bahasa Indonesia', english: 'Indonesian', flag: '🇮🇩' },
  ja: { native: '日本語', english: 'Japanese', flag: '🇯🇵' },
  ko: { native: '한국어', english: 'Korean', flag: '🇰🇷' },
  pt: { native: 'Português', english: 'Portuguese', flag: '🇧🇷' },
  es: { native: 'Español', english: 'Spanish', flag: '🇪🇸' },
};
