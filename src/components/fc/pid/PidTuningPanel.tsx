"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { SlidersHorizontal, Save, RotateCcw, HardDrive, Zap, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { PidAxisRow } from "./PidAxisRow";
import {
  type PidPreset, type VehicleType,
  PLANE_AXES, COPTER_AXES, ROVER_AXES, ROVER_NAV_PARAMS, ACRO_PARAMS, FILTER_PARAMS, COPTER_PRESETS,
  BF_PID_AXES, BF_FILTER_PARAMS, BF_PID_PRESETS,
} from "./pid-constants";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ParamTooltip } from "../parameters/ParamTooltip";
import { PidAnalysisSection } from "./PidAnalysisSection";
import type { SuggestionTarget } from "@/stores/pid-analysis-store";
import { AutotuneSection, LivePidResponseGraph, PidSnapshotComparison, Px4GainMultipliers } from "./PidComparisonSection";

export function PidTuningPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isBetaflight = firmwareType === 'betaflight';

  const drone = getSelectedDrone();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("pid-tuning");
  const detectedVehicle: VehicleType | null = useMemo(() => {
    const vc = drone?.vehicleInfo?.vehicleClass;
    if (vc === "copter") return "copter";
    if (vc === "plane" || vc === "vtol") return "plane";
    if (vc === "rover") return "rover";
    return null;
  }, [drone?.vehicleInfo?.vehicleClass]);

  const [vehicleType, setVehicleType] = useState<VehicleType>(detectedVehicle ?? "copter");
  const apAxes = vehicleType === "copter" ? COPTER_AXES : vehicleType === "rover" ? ROVER_AXES : PLANE_AXES;
  const activeAxes = isBetaflight ? BF_PID_AXES : apAxes;
  const activeFilterParams = isBetaflight ? BF_FILTER_PARAMS : FILTER_PARAMS;
  const activePresets = isBetaflight ? BF_PID_PRESETS : COPTER_PRESETS;

  const [showFilters, setShowFilters] = useState(false);

  const paramNames = useMemo(() => {
    if (isBetaflight) {
      return [
        ...BF_PID_AXES.flatMap((a) => a.params.map((p) => p.param)),
        ...(showFilters ? BF_FILTER_PARAMS.map((p) => p.param) : []),
      ];
    }
    return [
      ...apAxes.flatMap((a) => a.params.map((p) => p.param)),
      ...(vehicleType === "rover"
        ? ROVER_NAV_PARAMS.map((p) => p.param)
        : ACRO_PARAMS.map((p) => p.param)),
      ...(showFilters ? FILTER_PARAMS.map((p) => p.param) : []),
      ...(isPx4 ? ["MC_ROLLRATE_K", "MC_PITCHRATE_K", "MC_YAWRATE_K"] : []),
    ];
  }, [apAxes, vehicleType, showFilters, isPx4, isBetaflight]);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "pid", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  // AI suggestions are validated against FC-confirmed values only: a param
  // with a pending local edit has no confirmed value until it is saved.
  const suggestionTarget: SuggestionTarget = useMemo(() => ({
    vehicleType,
    fcParams: new Map([...params].filter(([name]) => !dirtyParams.has(name))),
    setLocalValue,
  }), [vehicleType, params, dirtyParams, setLocalValue]);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok);
  }

  function handleRevert() {
    revertAll();
    toast("Reverted to FC values", "info");
  }

  function applyPreset(preset: PidPreset) {
    for (const [param, value] of Object.entries(preset.values)) {
      setLocalValue(param, value);
    }
    toast(`Applied "${preset.name}" preset — save to apply`, "info");
  }

  const subtitle = isBetaflight
    ? "Betaflight PID gains — roll, pitch, yaw"
    : vehicleType === "copter"
      ? "ArduCopter rate PIDs — roll, pitch, yaw"
      : vehicleType === "rover"
        ? "ArduRover steering-rate and speed/throttle PIDs"
        : "ArduPlane roll, pitch, yaw servo PID gains";

  return (
    <ArmedLockOverlay>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader title="PID Tuning" subtitle={subtitle} icon={<SlidersHorizontal size={16} />}
          loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {!isBetaflight && (
          <div className="flex items-center gap-1 bg-bg-secondary border border-border-default p-1 w-fit">
            <button onClick={() => setVehicleType("copter")} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer", vehicleType === "copter" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary")}>Copter</button>
            <button onClick={() => setVehicleType("plane")} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer", vehicleType === "plane" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary")}>Plane</button>
            <button onClick={() => setVehicleType("rover")} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer", vehicleType === "rover" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary")}>Rover</button>
            {detectedVehicle && <span className="text-[10px] text-text-tertiary ml-2">Detected: {detectedVehicle}</span>}
          </div>
        )}

        {activeAxes.map((axis) => (
          <PidAxisRow key={axis.axis} axis={axis} params={params} dirtyParams={dirtyParams} setLocalValue={setLocalValue} mapParamName={pn} />
        ))}

        {!isBetaflight && vehicleType !== "rover" && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Acro Rates</h2>
            </div>
            <div className="space-y-3">
              {ACRO_PARAMS.map((pidP) => {
                const value = params.get(pidP.param) ?? 0;
                const isDirty = dirtyParams.has(pidP.param);
                return (
                  <div key={pidP.param} className="grid grid-cols-[160px_1fr_80px] items-center gap-3">
                    <div>
                      <span className="text-xs font-mono text-text-secondary">{pidP.label}</span>
                      <ParamTooltip meta={paramMeta.get(pidP.param)}><span className="text-[9px] text-text-tertiary block cursor-default">{pn(pidP.param)}</span></ParamTooltip>
                    </div>
                    <div className="relative">
                      <input type="range" min={pidP.min} max={pidP.max} step={pidP.step} value={value}
                        onChange={(e) => setLocalValue(pidP.param, parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
                      <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5"><span>{pidP.min}</span><span>{pidP.max} deg/s</span></div>
                    </div>
                    <input type="number" min={pidP.min} max={pidP.max} step={pidP.step} value={value}
                      onChange={(e) => setLocalValue(pidP.param, parseFloat(e.target.value) || 0)}
                      className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {vehicleType === "rover" && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Navigation</h2>
            </div>
            <div className="space-y-3">
              {ROVER_NAV_PARAMS.map((pidP) => {
                const value = params.get(pidP.param) ?? 0;
                const isDirty = dirtyParams.has(pidP.param);
                return (
                  <div key={pidP.param} className="grid grid-cols-[180px_1fr_80px] items-center gap-3">
                    <div>
                      <span className="text-xs font-mono text-text-secondary">{pidP.label}</span>
                      <ParamTooltip meta={paramMeta.get(pidP.param)}><span className="text-[9px] text-text-tertiary block cursor-default">{pn(pidP.param)}</span></ParamTooltip>
                    </div>
                    <div className="relative">
                      <input type="range" min={pidP.min} max={pidP.max} step={pidP.step} value={value}
                        onChange={(e) => setLocalValue(pidP.param, parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
                      <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5"><span>{pidP.min}</span><span>{pidP.max}</span></div>
                    </div>
                    <input type="number" min={pidP.min} max={pidP.max} step={pidP.step} value={value}
                      onChange={(e) => setLocalValue(pidP.param, parseFloat(e.target.value) || 0)}
                      className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(isBetaflight || vehicleType === "copter") && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Preset Profiles</h2>
            </div>
            <div className="flex gap-2">
              {activePresets.map((preset) => (
                <button key={preset.name} onClick={() => applyPreset(preset)}
                  className="flex-1 border border-border-default px-3 py-2 text-xs hover:bg-bg-tertiary hover:border-accent-primary/50 cursor-pointer transition-colors">
                  <span className="font-semibold text-text-primary block">{preset.name}</span>
                  <span className="text-[10px] text-text-tertiary">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border border-border-default bg-bg-secondary">
          <button onClick={() => setShowFilters((f) => !f)} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
            <Filter size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Filter Settings</h2>
            <span className="text-[10px] text-text-tertiary ml-auto">{showFilters ? "\u25BE" : "\u25B8"}</span>
          </button>
          {showFilters && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-[10px] text-text-tertiary">{isBetaflight ? "Gyro and D-term low-pass and notch filters" : "INS gyro/accel low-pass filters and harmonic notch filter"}</p>
              {activeFilterParams.map((fp) => {
                const value = params.get(fp.param) ?? 0;
                const isDirty = dirtyParams.has(fp.param);
                return (
                  <div key={fp.param} className="grid grid-cols-[180px_1fr_80px] items-center gap-3">
                    <div>
                      <span className="text-xs font-mono text-text-secondary">{fp.label}</span>
                      <ParamTooltip meta={paramMeta.get(fp.param)}><span className="text-[9px] text-text-tertiary block cursor-default">{pn(fp.param)}</span></ParamTooltip>
                    </div>
                    <div className="relative">
                      <input type="range" min={fp.min} max={fp.max} step={fp.step} value={value}
                        onChange={(e) => setLocalValue(fp.param, parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
                      <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5"><span>{fp.min}</span><span>{fp.max}</span></div>
                    </div>
                    <input type="number" min={fp.min} max={fp.max} step={fp.step} value={value}
                      onChange={(e) => setLocalValue(fp.param, parseFloat(e.target.value) || 0)}
                      className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isBetaflight && <AutotuneSection connected={connected} vehicleType={vehicleType} />}

        <PidAnalysisSection target={suggestionTarget} connected={connected} />

        <LivePidResponseGraph connected={connected} />

        <PidSnapshotComparison params={params} />

        {isPx4 && <Px4GainMultipliers params={params} setLocalValue={setLocalValue} hasLoaded={hasLoaded} />}

        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
          <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={!hasDirty} onClick={handleRevert}>Revert</Button>
          {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedLockOverlay>
  );
}
