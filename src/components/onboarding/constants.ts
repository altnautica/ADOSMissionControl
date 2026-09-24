/**
 * Static data and tunables for the WelcomeModal onboarding flow.
 *
 * Lives apart from WelcomeModal.tsx so theme/accent tables, jurisdiction
 * options, dock geometry, and version constants can be inspected,
 * extended, or unit-tested without dragging the entire 1300-LOC component
 * into a test file.
 *
 * @license GPL-3.0-only
 */

import type { ThemeMode, AccentColor } from "@/stores/settings-store";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";
import { locales } from "@/i18n";

export type ThemeGroup = "dark" | "light" | "mid";

export interface ThemeCardData {
  value: ThemeMode;
  label: string;
  group: ThemeGroup;
  colors: { bg: string; surface: string; accent: string; text: string; border: string };
}

export const THEME_CARDS: ThemeCardData[] = [
  // Core
  { value: "dark", label: "Dark", group: "dark", colors: { bg: "#000000", surface: "#0a0a0a", accent: "#3a82ff", text: "#fafafa", border: "#1a1a1a" } },
  { value: "light", label: "Light", group: "light", colors: { bg: "#f7f9fc", surface: "#eef2f8", accent: "#2f6feb", text: "#111827", border: "#d6dce8" } },
  // Solarized
  { value: "solarized-dark", label: "Solarized Dark", group: "dark", colors: { bg: "#002b36", surface: "#073642", accent: "#268bd2", text: "#eee8d5", border: "#073642" } },
  { value: "solarized-light", label: "Solarized Light", group: "light", colors: { bg: "#fdf6e3", surface: "#eee8d5", accent: "#268bd2", text: "#002b36", border: "#eee8d5" } },
  // Dark themes
  { value: "dracula", label: "Dracula", group: "dark", colors: { bg: "#282a36", surface: "#21222c", accent: "#bd93f9", text: "#f8f8f2", border: "#383a4a" } },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", group: "dark", colors: { bg: "#1e1e2e", surface: "#181825", accent: "#cba6f7", text: "#cdd6f4", border: "#313244" } },
  { value: "catppuccin-frappe", label: "Catppuccin Frappé", group: "dark", colors: { bg: "#303446", surface: "#292c3c", accent: "#ca9ee6", text: "#c6d0f5", border: "#414559" } },
  { value: "nord", label: "Nord", group: "dark", colors: { bg: "#2e3440", surface: "#3b4252", accent: "#88c0d0", text: "#eceff4", border: "#3b4252" } },
  { value: "gruvbox-dark", label: "Gruvbox Dark", group: "dark", colors: { bg: "#282828", surface: "#1d2021", accent: "#83a598", text: "#ebdbb2", border: "#3c3836" } },
  { value: "one-dark", label: "One Dark", group: "dark", colors: { bg: "#282c34", surface: "#21252b", accent: "#61afef", text: "#abb2bf", border: "#21252b" } },
  { value: "tokyo-night", label: "Tokyo Night", group: "dark", colors: { bg: "#1a1b26", surface: "#16161e", accent: "#7aa2f7", text: "#c0caf5", border: "#292e42" } },
  { value: "rose-pine", label: "Rosé Pine", group: "dark", colors: { bg: "#191724", surface: "#1f1d2e", accent: "#c4a7e7", text: "#e0def4", border: "#403d52" } },
  { value: "monokai", label: "Monokai", group: "dark", colors: { bg: "#272822", surface: "#1e1f1c", accent: "#a6e22e", text: "#f8f8f2", border: "#3e3d32" } },
  { value: "kanagawa", label: "Kanagawa", group: "dark", colors: { bg: "#1f1f28", surface: "#1a1a22", accent: "#7e9cd8", text: "#dcd7ba", border: "#363646" } },
  { value: "synthwave", label: "Synthwave '84", group: "dark", colors: { bg: "#262335", surface: "#241b2f", accent: "#ff7edb", text: "#ffffff", border: "#2a2139" } },
  { value: "github-dark", label: "GitHub Dark", group: "dark", colors: { bg: "#0d1117", surface: "#010409", accent: "#1f6feb", text: "#f0f6fc", border: "#2f3742" } },
  // Light themes
  { value: "catppuccin-latte", label: "Catppuccin Latte", group: "light", colors: { bg: "#eff1f5", surface: "#e6e9ef", accent: "#8839ef", text: "#4c4f69", border: "#ccd0da" } },
  { value: "gruvbox-light", label: "Gruvbox Light", group: "light", colors: { bg: "#fbf1c7", surface: "#f2e5bc", accent: "#076678", text: "#3c3836", border: "#ebdbb2" } },
  // Mid-tone
  { value: "ayu-dark", label: "Ayu Dark", group: "mid", colors: { bg: "#0b0e14", surface: "#0a0d13", accent: "#e6b450", text: "#bfbdb6", border: "#1c2028" } },
  { value: "ayu-mirage", label: "Ayu Mirage", group: "mid", colors: { bg: "#242936", surface: "#1a1f29", accent: "#ffcc66", text: "#cccac2", border: "#2a3040" } },
  { value: "everforest-dark", label: "Everforest", group: "mid", colors: { bg: "#2d353b", surface: "#232a2e", accent: "#a7c080", text: "#d3c6aa", border: "#475258" } },
];

export const ACCENT_COLORS: { value: AccentColor; hex: string }[] = [
  { value: "blue", hex: "#3a82ff" },
  { value: "green", hex: "#22c55e" },
  { value: "amber", hex: "#f59e0b" },
  { value: "red", hex: "#ef4444" },
  { value: "lime", hex: "#84cc16" },
  { value: "purple", hex: "#a855f7" },
  { value: "pink", hex: "#ec4899" },
  { value: "cyan", hex: "#06b6d4" },
  { value: "orange", hex: "#f97316" },
];

export const GROUP_TABS: { key: ThemeGroup | "all" }[] = [
  { key: "all" },
  { key: "dark" },
  { key: "light" },
  { key: "mid" },
];

export const ACCENT_BALL_SIZE = 28;
export const ACCENT_BALL_GAP = 8;
export const ACCENT_CAPSULE_PADDING = 8;
export const ACCENT_DOCK_MAX_SCALE = 1.30;
export const ACCENT_DOCK_RADIUS = ACCENT_BALL_SIZE * 1.4;

export const PRIMARY_CTA_CLASS =
  "h-10 px-8 bg-accent-primary text-accent-foreground text-sm font-semibold hover:brightness-110 transition-all rounded-sm";

export const GITHUB_RELEASES_URL =
  "https://github.com/altnautica/ADOSMissionControl/releases/latest";

/** Bump this when disclaimer content changes materially to force re-acceptance. */
export const DISCLAIMER_VERSION = 1;

export const JURISDICTION_OPTIONS: { value: Jurisdiction; label: string }[] = (
  Object.entries(JURISDICTIONS) as [Jurisdiction, (typeof JURISDICTIONS)[Jurisdiction]][]
).map(([key, cfg]) => ({
  value: key,
  label: `${cfg.flag}  ${cfg.name}`,
}));

export function detectBrowserLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language?.split("-")[0]?.toLowerCase() ?? "en";
  const supported = locales as readonly string[];
  return supported.includes(lang) ? lang : "en";
}
