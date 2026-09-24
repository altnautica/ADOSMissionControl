"use client";

import { useMemo, useState } from "react";
import { Wind, Save, RotateCcw, HardDrive, Navigation } from "lucide-react";

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

interface Field {
  param: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** TECS — Total Energy Control System (speed + height → throttle + pitch). */
const TECS: Field[] = [
  { param: "TECS_CLMB_MAX", label: "Max Climb Rate (m/s)", min: 0.1, max: 20, step: 0.1 },
  { param: "TECS_SINK_MIN", label: "Min Sink Rate (m/s)", min: 0.1, max: 10, step: 0.1 },
  { param: "TECS_SINK_MAX", label: "Max Sink Rate (m/s)", min: 0, max: 20, step: 0.1 },
  { param: "TECS_TIME_CONST", label: "Time Constant (s)", min: 3, max: 10, step: 0.5 },
  { param: "TECS_THR_DAMP", label: "Throttle Damping", min: 0.1, max: 1, step: 0.1 },
  { param: "TECS_INTEG_GAIN", label: "Integrator Gain", min: 0, max: 0.5, step: 0.02 },
  { param: "TECS_SPDWEIGHT", label: "Speed Weight (0=height, 2=speed)", min: 0, max: 2, step: 0.1 },
  { param: "TECS_PTCH_DAMP", label: "Pitch Damping", min: 0.1, max: 1, step: 0.1 },
  { param: "TECS_RLL2THR", label: "Bank → Throttle FF", min: 0, max: 30, step: 1 },
];

/** L1 lateral navigation controller. */
const L1: Field[] = [
  { param: "NAVL1_PERIOD", label: "L1 Period (s)", min: 1, max: 60, step: 1 },
  { param: "NAVL1_DAMPING", label: "L1 Damping", min: 0.6, max: 1, step: 0.05 },
  { param: "NAVL1_XTRACK_I", label: "Cross-track Integrator", min: 0, max: 0.1, step: 0.01 },
  { param: "NAVL1_LIM_BANK", label: "Nav Bank Limit (deg)", min: 0, max: 89, step: 1 },
];

const ALL_FIELDS = [...TECS, ...L1];

export function TecsPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("tecs");
  const [saving, setSaving] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "tecs", autoLoad: true });
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
      <div key={f.param} className="grid grid-cols-[240px_1fr_80px] items-center gap-3">
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

  const section = (title: string, icon: React.ReactNode, fields: Field[], hint: string) => (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">{icon}<h2 className="text-sm font-medium text-text-primary">{title}</h2></div>
      <p className="text-[10px] text-text-tertiary mb-3">{hint}</p>
      <div className="space-y-3">{fields.map(renderField)}</div>
    </div>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="TECS / L1 Tuning" subtitle="Fixed-wing total-energy control and L1 lateral navigation"
          icon={<Wind size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {section("TECS — Energy Control", <Wind size={14} className="text-accent-primary" />, TECS,
          "Couples airspeed and altitude to throttle and pitch. Speed weight balances holding speed vs. holding height.")}
        {section("L1 — Lateral Navigation", <Navigation size={14} className="text-accent-primary" />, L1,
          "Controls how tightly the plane tracks its path. Lower L1 period = tighter turns; raise it if the plane oscillates.")}

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
