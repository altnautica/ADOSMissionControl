/**
 * @module WelcomeModal
 * @description Full-screen multi-step onboarding flow. 7 steps: language -> welcome -> disclaimer -> preferences -> theme -> download -> ready. Download step skipped in Electron.
 * Cannot be dismissed without completing. Step state is local (not persisted) -- closing mid-flow
 * restarts from Step 1, ensuring language selection always runs.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Shield, Swords, Plane, PackageCheck, AlertTriangle, Scale, Monitor } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { isElectron } from "@/lib/utils";
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

const ACCENT_COLORS: { value: AccentColor; hex: string }[] = [
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

const GROUP_TABS: { key: ThemeGroup | "all" }[] = [
  { key: "all" },
  { key: "dark" },
  { key: "light" },
  { key: "mid" },
];

const ACCENT_BALL_SIZE = 28;
const ACCENT_BALL_GAP = 8;
const ACCENT_CAPSULE_PADDING = 8;
const ACCENT_DOCK_MAX_SCALE = 1.30;
const ACCENT_DOCK_RADIUS = ACCENT_BALL_SIZE * 1.4;
const PRIMARY_CTA_CLASS = "h-10 px-8 bg-accent-primary text-black text-sm font-semibold hover:brightness-110 transition-all rounded-sm";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const GITHUB_RELEASES_URL = "https://github.com/altnautica/ADOSMissionControl/releases/latest";

/** Bump this when disclaimer content changes materially to force re-acceptance. */
const DISCLAIMER_VERSION = 1;

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
function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-2 justify-center mt-8">
      {Array.from({ length: total }, (_, i) => (
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

function ThemeMiniTile({
  theme,
  onClick,
}: {
  theme: ThemeCardData;
  onClick: () => void;
}) {
  const t = useTranslations("welcome.theme");
  const { colors, label } = theme;
  const accentColor = useSettingsStore((s) => s.accentColor);
  const accentHex = ACCENT_COLORS.find((c) => c.value === accentColor)?.hex ?? colors.accent;

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border p-2 text-left transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-1"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        boxShadow: `0 0 0 1px ${colors.border}, 0 0 0 2px ${accentHex}22`,
      }}
      aria-label={t("useAsPreviewAria", { name: label })}
    >
      <div className="flex items-center gap-1 mb-1.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accentHex }} />
        <span className="w-4 h-1 rounded-full opacity-60" style={{ backgroundColor: colors.text }} />
      </div>
      <div className="h-0.5 rounded-full mb-1.5" style={{ backgroundColor: accentHex }} />
      <span className="block text-[10px] leading-tight truncate" style={{ color: colors.text }}>
        {label}
      </span>
    </button>
  );
}

