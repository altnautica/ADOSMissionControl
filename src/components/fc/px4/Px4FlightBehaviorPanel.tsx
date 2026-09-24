"use client";

import { useMemo, useState } from "react";
import { Gauge, Save, RotateCcw, HardDrive, Move, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
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

// Values verified against PX4 v1.16.2 parameters.json (bundled px4.json.gz).
const SPEED: Field[] = [
  { param: "MPC_XY_CRUISE", label: "Cruise Speed (m/s)", min: 3, max: 20, step: 0.5 },
  { param: "MPC_XY_VEL_MAX", label: "Max Horizontal Speed (m/s)", min: 0, max: 20, step: 0.5 },
  { param: "MPC_Z_VEL_MAX_UP", label: "Max Ascent Speed (m/s)", min: 0.5, max: 8, step: 0.1 },
  { param: "MPC_Z_VEL_MAX_DN", label: "Max Descent Speed (m/s)", min: 0.5, max: 4, step: 0.1 },
];

const ACCEL: Field[] = [
  { param: "MPC_ACC_HOR", label: "Horizontal Accel (m/s²)", min: 2, max: 15, step: 0.5 },
  { param: "MPC_ACC_HOR_MAX", label: "Max Horizontal Accel (m/s²)", min: 2, max: 15, step: 0.5 },
  { param: "MPC_ACC_UP_MAX", label: "Max Up Accel (m/s²)", min: 2, max: 15, step: 0.5 },
  { param: "MPC_ACC_DOWN_MAX", label: "Max Down Accel (m/s²)", min: 2, max: 15, step: 0.5 },
  { param: "MPC_JERK_AUTO", label: "Auto Jerk (m/s³)", min: 1, max: 80, step: 1 },
  { param: "MPC_JERK_MAX", label: "Max Jerk (m/s³)", min: 0.5, max: 500, step: 1 },
  { param: "MPC_TILTMAX_AIR", label: "Max Tilt in Air (deg)", min: 20, max: 89, step: 1 },
  { param: "MPC_TILTMAX_LND", label: "Max Tilt on Takeoff (deg)", min: 5, max: 89, step: 1 },
];

const POSITION: Field[] = [
  { param: "MPC_XY_P", label: "Horizontal Position P", min: 0, max: 2, step: 0.05 },
  { param: "MPC_Z_P", label: "Vertical Position P", min: 0.1, max: 1.5, step: 0.05 },
  { param: "MPC_XY_VEL_P_ACC", label: "Horizontal Velocity P", min: 1.2, max: 5, step: 0.1 },
  { param: "MPC_XY_VEL_I_ACC", label: "Horizontal Velocity I", min: 0, max: 60, step: 0.05 },
  { param: "MPC_XY_VEL_D_ACC", label: "Horizontal Velocity D", min: 0.1, max: 2, step: 0.02 },
  { param: "MPC_Z_VEL_P_ACC", label: "Vertical Velocity P", min: 2, max: 15, step: 0.1 },
  { param: "MPC_Z_VEL_I_ACC", label: "Vertical Velocity I", min: 0.2, max: 3, step: 0.1 },
  { param: "MPC_Z_VEL_D_ACC", label: "Vertical Velocity D", min: 0, max: 2, step: 0.02 },
];

const ALL_FIELDS = [...SPEED, ...ACCEL, ...POSITION];

export function Px4FlightBehaviorPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-flight-behavior");
  const [saving, setSaving] = useState(false);
  const [showPos, setShowPos] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "px4-flight-behavior", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
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
        <PanelHeader title="Flight Behavior" subtitle="PX4 multicopter speed, acceleration, and position control (MPC)"
          icon={<Gauge size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {section("Speed Limits", <Gauge size={14} className="text-accent-primary" />, SPEED)}
        {section("Acceleration, Jerk & Tilt", <Zap size={14} className="text-accent-primary" />, ACCEL)}

        <div className="border border-border-default bg-bg-secondary">
          <button onClick={() => setShowPos((v) => !v)} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
            <Move size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Position & Velocity Controllers</h2>
            <span className="text-[10px] text-text-tertiary ml-auto">{showPos ? "▾" : "▸"}</span>
          </button>
          {showPos && <div className="px-4 pb-4 space-y-3">{POSITION.map(renderField)}</div>}
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
