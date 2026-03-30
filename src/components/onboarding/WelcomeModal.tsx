/**
 * @module WelcomeModal
 * @description Full-screen multi-step onboarding flow. 5 steps: language -> welcome -> preferences -> theme -> ready.
 * Cannot be dismissed without completing. Step state is local (not persisted) -- closing mid-flow
 * restarts from Step 1, ensuring language selection always runs.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { useGcsLocationStore, type GeoPermission } from "@/stores/gcs-location-store";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";
import { Select } from "@/components/ui/select";
import { locales, localeNames } from "@/i18n";
import type { UnitSystem, ThemeMode, AccentColor } from "@/stores/settings-store";

const JURISDICTION_OPTIONS: { value: Jurisdiction; label: string }[] = (
  Object.entries(JURISDICTIONS) as [Jurisdiction, (typeof JURISDICTIONS)[Jurisdiction]][]
).map(([key, cfg]) => ({
  value: key,
  label: `${cfg.flag}  ${cfg.name}`,
}));

// ── Theme card data (colors extracted from globals.css) ──

type ThemeGroup = "dark" | "light" | "mid";

interface ThemeCardData {
  value: ThemeMode;
  label: string;
  group: ThemeGroup;
  colors: { bg: string; surface: string; accent: string; text: string; border: string };
}

const THEME_CARDS: ThemeCardData[] = [
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

const ACCENT_COLORS: { label: string; value: AccentColor; hex: string }[] = [
  { label: "Blue", value: "blue", hex: "#3a82ff" },
  { label: "Green", value: "green", hex: "#22c55e" },
  { label: "Amber", value: "amber", hex: "#f59e0b" },
  { label: "Red", value: "red", hex: "#ef4444" },
  { label: "Lime", value: "lime", hex: "#84cc16" },
  { label: "Purple", value: "purple", hex: "#a855f7" },
  { label: "Pink", value: "pink", hex: "#ec4899" },
  { label: "Cyan", value: "cyan", hex: "#06b6d4" },
  { label: "Orange", value: "orange", hex: "#f97316" },
];

const GROUP_TABS: { key: ThemeGroup | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "mid", label: "Mid-tone" },
];

type Step = 0 | 1 | 2 | 3 | 4;

function detectBrowserLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language?.split("-")[0]?.toLowerCase() ?? "en";
  const supported = locales as readonly string[];
  return supported.includes(lang) ? lang : "en";
}

// Toggle component (reused across steps)
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-accent-primary" : "bg-bg-tertiary"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// Step indicator dots
function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex gap-2 justify-center mt-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full transition-colors duration-300 ${
            i <= step ? "bg-accent-primary" : "bg-bg-tertiary"
          }`}
        />
      ))}
    </div>
  );
}

// Self-themed card component
function ThemeCard({
  theme,
  isSelected,
  onClick,
}: {
  theme: ThemeCardData;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { colors, label } = theme;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-lg transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none"
      style={{
        backgroundColor: colors.bg,
        border: isSelected ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
        padding: isSelected ? "11px" : "12px",
      }}
    >
      {/* Color swatches */}
      <div className="flex gap-1.5 mb-3">
        {[colors.bg, colors.surface, colors.accent, colors.text, colors.border].map((c, i) => (
          <span
            key={i}
            className="w-4 h-4 rounded-full border border-white/10"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Mini mockup: simulated UI bars */}
      <div className="rounded overflow-hidden mb-3" style={{ backgroundColor: colors.surface, height: 48 }}>
        {/* Top bar */}
        <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: `1px solid ${colors.border}` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.accent }} />
          <span className="w-8 h-1 rounded-full opacity-60" style={{ backgroundColor: colors.text }} />
          <span className="w-5 h-1 rounded-full opacity-30 ml-auto" style={{ backgroundColor: colors.text }} />
        </div>
        {/* Content lines */}
        <div className="flex gap-1 px-2 py-1.5">
          <div className="w-6 h-full rounded-sm opacity-20" style={{ backgroundColor: colors.border, minHeight: 20 }} />
          <div className="flex-1 flex flex-col gap-1 pt-0.5">
            <span className="w-3/4 h-1 rounded-full opacity-40" style={{ backgroundColor: colors.text }} />
            <span className="w-1/2 h-1 rounded-full opacity-25" style={{ backgroundColor: colors.text }} />
          </div>
        </div>
      </div>

      {/* Accent bar */}
      <div className="h-0.5 rounded-full mb-2" style={{ backgroundColor: colors.accent }} />

      {/* Theme name */}
      <span className="text-xs font-medium block text-left" style={{ color: colors.text }}>
        {label}
      </span>

      {/* Selected checkmark */}
      {isSelected && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: colors.accent }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.bg} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>
      )}
    </button>
  );
}

