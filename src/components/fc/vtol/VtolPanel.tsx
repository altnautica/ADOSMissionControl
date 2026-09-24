"use client";

import { useMemo, useState } from "react";
import { Plane, Save, RotateCcw, HardDrive } from "lucide-react";

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
import { EnumSelect } from "../parameters/EnumSelect";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";

interface Field {
  param: string;
  label: string;
  kind: "enum" | "number";
  min?: number;
  max?: number;
  step?: number;
}

const GENERAL: Field[] = [
  { param: "Q_ENABLE", label: "QuadPlane Enable", kind: "enum" },
  { param: "Q_FRAME_CLASS", label: "Frame Class", kind: "enum" },
  { param: "Q_FRAME_TYPE", label: "Frame Type", kind: "enum" },
];

const TRANSITION: Field[] = [
  { param: "Q_TRANSITION_MS", label: "Transition Time (ms)", kind: "number", min: 0, max: 30000, step: 100 },
  { param: "Q_TRANS_DECEL", label: "Transition Decel (m/s²)", kind: "number", min: 0.5, max: 10, step: 0.1 },
  { param: "Q_ASSIST_SPEED", label: "Assist Speed (m/s)", kind: "number", min: 0, max: 30, step: 0.5 },
  { param: "Q_ASSIST_ANGLE", label: "Assist Angle (deg)", kind: "number", min: 0, max: 90, step: 1 },
  { param: "Q_ASSIST_ALT", label: "Assist Altitude (m)", kind: "number", min: 0, max: 120, step: 1 },
];

const TILT: Field[] = [
  { param: "Q_TILT_MASK", label: "Tilt Motor Mask", kind: "number", min: 0, max: 255, step: 1 },
  { param: "Q_TILT_TYPE", label: "Tilt Type", kind: "enum" },
  { param: "Q_TILT_MAX", label: "Max Tilt Angle (deg)", kind: "number", min: 0, max: 90, step: 1 },
  { param: "Q_TILT_RATE_UP", label: "Tilt Rate Up (deg/s)", kind: "number", min: 0, max: 300, step: 1 },
  { param: "Q_TILT_RATE_DN", label: "Tilt Rate Down (deg/s)", kind: "number", min: 0, max: 300, step: 1 },
];

const TAILSIT: Field[] = [
  { param: "Q_TAILSIT_ENABLE", label: "Tailsitter Enable", kind: "enum" },
  { param: "Q_TAILSIT_ANGLE", label: "Transition Angle (deg)", kind: "number", min: 5, max: 80, step: 1 },
  { param: "Q_TAILSIT_INPUT", label: "Input Mask", kind: "enum" },
  { param: "Q_TAILSIT_MOTMX", label: "Motor Mask", kind: "number", min: 0, max: 255, step: 1 },
];

const ALL_FIELDS = [...GENERAL, ...TRANSITION, ...TILT, ...TAILSIT];

export function VtolPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("vtol");
  const [saving, setSaving] = useState(false);
  const [showTilt, setShowTilt] = useState(false);
  const [showTailsit, setShowTailsit] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  // All Q_* are optional: a plain quadplane has no tilt params, a tiltrotor no
  // tailsitter params — a missing one should leave the panel usable.
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "vtol", autoLoad: true });
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
    const meta = paramMeta.get(f.param);
    return (
      <div key={f.param} className="grid grid-cols-[200px_1fr] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
        {f.kind === "enum" && meta?.values && meta.values.size > 0 ? (
          <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(f.param, v)} />
        ) : (
          <input type="number" min={f.min} max={f.max} step={f.step} value={value}
            onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value) || 0)}
            className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
        )}
      </div>
    );
  };

  const section = (title: string, fields: Field[]) => (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Plane size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      </div>
      <div className="space-y-3">{fields.map(renderField)}</div>
    </div>
  );

  const collapsible = (title: string, open: boolean, toggle: () => void, fields: Field[]) => (
    <div className="border border-border-default bg-bg-secondary">
      <button onClick={toggle} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
        <Plane size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <span className="text-[10px] text-text-tertiary ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{fields.map(renderField)}</div>}
    </div>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="QuadPlane / VTOL" subtitle="Frame, transition, and tilt/tailsitter setup for VTOL planes"
          icon={<Plane size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {section("General", GENERAL)}
        {section("Transition & Assist", TRANSITION)}
        {collapsible("Tilt-Rotor", showTilt, () => setShowTilt((v) => !v), TILT)}
        {collapsible("Tailsitter", showTailsit, () => setShowTailsit((v) => !v), TAILSIT)}

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
