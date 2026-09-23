"use client";

import { useState, useMemo, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { SlidersHorizontal, Save, RotateCcw, HardDrive, Zap, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { PX4_PARAM_MAP } from "@/lib/protocol/firmware/px4-params";
import { PidAxisRow, PidParamRow } from "./PidAxisRow";
import {
  type AxisConfig, type PidParam, type PidPreset,
  PLANE_AXES, COPTER_AXES, ROVER_AXES, ROVER_NAV_PARAMS, COPTER_ACRO_PARAMS, PLANE_ACRO_PARAMS,
  FILTER_PARAMS, COPTER_PRESETS,
} from "./pid-constants";
import type { TuningVehicleType } from "@/lib/analysis/types";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ParamTooltip } from "../parameters/ParamTooltip";
import { PidAnalysisSection } from "./PidAnalysisSection";
import { usePidAnalysisStore, type SuggestionTarget } from "@/stores/pid-analysis-store";
import { AutotuneSection, LivePidResponseGraph, PidSnapshotComparison, Px4GainMultipliers } from "./PidComparisonSection";

export function PidTuningPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const bindAnalysisDrone = usePidAnalysisStore((s) => s.bindDrone);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";

  // Log analysis and AI suggestions describe one vehicle; clear them before
  // another drone's panel paints.
  useLayoutEffect(() => {
    bindAnalysisDrone(selectedDroneId ?? null);
  }, [selectedDroneId, bindAnalysisDrone]);

  const drone = getSelectedDrone();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("pid-tuning");
  const detectedVehicle: TuningVehicleType | null = useMemo(() => {
    const vc = drone?.vehicleInfo?.vehicleClass;
    if (vc === "copter") return "copter";
    if (vc === "plane" || vc === "vtol") return "plane";
    if (vc === "rover") return "rover";
    return null;
  }, [drone?.vehicleInfo?.vehicleClass]);

  const [vehicleType, setVehicleType] = useState<TuningVehicleType>(detectedVehicle ?? "copter");
  const [showFilters, setShowFilters] = useState(false);

  // PX4 has no counterpart for a canonical name outside the PX4 map; those rows are hidden there.
  const available = useMemo(
    () => (p: PidParam) => !isPx4 || PX4_PARAM_MAP[p.param] !== undefined,
    [isPx4],
  );
  const axes: AxisConfig[] = useMemo(() => {
    const base = vehicleType === "copter" ? COPTER_AXES : vehicleType === "rover" ? ROVER_AXES : PLANE_AXES;
    return base
      .map((a) => ({ ...a, params: a.params.filter(available) }))
      .filter((a) => a.params.length > 0);
  }, [vehicleType, available]);
  const secondaryParams = useMemo(
    () => (vehicleType === "rover" ? ROVER_NAV_PARAMS
      : vehicleType === "plane" ? PLANE_ACRO_PARAMS
      : COPTER_ACRO_PARAMS).filter(available),
    [vehicleType, available],
  );
  const filterParams = useMemo(() => FILTER_PARAMS.filter(available), [available]);

  const paramNames = useMemo(() => [
    ...axes.flatMap((a) => a.params.map((p) => p.param)),
    ...secondaryParams.map((p) => p.param),
    ...(showFilters ? filterParams.map((p) => p.param) : []),
    ...(isPx4 ? ["MC_ROLLRATE_K", "MC_PITCHRATE_K", "MC_YAWRATE_K"] : []),
  ], [axes, secondaryParams, filterParams, showFilters, isPx4]);

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
    showFlashResult(await commitToFlash());
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

  const subtitle = vehicleType === "copter"
    ? "ArduCopter rate PIDs — roll, pitch, yaw"
    : vehicleType === "rover"
      ? "ArduRover steering-rate and speed/throttle PIDs"
      : "ArduPlane roll, pitch, yaw servo PID gains";

  const paramRow = (pidP: PidParam, gridClass: string, unit?: string) => (
    <PidParamRow
      key={pidP.param}
      pidP={pidP}
      value={params.get(pidP.param)}
      hasLoaded={hasLoaded}
      isDirty={dirtyParams.has(pidP.param)}
      onChange={(v) => setLocalValue(pidP.param, v)}
      name={<ParamTooltip meta={paramMeta.get(pidP.param)}><span className="text-[9px] text-text-tertiary block cursor-default">{pn(pidP.param)}</span></ParamTooltip>}
      gridClass={gridClass}
      unit={unit}
    />
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader title="PID Tuning" subtitle={subtitle} icon={<SlidersHorizontal size={16} />}
          loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <div className="flex items-center gap-1 bg-bg-secondary border border-border-default p-1 w-fit">
          {(["copter", "plane", "rover"] as const).map((vt) => (
            <button key={vt} onClick={() => setVehicleType(vt)} className={cn("px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer capitalize", vehicleType === vt ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary")}>{vt}</button>
          ))}
          {detectedVehicle && <span className="text-[10px] text-text-tertiary ml-2">Detected: {detectedVehicle}</span>}
        </div>

        {axes.map((axis) => (
          <PidAxisRow key={axis.axis} axis={axis} params={params} hasLoaded={hasLoaded} dirtyParams={dirtyParams} setLocalValue={setLocalValue} mapParamName={pn} />
        ))}

        {secondaryParams.length > 0 && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">{vehicleType === "rover" ? "Navigation" : "Acro Rates"}</h2>
            </div>
            <div className="space-y-3">
              {secondaryParams.map((pidP) => vehicleType === "rover"
                ? paramRow(pidP, "grid-cols-[180px_1fr_80px]")
                : paramRow(pidP, "grid-cols-[160px_1fr_80px]", "deg/s"))}
            </div>
          </div>
        )}

        {vehicleType === "copter" && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Preset Profiles</h2>
            </div>
            <div className="flex gap-2">
              {COPTER_PRESETS.map((preset) => (
                <button key={preset.name} onClick={() => applyPreset(preset)}
                  className="flex-1 border border-border-default px-3 py-2 text-xs hover:bg-bg-tertiary hover:border-accent-primary/50 cursor-pointer transition-colors">
                  <span className="font-semibold text-text-primary block">{preset.name}</span>
                  <span className="text-[10px] text-text-tertiary">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {filterParams.length > 0 && (
          <div className="border border-border-default bg-bg-secondary">
            <button onClick={() => setShowFilters((f) => !f)} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
              <Filter size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Filter Settings</h2>
              <span className="text-[10px] text-text-tertiary ml-auto">{showFilters ? "\u25BE" : "\u25B8"}</span>
            </button>
            {showFilters && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[10px] text-text-tertiary">INS gyro/accel low-pass filters and harmonic notch filter</p>
                {filterParams.map((fp) => paramRow(fp, "grid-cols-[180px_1fr_80px]"))}
              </div>
            )}
          </div>
        )}

        {!isPx4 && vehicleType === "copter" && <AutotuneSection connected={connected} />}

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
    </ArmedWarningBanner>
  );
}