export function WelcomeModal() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const setJurisdiction = useSettingsStore((s) => s.setJurisdiction);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const setDemoMode = useSettingsStore((s) => s.setDemoMode);
  const setAudioEnabled = useSettingsStore((s) => s.setAudioEnabled);
  const setLocationEnabled = useSettingsStore((s) => s.setLocationEnabled);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const currentLocale = useSettingsStore((s) => s.locale);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const requestPermission = useGcsLocationStore((s) => s.requestPermission);
  const isSupported = useGcsLocationStore((s) => s.isSupported);

  const t = useTranslations("welcome");
  const tCommon = useTranslations("common");

  // Step state (not persisted -- always starts from 0 if modal shows)
  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Step 1: selected locale
  const [selectedLocale, setSelectedLocale] = useState<string>(() => detectBrowserLocale());

  // Step 3: preferences
  const [jurisdiction, setLocalJurisdiction] = useState<Jurisdiction | "">("");
  const [units, setLocalUnits] = useState<UnitSystem>("metric");
  const [demoMode, setLocalDemoMode] = useState(true);
  const [audioEnabled, setLocalAudioEnabled] = useState(false);
  const [locationEnabled, setLocalLocationEnabled] = useState(true);
  const [locationPermission, setLocationPermission] = useState<GeoPermission>("prompt");
  const [locationChecking, setLocationChecking] = useState(false);

  // Step 4: theme selection
  const [activeGroup, setActiveGroup] = useState<ThemeGroup | "all">("all");

  // Auto-request location permission on mount
  useEffect(() => {
    if (!isSupported) {
      setLocalLocationEnabled(false);
      return;
    }
    let cancelled = false;
    setLocationChecking(true);
    requestPermission().then((perm) => {
      if (cancelled) return;
      setLocationChecking(false);
      setLocationPermission(perm);
      setLocalLocationEnabled(perm === "granted");
    });
    return () => { cancelled = true; };
  }, [isSupported, requestPermission]);

  // Auto-set units when jurisdiction changes
  useEffect(() => {
    if (jurisdiction) {
      setLocalUnits(JURISDICTIONS[jurisdiction].defaultUnits);
    }
  }, [jurisdiction]);

  if (!hasHydrated || onboarded) return null;

  const advance = (n: Step) => {
    setDirection("forward");
    setStep(n);
  };

  const back = (n: Step) => {
    setDirection("back");
    setStep(n);
  };

  const handleLocationToggle = async () => {
    if (locationEnabled) {
      setLocalLocationEnabled(false);
      setLocationPermission("prompt");
      return;
    }
    setLocationChecking(true);
    const perm = await requestPermission();
    setLocationChecking(false);
    setLocationPermission(perm);
    if (perm === "granted") setLocalLocationEnabled(true);
  };

  const handleGetStarted = () => {
    if (jurisdiction) setJurisdiction(jurisdiction);
    setUnits(units);
    setDemoMode(demoMode);
    setAudioEnabled(audioEnabled);
    setLocationEnabled(locationEnabled);
    setOnboarded(true);
  };

  const filteredThemes = activeGroup === "all"
    ? THEME_CARDS
    : THEME_CARDS.filter((t) => t.group === activeGroup);

  // Step positions: current = center (0), before = left (-100%), after = right (100%)
  const stepX = (i: number): string => {
    if (i === step) return "translate-x-0";
    if (i < step) return direction === "forward" ? "-translate-x-full" : "translate-x-full";
    return direction === "forward" ? "translate-x-full" : "-translate-x-full";
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-bg-primary overflow-hidden transition-colors duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome setup"
    >
      <div className="relative w-full h-full">

        {/* -- STEP 0: Language Selection -- */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center p-8 transition-transform duration-300 ease-in-out ${stepX(0)}`}
        >
          {/* Brand header */}
          <div className="text-center mb-10">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.25em] text-accent-primary">ADOS</p>
            <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-medium mt-0.5">Mission Control</p>
          </div>

          <h2 className="text-xl font-display font-semibold text-text-primary mb-8 text-center">
            {t("language.title")}
          </h2>

          {/* Language grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-md mb-10">
            {(locales as readonly string[]).map((code) => {
              const info = localeNames[code as keyof typeof localeNames];
              const isSelected = selectedLocale === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setSelectedLocale(code);
                    setLocale(code);
                  }}
                  className={`flex flex-col items-center gap-1 p-4 border rounded-sm transition-all ${
                    isSelected
                      ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                      : "border-border-default bg-bg-secondary text-text-secondary hover:border-accent-primary/50"
                  }`}
                >
                  <span className="text-2xl">{info.flag}</span>
                  <span className="text-sm font-medium">{info.native}</span>
                  <span className="text-[10px] text-text-tertiary">{info.english}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => advance(1)}
            className="h-10 px-8 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm"
          >
            {t("language.continue")} →
          </button>

          <StepDots step={step} />
        </div>

        {/* -- STEP 1: Welcome / Brand Moment -- */}
        <div
          className={`absolute inset-0 flex flex-col md:flex-row transition-transform duration-300 ease-in-out ${stepX(1)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(0)}
            className="absolute top-6 left-6 text-xs text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1"
          >
            ← {tCommon("back")}
          </button>

          {/* Left: brand lockup */}
          <div className="flex-none md:w-2/5 flex flex-col items-center justify-center p-12 md:p-16 border-b md:border-b-0 md:border-e border-border-default">
            <div className="text-center">
              <p className="font-display text-5xl md:text-7xl font-bold text-accent-primary leading-none">ADOS</p>
              <p className="font-display text-xl md:text-2xl font-semibold text-text-primary mt-2">Mission</p>
              <p className="font-display text-xl md:text-2xl font-semibold text-text-primary">Control</p>
              <div className="mt-6 w-16 h-px bg-accent-primary mx-auto opacity-50" />
            </div>
          </div>

          {/* Right: copy */}
          <div className="flex-1 flex flex-col justify-center p-8 md:p-16">
            <p className="text-lg font-semibold text-text-primary leading-snug mb-4">
              {t("intro.tagline")}
            </p>
            <p className="text-sm text-text-secondary leading-relaxed mb-8">
              {t("intro.description")}
            </p>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-8">
              <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
                {t("intro.openBeta")}
              </span>
              <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
                {t("intro.freeForever")}
              </span>
              <span className="px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary border border-border-default rounded-full">
                {t("intro.openSource")}
              </span>
            </div>

            {/* Privacy promise */}
            <p className="text-xs text-text-tertiary flex items-center gap-1.5 mb-8">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span><strong className="text-text-secondary">{t("intro.privacy")}</strong> {t("intro.privacyDetail")}</span>
            </p>

            <button
              type="button"
              onClick={() => advance(2)}
              className="self-start h-10 px-8 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm"
            >
              {t("intro.getStarted")} →
            </button>

            <StepDots step={step} />
          </div>
        </div>

        {/* -- STEP 2: Preferences -- */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center p-8 transition-transform duration-300 ease-in-out ${stepX(2)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(1)}
            className="absolute top-6 left-6 text-xs text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1"
          >
            ← {tCommon("back")}
          </button>

          <div className="w-full max-w-lg">
            <h2 className="text-xl font-display font-semibold text-text-primary mb-6 text-center">
              {t("preferences.title")}
            </h2>

            <div className="space-y-4">
              {/* Jurisdiction */}
              <div>
                <Select
                  label={t("preferences.jurisdiction")}
                  value={jurisdiction}
                  onChange={(v) => setLocalJurisdiction(v as Jurisdiction | "")}
                  placeholder={`${t("preferences.jurisdictionOptional")}`}
                  options={JURISDICTION_OPTIONS}
                />
              </div>

              {/* Units */}
              <div>
                <Select
                  label={t("preferences.units")}
                  value={units}
                  onChange={(v) => setLocalUnits(v as UnitSystem)}
                  options={[
                    { value: "metric", label: t("preferences.metric") },
                    { value: "imperial", label: t("preferences.imperial") },
                  ]}
                />
              </div>

              {/* Demo mode */}
              <div className="flex items-center justify-between pt-3 border-t border-border-default">
                <div>
                  <span className="text-sm text-text-primary">{t("preferences.demoMode")}</span>
                  <p className="text-[10px] text-text-tertiary mt-0.5">{t("preferences.demoModeDescription")}</p>
                </div>
                <Toggle checked={demoMode} onChange={() => setLocalDemoMode(!demoMode)} />
              </div>

              {/* Audio */}
              <div className="flex items-center justify-between pt-3 border-t border-border-default">
                <div>
                  <span className="text-sm text-text-primary">{t("preferences.audioAlerts")}</span>
                  <p className="text-[10px] text-text-tertiary mt-0.5">{t("preferences.audioAlertsDescription")}</p>
                </div>
                <Toggle checked={audioEnabled} onChange={() => setLocalAudioEnabled(!audioEnabled)} />
              </div>

              {/* Location */}
              <div className="flex items-center justify-between pt-3 border-t border-border-default">
                <div className="pe-4">
                  <span className="text-sm text-text-primary">{t("preferences.yourPosition")}</span>
                  <p className="text-[10px] text-text-tertiary mt-0.5">{t("preferences.yourPositionDescription")}</p>
                  {locationPermission === "granted" && locationEnabled && (
                    <p className="text-[10px] text-status-success mt-0.5">{t("preferences.locationGranted")}</p>
                  )}
                  {locationPermission === "denied" && (
                    <p className="text-[10px] text-status-warning mt-0.5">{t("preferences.locationDenied")}</p>
                  )}
                </div>
                <Toggle
                  checked={locationEnabled}
                  onChange={handleLocationToggle}
                  disabled={locationChecking || !isSupported}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => advance(3)}
              className="w-full mt-8 h-10 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm"
            >
              {tCommon("continue")} →
            </button>

            <StepDots step={step} />
          </div>
        </div>

        {/* -- STEP 3: Theme Selection -- */}
        <div
          className={`absolute inset-0 flex flex-col items-center p-8 pt-16 transition-transform duration-300 ease-in-out overflow-y-auto ${stepX(3)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(2)}
            className="absolute top-6 left-6 text-xs text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1"
          >
            ← {tCommon("back")}
          </button>

          <div className="w-full max-w-2xl">
            <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
              Choose your theme
            </h2>
            <p className="text-xs text-text-tertiary mb-6 text-center">
              You can change this anytime in settings
            </p>

            {/* Group filter tabs */}
            <div className="flex gap-1.5 justify-center mb-6">
              {GROUP_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveGroup(tab.key)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    activeGroup === tab.key
                      ? "bg-accent-primary text-black"
                      : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Theme card grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
              {filteredThemes.map((theme, idx) => (
                <div
                  key={theme.value}
                  className="animate-in fade-in"
                  style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "both" }}
                >
                  <ThemeCard
                    theme={theme}
                    isSelected={themeMode === theme.value}
                    onClick={() => setThemeMode(theme.value)}
                  />
                </div>
              ))}
            </div>

            {/* Accent color */}
            <div className="border-t border-border-default pt-4 mb-6">
              <p className="text-sm text-text-primary font-medium mb-3 text-center">Accent color</p>
              <div className="flex gap-2 justify-center">
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setAccentColor(color.value)}
                    title={color.label}
                    className={`w-7 h-7 rounded-full transition-all ${
                      accentColor === color.value
                        ? "scale-110"
                        : "hover:scale-110"
                    }`}
                    style={{
                      backgroundColor: color.hex,
                      boxShadow: accentColor === color.value
                        ? `0 0 0 2px var(--alt-bg-primary), 0 0 0 4px ${color.hex}`
                        : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => advance(4)}
              className="w-full h-10 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm"
            >
              {tCommon("continue")} →
            </button>

            <StepDots step={step} />
          </div>
        </div>

        {/* -- STEP 4: Ready -- */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center p-8 transition-transform duration-300 ease-in-out ${stepX(4)}`}
        >
          <div className="text-center max-w-sm">
            {/* Check mark */}
            <div className="w-16 h-16 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center mx-auto mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
            </div>

            <h2 className="text-2xl font-display font-semibold text-text-primary mb-8">
              {t("ready.title")}
            </h2>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={handleGetStarted}
              className="w-full h-11 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm mb-6"
            >
              {t("ready.openApp")}
            </button>

            {/* Secondary links */}
            <div className="flex flex-col gap-2">
              <a
                href="https://discord.gg/uxbvuD4d5q"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 text-xs text-text-tertiary hover:text-accent-primary transition-colors"
              >
                {/* Discord icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/>
                </svg>
                {t("ready.joinDiscord")}
              </a>
              <a
                href="https://github.com/altnautica/ADOSMissionControl"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 text-xs text-text-tertiary hover:text-accent-primary transition-colors"
              >
                {/* GitHub icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {t("ready.starGitHub")}
              </a>
            </div>

            <StepDots step={step} />
          </div>
        </div>

      </div>
    </div>
  );
}
