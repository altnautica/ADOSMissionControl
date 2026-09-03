/**
 * @module WelcomeModal
 * @description Full-screen multi-step onboarding shell. Holds step index +
 * direction + per-step local state, then renders each step pane absolutely
 * positioned with translate-x sliding. Sub-step JSX lives in `./steps/`.
 *
 * Step state is intentionally not persisted. Closing mid-flow restarts at
 * the language picker.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useToast } from "@/components/ui/toast";
import { pushThemeToAllAgents } from "@/lib/agent/theme-sync";
import { isElectron } from "@/lib/utils";
import {
  computeStepX,
  computeDotStep,
  computeTotalSteps,
  computeAfterTheme,
  computeBeforeReady,
  type Step,
} from "./step-state";
import { useGcsLocationStore, type GeoPermission } from "@/stores/gcs-location-store";
import { type Jurisdiction } from "@/lib/jurisdiction";
import type { UnitSystem, ThemeMode } from "@/stores/settings-store";
import { THEME_CARDS, detectBrowserLocale } from "./constants";
import { LanguageStep } from "./steps/LanguageStep";
import { IntroStep } from "./steps/IntroStep";
import { DisclaimerStep } from "./steps/DisclaimerStep";
import { PreferencesStep } from "./steps/PreferencesStep";
import { RegionStep } from "./steps/RegionStep";
import { ThemeStep } from "./steps/ThemeStep";
import { DownloadStep } from "./steps/DownloadStep";
import { ReadyStep } from "./steps/ReadyStep";
import {
  OTHER_REGION_VALUE,
  UNRESTRICTED_VALUE,
  normalizeRegionCode,
} from "@/lib/operating-region";

// Re-export DisclaimerGate so existing import sites
// (`@/components/onboarding/WelcomeModal`) keep working.
export { DisclaimerGate } from "./DisclaimerGate";

export function WelcomeModal() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const setJurisdictionStored = useSettingsStore((s) => s.setJurisdiction);
  const setOperatorRegionStored = useSettingsStore((s) => s.setOperatorRegion);
  const setUnitsStored = useSettingsStore((s) => s.setUnits);
  const setDemoModeStored = useSettingsStore((s) => s.setDemoMode);
  const setAudioEnabledStored = useSettingsStore((s) => s.setAudioEnabled);
  const setLocationEnabledStored = useSettingsStore((s) => s.setLocationEnabled);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const pushThemeToAgents = useSettingsStore((s) => s.pushThemeToAgents);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const requestPermission = useGcsLocationStore((s) => s.requestPermission);
  const isSupported = useGcsLocationStore((s) => s.isSupported);
  const t = useTranslations("welcome.themeSync");
  const tWelcome = useTranslations("welcome");
  const { toast } = useToast();

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

  // Step 4: operating region (default Unrestricted). `regionSelection` is
  // the picker sentinel/code; `regionOtherCode` holds a free-text ISO code.
  const [regionSelection, setRegionSelection] = useState<string>(UNRESTRICTED_VALUE);
  const [regionOtherCode, setRegionOtherCode] = useState<string>("");

  // Step 5: theme order (preview slot first, then library)
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

  const skipDownloadStep = isElectron();
  const totalSteps = computeTotalSteps(skipDownloadStep);
  const afterTheme: Step = computeAfterTheme(skipDownloadStep);
  const beforeReady: Step = computeBeforeReady(skipDownloadStep);
  const dotStep = computeDotStep(step, skipDownloadStep);

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
    if (jurisdiction) setJurisdictionStored(jurisdiction);
    // Resolve the chosen default operating region. Unrestricted (the
    // default) and an invalid free-text code both persist as null.
    const region =
      regionSelection === UNRESTRICTED_VALUE
        ? null
        : regionSelection === OTHER_REGION_VALUE
          ? normalizeRegionCode(regionOtherCode)
          : regionSelection;
    setOperatorRegionStored(region);
    setUnitsStored(units);
    setDemoModeStored(demoMode);
    setAudioEnabledStored(audioEnabled);
    setLocationEnabledStored(locationEnabled);
    setOnboarded(true);

    // Push the chosen theme to every paired agent so the LCD on each
    // companion board mirrors the desktop palette without a manual
    // visit to the Display sub-view. "auto" stays agent-local because
    // the agent has its own default. Failures don't block onboarding.
    if (
      pushThemeToAgents
      && (themeMode === "dark" || themeMode === "light")
      && pairedDrones.length > 0
    ) {
      pushThemeToAllAgents(pairedDrones, themeMode)
        .then((result) => {
          if (result.attempted === 0) return;
          if (result.succeeded > 0) {
            toast(
              t("syncedToCount", { count: result.succeeded }),
              "success",
            );
          }
          if (result.failures.size > 0) {
            toast(
              t("syncFailedCount", { count: result.failures.size }),
              "warning",
            );
          }
        })
        .catch(() => {
          /* Per-agent errors are captured inside the helper; this
           * catch is a belt-and-suspenders backstop. */
        });
    }
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
  const stepX = (i: Step): string => computeStepX(i, step, direction);

  const baseStepClass = "absolute inset-0 flex flex-col p-4 sm:p-6 md:p-8 overflow-y-auto [align-items:safe_center] [justify-content:safe_center] transition-transform duration-300 ease-in-out";

  return (
    <div
      className="fixed inset-0 z-[200] bg-bg-primary overflow-hidden transition-colors duration-300"
      role="dialog"
      aria-modal="true"
      // Was a hardcoded English string — and this is the very first dialog an
      // operator meets, on the step where they pick their language.
      aria-label={tWelcome("dialogLabel")}
    >
      <div className="relative w-full h-full">
        {/* Step 0: Language */}
        <div className={`${baseStepClass} ${stepX(0)}`}>
          <LanguageStep
            selectedLocale={selectedLocale}
            onLocaleChange={setSelectedLocale}
            next={() => advance(1)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 1: Intro / Brand */}
        <div
          className={`absolute inset-0 flex flex-col md:flex-row overflow-y-auto transition-transform duration-300 ease-in-out ${stepX(1)}`}
        >
          <IntroStep
            next={() => advance(2)}
            back={() => back(0)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 2: Disclaimer */}
        <div className={`${baseStepClass} ${stepX(2)}`}>
          <DisclaimerStep
            checked={disclaimerChecked}
            onChange={setDisclaimerChecked}
            next={() => advance(3)}
            back={() => back(1)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 3: Preferences */}
        <div className={`${baseStepClass} ${stepX(3)}`}>
          <PreferencesStep
            jurisdiction={jurisdiction}
            units={units}
            demoMode={demoMode}
            audioEnabled={audioEnabled}
            locationEnabled={locationEnabled}
            locationPermission={locationPermission}
            locationChecking={locationChecking}
            isLocationSupported={isSupported}
            setJurisdiction={setLocalJurisdiction}
            setUnits={setLocalUnits}
            setDemoMode={setLocalDemoMode}
            setAudioEnabled={setLocalAudioEnabled}
            onLocationToggle={handleLocationToggle}
            next={() => advance(4)}
            back={() => back(2)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 4: Operating region */}
        <div className={`${baseStepClass} ${stepX(4)}`}>
          <RegionStep
            selection={regionSelection}
            otherCode={regionOtherCode}
            setSelection={setRegionSelection}
            setOtherCode={setRegionOtherCode}
            next={() => advance(5)}
            back={() => back(3)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 5: Theme */}
        <div
          className={`absolute inset-0 flex flex-col items-center p-4 sm:p-6 md:p-8 pt-14 sm:pt-16 overflow-y-auto transition-transform duration-300 ease-in-out ${stepX(5)}`}
        >
          <ThemeStep
            themeOrder={themeOrder}
            accentColor={accentColor}
            onThemeTileClick={handleThemeTileClick}
            onAccentChange={setAccentColor}
            next={() => advance(afterTheme)}
            back={() => back(4)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>

        {/* Step 6: Desktop Download (skipped in Electron) */}
        {!skipDownloadStep && (
          <div className={`${baseStepClass} ${stepX(6)}`}>
            <DownloadStep
              next={() => advance(7)}
              back={() => back(5)}
              dotStep={dotStep}
              totalSteps={totalSteps}
            />
          </div>
        )}

        {/* Step 7: Ready */}
        <div className={`${baseStepClass} ${stepX(7)}`}>
          <ReadyStep
            onFinish={handleGetStarted}
            back={() => back(beforeReady)}
            dotStep={dotStep}
            totalSteps={totalSteps}
          />
        </div>
      </div>
    </div>
  );
}
