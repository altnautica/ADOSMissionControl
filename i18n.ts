/**
 * @module i18n
 * @description Locale configuration for next-intl (client-side only, no path-prefix routing).
 * @license GPL-3.0-only
 */

export const locales = ['zh', 'en', 'fr', 'de', 'gu', 'hi', 'id', 'ja', 'kn', 'ko', 'mr', 'pt', 'pa', 'es', 'ta', 'te'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, { native: string; english: string; flag: string }> = {
  zh: { native: '中文', english: 'Chinese', flag: '🇨🇳' },
  en: { native: 'English', english: 'English', flag: '🇺🇸' },
  fr: { native: 'Français', english: 'French', flag: '🇫🇷' },
  de: { native: 'Deutsch', english: 'German', flag: '🇩🇪' },
  gu: { native: 'ગુજરાતી', english: 'Gujarati', flag: '🇮🇳' },
  hi: { native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  id: { native: 'Bahasa Indonesia', english: 'Indonesian', flag: '🇮🇩' },
  ja: { native: '日本語', english: 'Japanese', flag: '🇯🇵' },
  kn: { native: 'ಕನ್ನಡ', english: 'Kannada', flag: '🇮🇳' },
  ko: { native: '한국어', english: 'Korean', flag: '🇰🇷' },
  mr: { native: 'मराठी', english: 'Marathi', flag: '🇮🇳' },
  pt: { native: 'Português', english: 'Portuguese', flag: '🇧🇷' },
  pa: { native: 'ਪੰਜਾਬੀ', english: 'Punjabi', flag: '🇮🇳' },
  es: { native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  ta: { native: 'தமிழ்', english: 'Tamil', flag: '🇮🇳' },
  te: { native: 'తెలుగు', english: 'Telugu', flag: '🇮🇳' },
};
