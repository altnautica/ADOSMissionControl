"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { Gauge, Save, RotateCcw, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { AXIS_COLORS } from "../chart-theme";
import { RateCurvePreview, RATES_TYPE, RATES_TYPE_OPTIONS, type CurveData } from "./rate-curve-preview";
import { BF_RATE_OPTIONAL_PARAM_NAMES, BF_RATE_PARAM_NAMES } from "./bf-rate-constants";

const paramNames = [...BF_RATE_PARAM_NAMES];
const optionalParams = [...BF_RATE_OPTIONAL_PARAM_NAMES];
/** Firmware CONTROL_RATE_CONFIG_RATE_LIMIT_MAX, the limit when the FC does not report one. */
const RATE_LIMIT_MAX = 1998;

export function RateProfilePanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const scrollRef = usePanelScroll("rate-profiles");

  const panelParams = usePanelParams({ paramNames, optionalParams, panelId: "rate-profiles", autoLoad: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flash: handleFlash, revert: handleRevert } =
    useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const p = (name: string, fallback = 0) => params.get(name) ?? fallback;
  // Firmware without rates_type only has Betaflight rates.
  const ratesType = params.get("BF_RATES_TYPE") ?? RATES_TYPE.BETAFLIGHT;

  const curves: CurveData[] = useMemo(() => {
    const v = (name: string, fallback = 0) => params.get(name) ?? fallback;
    return [
      { label: "Roll", color: AXIS_COLORS.roll, rates: { rcRate: v("BF_RC_RATE"), expo: v("BF_RC_EXPO"), superRate: v("BF_ROLL_RATE"), rateLimit: v("BF_ROLL_RATE_LIMIT", RATE_LIMIT_MAX) } },
      { label: "Pitch", color: AXIS_COLORS.pitch, rates: { rcRate: v("BF_RC_PITCH_RATE"), expo: v("BF_RC_PITCH_EXPO"), superRate: v("BF_PITCH_RATE"), rateLimit: v("BF_PITCH_RATE_LIMIT", RATE_LIMIT_MAX) } },
      { label: "Yaw", color: AXIS_COLORS.yaw, rates: { rcRate: v("BF_RC_YAW_RATE"), expo: v("BF_RC_YAW_EXPO"), superRate: v("BF_YAW_RATE"), rateLimit: v("BF_YAW_RATE_LIMIT", RATE_LIMIT_MAX) } },
    ];
  }, [params]);

  function renderSlider(param: string, label: string, min: number, max: number, step: number, unit?: string) {
    const value = p(param);
    const isDirty = dirtyParams.has(param);
    return (
      <div key={param} className="grid grid-cols-[140px_1fr_70px] items-center gap-3">
        <div>
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-[9px] text-text-tertiary block font-mono">{param}</span>
        </div>
        <div className="relative">
          <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => setLocalValue(param, parseFloat(e.target.value))} className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
          <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5">
            <span>{min}</span>
            <span>{max}{unit ? ` ${unit}` : ""}</span>
          </div>
        </div>
        <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => setLocalValue(param, parseFloat(e.target.value) || 0)} className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right", "focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
      </div>
    );
  }

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader title="Rate Profiles" subtitle="Betaflight rate curve configuration" icon={<Gauge size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-6">
            {params.has("BF_RATES_TYPE") && (
              <div className="border border-border-default bg-bg-secondary p-4">
                <Select label="Rates type" options={RATES_TYPE_OPTIONS} value={String(ratesType)}
                  onChange={(v) => setLocalValue("BF_RATES_TYPE", Number(v))} />
              </div>
            )}
            <div className="border border-border-default bg-bg-secondary p-4">
              <h2 className="text-sm font-medium text-text-primary mb-3">Roll</h2>
              <div className="space-y-3">
                {renderSlider("BF_RC_RATE", "RC Rate (Roll)", 0, 255, 1)}
                {renderSlider("BF_RC_EXPO", "RC Expo (Roll)", 0, 100, 1)}
                {renderSlider("BF_ROLL_RATE", "Roll Rate", 0, 255, 1)}
              </div>
            </div>
            <div className="border border-border-default bg-bg-secondary p-4">
              <h2 className="text-sm font-medium text-text-primary mb-3">Pitch</h2>
              <div className="space-y-3">
                {renderSlider("BF_RC_PITCH_RATE", "RC Rate (Pitch)", 0, 255, 1)}
                {renderSlider("BF_RC_PITCH_EXPO", "RC Expo (Pitch)", 0, 100, 1)}
                {renderSlider("BF_PITCH_RATE", "Pitch Rate", 0, 255, 1)}
              </div>
            </div>
            <div className="border border-border-default bg-bg-secondary p-4">
              <h2 className="text-sm font-medium text-text-primary mb-3">Yaw</h2>
              <div className="space-y-3">
                {renderSlider("BF_RC_YAW_RATE", "RC Rate (Yaw)", 0, 255, 1)}
                {renderSlider("BF_RC_YAW_EXPO", "RC Expo (Yaw)", 0, 100, 1)}
                {renderSlider("BF_YAW_RATE", "Yaw Rate", 0, 255, 1)}
              </div>
            </div>
            <div className="border border-border-default bg-bg-secondary p-4">
              <h2 className="text-sm font-medium text-text-primary mb-3">Throttle</h2>
              <div className="space-y-3">
                {renderSlider("BF_THROTTLE_MID", "Mid", 0, 100, 1, "%")}
                {renderSlider("BF_THROTTLE_EXPO", "Expo", 0, 100, 1)}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="border border-border-default bg-bg-secondary p-3">
              <h2 className="text-sm font-medium text-text-primary mb-2">Rate Curve Preview</h2>
              <RateCurvePreview ratesType={ratesType} curves={curves} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
          <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={!hasDirty} onClick={handleRevert}>Revert</Button>
          {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
