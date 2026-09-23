"use client";

import { useMemo, useState } from "react";
import { Plane, Save, RotateCcw, HardDrive, Wind } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { cn } from "@/lib/utils";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";

interface Field { param: string; label: string; min: number; max: number; step: number }

// Values verified against PX4 v1.16.2 parameters.json.
const ROLL: Field[] = [
  { param: "FW_RR_P", label: "P", min: 0, max: 10, step: 0.005 },
  { param: "FW_RR_I", label: "I", min: 0, max: 10, step: 0.01 },
  { param: "FW_RR_D", label: "D", min: 0, max: 10, step: 0.005 },
  { param: "FW_RR_FF", label: "FF", min: 0, max: 10, step: 0.05 },
  { param: "FW_RR_IMAX", label: "IMAX", min: 0, max: 1, step: 0.05 },
];
const PITCH: Field[] = [
  { param: "FW_PR_P", label: "P", min: 0, max: 10, step: 0.005 },
  { param: "FW_PR_I", label: "I", min: 0, max: 10, step: 0.005 },
  { param: "FW_PR_D", label: "D", min: 0, max: 10, step: 0.005 },
  { param: "FW_PR_FF", label: "FF", min: 0, max: 10, step: 0.05 },
  { param: "FW_PR_IMAX", label: "IMAX", min: 0, max: 1, step: 0.05 },
];
const YAW: Field[] = [
  { param: "FW_YR_P", label: "P", min: 0, max: 10, step: 0.005 },
  { param: "FW_YR_I", label: "I", min: 0, max: 10, step: 0.01 },
  { param: "FW_YR_D", label: "D", min: 0, max: 10, step: 0.005 },
  { param: "FW_YR_FF", label: "FF", min: 0, max: 10, step: 0.05 },
  { param: "FW_YR_IMAX", label: "IMAX", min: 0, max: 1, step: 0.05 },
];
const TECS: Field[] = [
  { param: "FW_T_CLMB_MAX", label: "Max Climb Rate (m/s)", min: 1, max: 15, step: 0.5 },
  { param: "FW_T_SINK_MAX", label: "Max Sink Rate (m/s)", min: 1, max: 15, step: 0.5 },
  { param: "FW_T_SINK_MIN", label: "Min Sink Rate (m/s)", min: 1, max: 5, step: 0.5 },
  { param: "FW_T_SPDWEIGHT", label: "Speed Weight (0=alt, 2=speed)", min: 0, max: 2, step: 0.1 },
  { param: "FW_T_THR_DAMPING", label: "Throttle Damping", min: 0, max: 1, step: 0.01 },
  { param: "FW_T_THR_INTEG", label: "Throttle Integrator", min: 0, max: 1, step: 0.005 },
  { param: "FW_T_PTCH_DAMP", label: "Pitch Damping", min: 0, max: 2, step: 0.1 },
  { param: "FW_T_I_GAIN_PIT", label: "Pitch Integrator", min: 0, max: 2, step: 0.05 },
  { param: "FW_T_RLL2THR", label: "Bank → Throttle FF", min: 0, max: 20, step: 0.5 },
  { param: "FW_T_HRATE_FF", label: "Height-Rate FF", min: 0, max: 1, step: 0.05 },
  { param: "FW_T_VERT_ACC", label: "Max Vertical Accel (m/s²)", min: 1, max: 10, step: 0.5 },
  { param: "FW_PSP_OFF", label: "Pitch Setpoint Offset (deg)", min: -90, max: 90, step: 0.5 },
];

const ALL_FIELDS = [...ROLL, ...PITCH, ...YAW, ...TECS];

export function Px4FwTuningPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-fw-tuning");
  const [saving, setSaving] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "px4-fw-tuning", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    toast(ok ? "Saved to flight controller" : "Some parameters failed to save", ok ? "success" : "warning");
  }
  async function handleFlash() { showFlashResult(await commitToFlash()); }
  function handleRevert() { revertAll(); toast("Reverted to FC values", "info"); }

  const renderField = (f: Field) => {
    const value = params.get(f.param) ?? 0;
    const isDirty = dirtyParams.has(f.param);
    return (
      <div key={f.param} className="grid grid-cols-[220px_1fr_80px] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={paramMeta.get(f.param)} />
        <div className="relative">
          <input type="range" min={f.min} max={f.max} step={f.step} value={value}
            onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value))}
            className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
          <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5"><span>{f.min}</span><span>{f.max}</span></div>
        </div>
        <input type="number" min={f.min} max={f.max} step={f.step} value={value}
          onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value) || 0)}
          className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
      </div>
    );
  };

  const section = (title: string, icon: React.ReactNode, fields: Field[]) => (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">{icon}<h2 className="text-sm font-medium text-text-primary">{title}</h2></div>
      <div className="space-y-3">{fields.map(renderField)}</div>
    </div>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Fixed-Wing Tuning" subtitle="PX4 fixed-wing rate controllers and TECS energy control"
          icon={<Plane size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {section("Roll Rate", <Plane size={14} className="text-accent-primary" />, ROLL)}
        {section("Pitch Rate", <Plane size={14} className="text-accent-primary" />, PITCH)}
        {section("Yaw Rate", <Plane size={14} className="text-accent-primary" />, YAW)}
        {section("TECS — Energy Control", <Wind size={14} className="text-accent-primary" />, TECS)}

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