function ThemeWorkspacePreview({ theme }: { theme: ThemeCardData }) {
  const t = useTranslations("welcome.theme");
  const tNav = useTranslations("nav");
  const tStatus = useTranslations("status");
  const { colors, label } = theme;
  const accentColor = useSettingsStore((s) => s.accentColor);
  const accentHex = ACCENT_COLORS.find((c) => c.value === accentColor)?.hex ?? colors.accent;

  const navItems = [
    tNav("dashboard"),
    t("workspace.menu.flight"),
    tNav("plan"),
    tNav("configure"),
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
      aria-label={`${label} full preview`}
    >
      <div
        className="h-10 px-3 flex items-center gap-2"
        style={{
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accentHex }} />
        <span className="text-xs font-semibold" style={{ color: colors.text }}>Mission Control</span>
        <span className="ml-auto text-[10px] opacity-70" style={{ color: colors.text }}>{tStatus("connected")}</span>
      </div>

      <div className="grid grid-cols-[88px_1fr] min-h-[220px]">
        <aside
          className="p-2.5 space-y-1.5"
          style={{
            backgroundColor: colors.surface,
            borderRight: `1px solid ${colors.border}`,
          }}
        >
          {navItems.map((item, idx) => (
            <div
              key={item}
              className="rounded px-2 py-1 text-[10px] truncate"
              style={{
                color: colors.text,
                backgroundColor: idx === 1 ? accentHex : `${colors.border}55`,
                opacity: idx === 1 ? 1 : 0.85,
              }}
            >
              {item}
            </div>
          ))}
        </aside>

        <main className="p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold" style={{ color: colors.text }}>{t("workspace.flightOverview")}</h4>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                color: colors.bg,
                backgroundColor: accentHex,
              }}
            >
              {t("workspace.live")}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              [t("workspace.telemetry.alt"), "42m"],
              [t("workspace.telemetry.speed"), "11m/s"],
              ["RSSI", "97%"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded p-2"
                style={{
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <p className="text-[9px] opacity-70" style={{ color: colors.text }}>{k}</p>
                <p className="text-[11px] font-semibold" style={{ color: colors.text }}>{v}</p>
              </div>
            ))}
          </div>

          <div
            className="rounded p-2.5 mb-3"
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
            }}
          >
            <p className="text-[10px] mb-1" style={{ color: colors.text }}>{t("workspace.missionStatus")}</p>
            <p className="text-[9px] opacity-75" style={{ color: colors.text }}>
              {t("workspace.missionStatusSample")}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="h-7 px-2.5 rounded text-[10px] font-semibold"
              style={{
                backgroundColor: accentHex,
                color: colors.bg,
              }}
            >
              {t("workspace.armVehicle")}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="h-7 px-2.5 rounded text-[10px]"
              style={{
                backgroundColor: colors.surface,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
            >
              {t("workspace.openPlanner")}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export function WelcomeModal() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const setDisclaimerAccepted = useSettingsStore((s) => s.setDisclaimerAccepted);
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
  const tTheme = useTranslations("welcome.theme");
  const tCommon = useTranslations("common");

  // Step state (not persisted -- always starts from 0 if modal shows)
  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Step 1: selected locale
  const [selectedLocale, setSelectedLocale] = useState<string>(() => detectBrowserLocale());

  // Step 2: disclaimer acceptance
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);

  // Step 3: preferences
  const [jurisdiction, setLocalJurisdiction] = useState<Jurisdiction | "">("");
  const [units, setLocalUnits] = useState<UnitSystem>("metric");
  const [demoMode, setLocalDemoMode] = useState(true);
  const [audioEnabled, setLocalAudioEnabled] = useState(false);
  const [locationEnabled, setLocalLocationEnabled] = useState(() => isSupported);
  const [locationPermission, setLocationPermission] = useState<GeoPermission>("prompt");
  const [locationChecking, setLocationChecking] = useState(() => isSupported);
  const [hoveredAccentColor, setHoveredAccentColor] = useState<AccentColor | null>(null);
  const [accentPointerX, setAccentPointerX] = useState<number | null>(null);
  const [activeGroup, setActiveGroup] = useState<ThemeGroup | "all">("all");

  // Step 4: theme selection
  const [themeOrder, setThemeOrder] = useState<ThemeMode[]>(() => {
    const values = THEME_CARDS.map((theme) => theme.value);
    if (!values.includes(themeMode)) return values;
    return [themeMode, ...values.filter((value) => value !== themeMode)];
  });

  // Auto-request location permission on mount
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    requestPermission().then((perm) => {
      if (cancelled) return;
      setLocationChecking(false);
      setLocationPermission(perm);
      setLocalLocationEnabled(perm === "granted");
    });
    return () => { cancelled = true; };
  }, [isSupported, requestPermission]);

  // Desktop download step is skipped when already running in Electron
  const skipDownloadStep = isElectron();
  const totalSteps = skipDownloadStep ? 6 : 7;
  const afterTheme: Step = skipDownloadStep ? 6 : 5;
  const beforeReady: Step = skipDownloadStep ? 4 : 5;
  // Remap step index for StepDots when download step is skipped
  const dotStep = skipDownloadStep && step > 5 ? step - 1 : step;

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

  const orderedThemes = themeOrder
    .map((value) => THEME_CARDS.find((theme) => theme.value === value))
    .filter((theme): theme is ThemeCardData => Boolean(theme));
  const previewTheme = orderedThemes[0] ?? THEME_CARDS[0];
  const selectableThemes = orderedThemes
    .slice(1)
    .filter((theme) => activeGroup === "all" || theme.group === activeGroup)
    .slice(0, 20);
  const accentFocusColor = hoveredAccentColor ?? accentColor;
  const accentFocusIndex = Math.max(
    0,
    ACCENT_COLORS.findIndex((color) => color.value === accentFocusColor),
  );
  const accentFocusHex = ACCENT_COLORS[accentFocusIndex]?.hex ?? ACCENT_COLORS[0].hex;
  const accentCapsuleBackground = `linear-gradient(135deg, ${previewTheme.colors.surface} 0%, ${previewTheme.colors.bg} 52%, ${accentFocusHex}24 100%)`;
  const accentCapsuleBorder = `${previewTheme.colors.border}`;
  const accentCapsuleShadow = `inset 0 1px 0 ${previewTheme.colors.text}12, inset 0 -1px 0 ${previewTheme.colors.bg}66, 0 12px 28px ${previewTheme.colors.bg}55`;

  const accentColorLabels: Record<AccentColor, string> = {
    blue: tTheme("accentColors.blue"),
    green: tTheme("accentColors.green"),
    amber: tTheme("accentColors.amber"),
    red: tTheme("accentColors.red"),
    lime: tTheme("accentColors.lime"),
    purple: tTheme("accentColors.purple"),
    pink: tTheme("accentColors.pink"),
    cyan: tTheme("accentColors.cyan"),
    orange: tTheme("accentColors.orange"),
  };

  const groupTabLabels: Record<ThemeGroup | "all", string> = {
    all: tTheme("groupTabs.all"),
    dark: tTheme("groupTabs.dark"),
    light: tTheme("groupTabs.light"),
    mid: tTheme("groupTabs.mid"),
  };

  const getAccentDockScale = (index: number, colorValue: AccentColor): number => {
    const selectedBoost = accentColor === colorValue ? 1.06 : 1;
    if (accentPointerX === null) return selectedBoost;

    const centerX = ACCENT_CAPSULE_PADDING + (ACCENT_BALL_SIZE / 2) + (index * (ACCENT_BALL_SIZE + ACCENT_BALL_GAP));
    const distance = Math.abs(accentPointerX - centerX);
    if (distance >= ACCENT_DOCK_RADIUS) return selectedBoost;

    const t = 1 - (distance / ACCENT_DOCK_RADIUS);
    const eased = t * t * (3 - (2 * t));
    const dockScale = 1 + (eased * (ACCENT_DOCK_MAX_SCALE - 1));
    return Math.max(selectedBoost, dockScale);
  };

  const handleThemeTileClick = (themeValue: ThemeMode): void => {
    setThemeOrder((previous) => {
      const clickedIndex = previous.indexOf(themeValue);
      if (clickedIndex <= 0) return previous;

      const next = [...previous];
      const previousPreview = next[0];
      next[0] = themeValue;
      next[clickedIndex] = previousPreview;
      return next;
    });
    setThemeMode(themeValue);
  };

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
          className={`absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out ${stepX(0)}`}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 w-full max-w-xl mb-8 sm:mb-10">
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
            className={PRIMARY_CTA_CLASS}
          >
            {t("language.continue")} →
          </button>

          <StepDots step={dotStep} total={totalSteps} />
        </div>

        {/* -- STEP 1: Welcome / Brand Moment -- */}
        <div
          className={`absolute inset-0 flex flex-col md:flex-row overflow-y-auto transition-transform duration-300 ease-in-out ${stepX(1)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(0)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
          >
            ← {tCommon("back")}
          </button>

          {/* Left: brand lockup */}
          <div className="flex-none md:w-2/5 flex flex-col items-center justify-center p-8 pt-14 sm:p-10 md:p-16 border-b md:border-b-0 md:border-e border-border-default">
            <div className="text-center">
              <p className="font-display text-4xl sm:text-5xl md:text-7xl font-bold text-accent-primary leading-none">ADOS</p>
              <p className="font-display text-lg sm:text-xl md:text-2xl font-semibold text-text-primary mt-2">Mission</p>
              <p className="font-display text-lg sm:text-xl md:text-2xl font-semibold text-text-primary">Control</p>
              <div className="mt-4 sm:mt-6 w-16 h-px bg-accent-primary mx-auto opacity-50" />
            </div>
          </div>

          {/* Right: copy */}
          <div className="flex-1 flex flex-col justify-center p-6 sm:p-10 md:p-16 overflow-y-auto">
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
              className={`${PRIMARY_CTA_CLASS} self-start`}
            >
              {t("intro.getStarted")} →
            </button>

            <StepDots step={dotStep} total={totalSteps} />
          </div>
        </div>

        {/* -- STEP 2: Legal Disclaimer -- */}
        <div
          className={`absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out ${stepX(2)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(1)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
          >
            ← {tCommon("back")}
          </button>

          <div className="w-full max-w-2xl">
            <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
              {t("disclaimer.title")}
            </h2>
            <p className="text-xs text-text-tertiary mb-6 text-center">
              {t("disclaimer.subtitle")}
            </p>

            {/* Scrollable disclaimer sections */}
            <div className="[max-height:60dvh] overflow-y-auto border border-border-default rounded-sm bg-bg-secondary p-4 space-y-4 mb-6 overscroll-contain">
              {/* 1. Lawful Use */}
              <div className="flex gap-3">
                <Shield size={16} className="text-accent-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.lawfulUse.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.lawfulUse.body")}</p>
                </div>
              </div>

              <div className="border-t border-border-default" />

              {/* 2. No Unauthorized Military Use */}
              <div className="flex gap-3">
                <Swords size={16} className="text-accent-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.militaryUse.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.militaryUse.body")}</p>
                </div>
              </div>

              <div className="border-t border-border-default" />

              {/* 3. Aviation Regulations */}
              <div className="flex gap-3">
                <Plane size={16} className="text-accent-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.aviationRegs.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-2">{t("disclaimer.aviationRegs.body")}</p>
                  <ul className="list-disc list-inside text-xs text-text-secondary leading-relaxed space-y-1 mb-2">
                    <li>{t("disclaimer.aviationRegs.item1")}</li>
                    <li>{t("disclaimer.aviationRegs.item2")}</li>
                    <li>{t("disclaimer.aviationRegs.item3")}</li>
                    <li>{t("disclaimer.aviationRegs.item4")}</li>
                  </ul>
                  <p className="text-xs text-text-primary font-medium">{t("disclaimer.aviationRegs.footer")}</p>
                </div>
              </div>

              <div className="border-t border-border-default" />

              {/* 4. Export Controls */}
              <div className="flex gap-3">
                <PackageCheck size={16} className="text-accent-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.exportControls.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.exportControls.body")}</p>
                </div>
              </div>

              <div className="border-t border-border-default" />

              {/* 5. No Warranty / Assumption of Risk */}
              <div className="flex gap-3">
                <AlertTriangle size={16} className="text-status-warning shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.noWarranty.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-2">{t("disclaimer.noWarranty.warranty")}</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.noWarranty.risk")}</p>
                </div>
              </div>

              <div className="border-t border-border-default" />

              {/* 6. Open Source License */}
              <div className="flex gap-3">
                <Scale size={16} className="text-accent-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.openSource.heading")}</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-1">{t("disclaimer.openSource.body")}</p>
                  <a
                    href="https://www.gnu.org/licenses/gpl-3.0.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent-primary hover:underline"
                  >
                    {t("disclaimer.openSource.link")} →
                  </a>
                </div>
              </div>
            </div>

            {/* Acceptance checkbox */}
            <label className="flex items-start gap-3 mb-6 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={disclaimerChecked}
                onChange={() => setDisclaimerChecked(!disclaimerChecked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-accent-primary rounded-sm border-border-default bg-bg-tertiary"
              />
              <span className="text-xs text-text-primary leading-relaxed">
                {t("disclaimer.acceptCheckbox")}
              </span>
            </label>

            <button
              type="button"
              disabled={!disclaimerChecked}
              onClick={() => {
                setDisclaimerAccepted(DISCLAIMER_VERSION);
                advance(3);
              }}
              className={`${PRIMARY_CTA_CLASS} block w-fit mx-auto ${!disclaimerChecked ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
            >
              {t("disclaimer.acceptButton")} →
            </button>

            <StepDots step={dotStep} total={totalSteps} />
          </div>
        </div>

        {/* -- STEP 3: Preferences -- */}
        <div
          className={`absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out ${stepX(3)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(2)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
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
                  onChange={(v) => {
                    const j = v as Jurisdiction | "";
                    setLocalJurisdiction(j);
                    if (j) setLocalUnits(JURISDICTIONS[j].defaultUnits);
                  }}
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
              onClick={() => advance(4)}
              className={`${PRIMARY_CTA_CLASS} mt-8 block w-fit mx-auto`}
            >
              {tCommon("continue")} →
            </button>

            <StepDots step={dotStep} total={totalSteps} />
          </div>
        </div>

        {/* -- STEP 4: Theme Selection -- */}
        <div
          className={`absolute inset-0 flex flex-col items-center p-4 sm:p-6 md:p-8 pt-14 sm:pt-16 overflow-y-auto transition-transform duration-300 ease-in-out ${stepX(4)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(3)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
          >
            ← {tCommon("back")}
          </button>

          <div className="w-full max-w-4xl">
            <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
              {tTheme("title")}
            </h2>
            <p className="text-xs text-text-tertiary mb-6 text-center">
              {tTheme("subtitle")}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 mb-6">
              <div className="rounded-xl border border-border-default bg-bg-secondary p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-[11px] uppercase tracking-widest text-text-tertiary">{tTheme("themeLibrary")}</p>
                  <span className="text-[10px] text-text-tertiary">{tTheme("visibleCount", { count: selectableThemes.length })}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {GROUP_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveGroup(tab.key)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                        activeGroup === tab.key
                          ? "bg-accent-primary text-black"
                          : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {groupTabLabels[tab.key]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {selectableThemes.map((theme) => (
                    <ThemeMiniTile
                      key={theme.value}
                      theme={theme}
                      onClick={() => handleThemeTileClick(theme.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border-default bg-bg-secondary p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-[11px] uppercase tracking-widest text-text-tertiary">{tTheme("preview")}</p>
                  <span className="text-xs font-medium text-text-primary">{previewTheme.label}</span>
                </div>
                <ThemeWorkspacePreview theme={previewTheme} />
                <p className="text-[11px] text-text-tertiary mt-2 text-center">{tTheme("tapToSwap")}</p>
              </div>
            </div>

            {/* Accent color */}
            <div className="border-t border-border-default pt-4 mb-6">
              <p className="text-sm text-text-primary font-medium mb-3 text-center">{tTheme("accentColor")}</p>
              <div className="flex justify-center">
                <div
                  className="relative inline-flex items-center gap-2 rounded-full border border-border-default px-2 py-2 touch-none"
                  onPointerMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setAccentPointerX(event.clientX - rect.left);
                  }}
                  onPointerLeave={() => {
                    setHoveredAccentColor(null);
                    setAccentPointerX(null);
                  }}
                  onPointerCancel={() => {
                    setHoveredAccentColor(null);
                    setAccentPointerX(null);
                  }}
                  style={{
                    background: accentCapsuleBackground,
                    borderColor: accentCapsuleBorder,
                    boxShadow: accentCapsuleShadow,
                  }}
                >
                  {ACCENT_COLORS.map((color, index) => {
                    const dockScale = getAccentDockScale(index, color.value);
                    const lift = (dockScale - 1) * 10;
                    return (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setAccentColor(color.value)}
                      onPointerEnter={() => setHoveredAccentColor(color.value)}
                      title={accentColorLabels[color.value]}
                      aria-label={tTheme("setAccentColorAria", { color: accentColorLabels[color.value] })}
                      className="relative rounded-full transition-transform duration-200 ease-out focus-visible:outline-none"
                      style={{
                        width: ACCENT_BALL_SIZE,
                        height: ACCENT_BALL_SIZE,
                        transform: `translateY(${-lift}px) scale(${dockScale})`,
                        zIndex: Math.round(dockScale * 10),
                      }}
                    >
                      <span
                        className="block w-full h-full rounded-full border border-white/20"
                        style={{
                          backgroundColor: color.hex,
                          boxShadow: accentColor === color.value
                            ? `0 0 0 2px var(--alt-bg-primary), 0 0 0 4px ${color.hex}55`
                            : `0 3px 10px ${color.hex}40`,
                        }}
                      />
                    </button>
                  );})}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => advance(afterTheme)}
              className={`${PRIMARY_CTA_CLASS} block w-fit mx-auto`}
            >
              {tCommon("continue")} →
            </button>

            <StepDots step={dotStep} total={totalSteps} />
          </div>
        </div>

        {/* -- STEP 5: Desktop App Download (skipped in Electron) -- */}
        {!skipDownloadStep && (
        <div
          className={`absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out ${stepX(5)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(4)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
          >
            ← {tCommon("back")}
          </button>

          <div className="w-full max-w-xl text-center">
            <Monitor size={32} className="text-accent-primary mx-auto mb-4" />
            <h2 className="text-xl font-display font-semibold text-text-primary mb-2">
              {t("download.title")}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed mb-8 max-w-md mx-auto">
              {t("download.description")}
            </p>

            {/* Platform boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {/* macOS */}
              <div className="border border-border-default bg-bg-secondary rounded-lg p-5 flex flex-col items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <span className="text-sm font-medium text-text-primary">{t("download.macos")}</span>
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <a
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-11 px-4 text-xs font-semibold rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:border-accent-primary/50 transition-all inline-flex items-center justify-center w-full sm:w-auto"
                  >
                    {t("download.appleSilicon")}
                  </a>
                  <a
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-11 px-4 text-xs font-semibold rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:border-accent-primary/50 transition-all inline-flex items-center justify-center w-full sm:w-auto"
                  >
                    {t("download.intel")}
                  </a>
                </div>
              </div>

              {/* Windows */}
              <div className="border border-border-default bg-bg-secondary rounded-lg p-5 flex flex-col items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
                </svg>
                <span className="text-sm font-medium text-text-primary">{t("download.windows")}</span>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 px-4 text-xs font-semibold rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:border-accent-primary/50 transition-all inline-flex items-center justify-center w-full sm:w-auto"
                >
                  {t("download.download")} .exe
                </a>
              </div>

              {/* Linux */}
              <div className="border border-border-default bg-bg-secondary rounded-lg p-5 flex flex-col items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.39.033.77-.396 1.164-.664.29-.2.608-.382.737-.71.264-.68-.12-.862-.21-1.78a2.25 2.25 0 01.037-.994c.082-.272.2-.418.384-.673.156-.21.29-.46.31-.728.015-.212-.057-.42-.14-.6-.085-.18-.176-.355-.269-.54-.185-.365-.206-.6-.112-.89.146-.46.196-.762.086-1.066a.786.786 0 00-.266-.366c-.159-.134-.375-.26-.635-.37-.26-.11-.528-.207-.792-.404-.15-.13-.26-.25-.37-.39-.11-.14-.22-.3-.31-.45-.09-.16-.18-.32-.27-.47-.1-.16-.2-.33-.32-.48l-.03-.04c-.42-.55-.89-1-.89-1.93 0-.88.34-1.96.34-3.27 0-2.78-1.895-5.19-5.22-5.19l-.14.002zm-1.005 17.244c-.003.073 0 .136.013.2l-.01.025c.006.034.011.074.011.115 0 .146-.072.28-.196.37-.124.09-.27.14-.43.14a.61.61 0 01-.38-.12c-.137-.1-.278-.21-.425-.265a1.34 1.34 0 00-.463-.075c-.073 0-.138.007-.2.02-.152-.223-.32-.455-.527-.608-.159-.12-.381-.247-.584-.302-.206-.055-.398-.073-.513-.264-.12-.25-.07-.61.015-.858.063-.185.143-.355.233-.504a.86.86 0 01.065-.112c.03-.04.06-.08.083-.12.122-.14.277-.243.48-.301a.96.96 0 01.284-.033c.148 0 .287.031.432.051a2.65 2.65 0 00.478.025c.278-.013.482-.083.677-.13l.004.001.008-.001c.067-.016.137-.029.218-.036.11-.01.216 0 .32.033.104.034.2.088.28.166.073.071.141.154.2.244.056.086.098.163.128.225.018.04.03.075.046.115a.54.54 0 01.034.138c.014.11-.015.224-.06.32z"/>
                </svg>
                <span className="text-sm font-medium text-text-primary">{t("download.linux")}</span>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 px-4 text-xs font-semibold rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:border-accent-primary/50 transition-all inline-flex items-center justify-center w-full sm:w-auto"
                >
                  {t("download.download")} .AppImage
                </a>
              </div>
            </div>

            <p className="text-[10px] text-text-tertiary mb-4">{t("download.releasesNote")}</p>

            {/* Continue */}
            <button
              type="button"
              onClick={() => advance(6)}
              className={`${PRIMARY_CTA_CLASS} mb-3`}
            >
              {t("download.continue")}
            </button>

            <div>
              <button
                type="button"
                onClick={() => advance(6)}
                className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {t("download.skip")}
              </button>
            </div>

            <div className="mt-4">
              <StepDots step={dotStep} total={totalSteps} />
            </div>
          </div>
        </div>
        )}

        {/* -- STEP 6: Ready -- */}
        <div
          className={`absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out ${stepX(6)}`}
        >
          {/* Back button */}
          <button
            type="button"
            onClick={() => back(beforeReady)}
            className="absolute top-3 left-3 sm:top-6 sm:left-6 min-h-11 px-2 -ml-1 text-sm text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-1 z-10"
          >
            ← {tCommon("back")}
          </button>

          <div className="text-center max-w-lg w-full">
            {/* Check mark */}
            <div className="w-14 h-14 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-primary">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
            </div>

            <h2 className="text-2xl font-display font-semibold text-text-primary mb-1">
              {t("ready.title")}
            </h2>
            <p className="text-xs text-text-tertiary mb-6">
              {t("ready.communityDescription")}
            </p>

            {/* Community cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-left">
              {/* Discord card */}
              <a
                href="https://discord.gg/uxbvuD4d5q"
                target="_blank"
                rel="noopener noreferrer"
                className="group border border-border-default bg-bg-secondary rounded-lg p-4 hover:border-[#5865F2]/50 transition-colors"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#5865F2]/10 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[#5865F2]">
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary group-hover:text-[#5865F2] transition-colors">{t("ready.discordHeading")}</p>
                  </div>
                </div>
                <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
                  {t("ready.discordDescription")}
                </p>
                <span className="text-[11px] font-medium text-[#5865F2] group-hover:underline">
                  {t("ready.joinDiscord")} &rarr;
                </span>
              </a>

              {/* GitHub card */}
              <a
                href="https://github.com/altnautica/ADOSMissionControl"
                target="_blank"
                rel="noopener noreferrer"
                className="group border border-border-default bg-bg-secondary rounded-lg p-4 hover:border-text-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-text-primary/5 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary group-hover:text-text-primary transition-colors">{t("ready.githubHeading")}</p>
                  </div>
                </div>
                <p className="text-[11px] text-text-tertiary leading-relaxed mb-3">
                  {t("ready.githubDescription")}
                </p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-primary group-hover:underline">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  {t("ready.starGitHub")} &rarr;
                </span>
              </a>
            </div>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={handleGetStarted}
              className={`${PRIMARY_CTA_CLASS} mb-4`}
            >
              {t("ready.openApp")}
            </button>

            <StepDots step={dotStep} total={totalSteps} />
          </div>
        </div>

      </div>
    </div>
  );
}

/**
 * Standalone disclaimer gate for existing users who completed onboarding
 * before the disclaimer step was added. Shows only the disclaimer (not the full
 * 6-step onboarding) and blocks the app until accepted.
 */
export function DisclaimerGate() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const disclaimerAccepted = useSettingsStore((s) => s.disclaimerAccepted);
  const setDisclaimerAccepted = useSettingsStore((s) => s.setDisclaimerAccepted);
  const t = useTranslations("welcome");
  const [checked, setChecked] = useState(false);

  // Only show for existing users who are onboarded but haven't accepted the disclaimer
  if (!hasHydrated || !onboarded || disclaimerAccepted) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-bg-primary overflow-hidden flex items-center justify-center p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("disclaimer.title")}
    >
      <div className="w-full max-w-2xl">
        <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
          {t("disclaimer.title")}
        </h2>
        <p className="text-xs text-text-tertiary mb-6 text-center">
          {t("disclaimer.subtitle")}
        </p>

        <div className="[max-height:60dvh] overflow-y-auto border border-border-default rounded-sm bg-bg-secondary p-4 space-y-4 mb-6 overscroll-contain">
          <div className="flex gap-3">
            <Shield size={16} className="text-accent-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.lawfulUse.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.lawfulUse.body")}</p>
            </div>
          </div>
          <div className="border-t border-border-default" />
          <div className="flex gap-3">
            <Swords size={16} className="text-accent-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.militaryUse.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.militaryUse.body")}</p>
            </div>
          </div>
          <div className="border-t border-border-default" />
          <div className="flex gap-3">
            <Plane size={16} className="text-accent-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.aviationRegs.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-2">{t("disclaimer.aviationRegs.body")}</p>
              <ul className="list-disc list-inside text-xs text-text-secondary leading-relaxed space-y-1 mb-2">
                <li>{t("disclaimer.aviationRegs.item1")}</li>
                <li>{t("disclaimer.aviationRegs.item2")}</li>
                <li>{t("disclaimer.aviationRegs.item3")}</li>
                <li>{t("disclaimer.aviationRegs.item4")}</li>
              </ul>
              <p className="text-xs text-text-primary font-medium">{t("disclaimer.aviationRegs.footer")}</p>
            </div>
          </div>
          <div className="border-t border-border-default" />
          <div className="flex gap-3">
            <PackageCheck size={16} className="text-accent-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.exportControls.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.exportControls.body")}</p>
            </div>
          </div>
          <div className="border-t border-border-default" />
          <div className="flex gap-3">
            <AlertTriangle size={16} className="text-status-warning shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.noWarranty.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-2">{t("disclaimer.noWarranty.warranty")}</p>
              <p className="text-xs text-text-secondary leading-relaxed">{t("disclaimer.noWarranty.risk")}</p>
            </div>
          </div>
          <div className="border-t border-border-default" />
          <div className="flex gap-3">
            <Scale size={16} className="text-accent-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">{t("disclaimer.openSource.heading")}</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-1">{t("disclaimer.openSource.body")}</p>
              <a
                href="https://www.gnu.org/licenses/gpl-3.0.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-primary hover:underline"
              >
                {t("disclaimer.openSource.link")} →
              </a>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => setChecked(!checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-accent-primary rounded-sm border-border-default bg-bg-tertiary"
          />
          <span className="text-xs text-text-primary leading-relaxed">
            {t("disclaimer.acceptCheckbox")}
          </span>
        </label>

        <button
          type="button"
          disabled={!checked}
          onClick={() => setDisclaimerAccepted(DISCLAIMER_VERSION)}
          className={`${PRIMARY_CTA_CLASS} block w-fit mx-auto ${!checked ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
        >
          {t("disclaimer.acceptButton")}
        </button>

      </div>
    </div>
  );
}
