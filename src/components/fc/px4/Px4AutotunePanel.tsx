"use client";

import { useMemo, useState } from "react";
import { Wand2, Save, RotateCcw, HardDrive, AlertTriangle } from "lucide-react";

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
import { EnumSelect } from "../parameters/EnumSelect";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";

interface Field { param: string; label: string; kind: "enum" | "number"; min?: number; max?: number; step?: number }

// Verified against PX4 v1.16.2 parameters.json.
const MC_FIELDS: Field[] = [
  { param: "MC_AT_EN", label: "Autotune Module", kind: "enum" },
  { param: "MC_AT_START", label: "Start Autotune", kind: "enum" },
  { param: "MC_AT_APPLY", label: "Apply Gains", kind: "enum" },
  { param: "MC_AT_RISE_TIME", label: "Rise Time (s)", kind: "number", min: 0.01, max: 0.5, step: 0.01 },
  { param: "MC_AT_SYSID_AMP", label: "SysID Amplitude", kind: "number", min: 0.1, max: 6, step: 0.1 },
];

const FW_FIELDS: Field[] = [
  { param: "FW_AT_START", label: "Start Autotune", kind: "enum" },
  { param: "FW_AT_APPLY", label: "Apply Gains", kind: "enum" },
  { param: "FW_AT_AXES", label: "Tuning Axes (bitmask)", kind: "number", min: 1, max: 7, step: 1 },
  { param: "FW_AT_MAN_AUX", label: "RC Trigger Channel", kind: "enum" },
  { param: "FW_AT_SYSID_AMP", label: "SysID Amplitude", kind: "number", min: 0.1, max: 6, step: 0.1 },
  { param: "FW_AT_SYSID_F0", label: "Start Frequency (Hz)", kind: "number", min: 0.1, max: 30, step: 0.1 },
  { param: "FW_AT_SYSID_F1", label: "End Frequency (Hz)", kind: "number", min: 0.1, max: 30, step: 0.1 },
  { param: "FW_AT_SYSID_TIME", label: "Maneuver Time (s)", kind: "number", min: 5, max: 120, step: 1 },
  { param: "FW_AT_SYSID_TYPE", label: "Signal Type", kind: "enum" },
];

export function Px4AutotunePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-autotune");
  const [saving, setSaving] = useState(false);

  // A plane tunes its fixed-wing rates; a multicopter its MC rates; a VTOL does
  // both (multirotor hover + fixed-wing cruise).
  const vehicleClass = getSelectedDrone()?.vehicleInfo?.vehicleClass;
  const isFixedWing = vehicleClass === "plane";
  const isVtol = vehicleClass === "vtol";
  // Memoize so the field set (and thus paramNames) keeps a stable reference —
  // an unstable paramNames would re-fetch every render.
  const fields = useMemo(
    () => (isFixedWing ? FW_FIELDS : isVtol ? [...MC_FIELDS, ...FW_FIELDS] : MC_FIELDS),
    [isFixedWing, isVtol],
  );

  const paramNames = useMemo(() => fields.map((f) => f.param), [fields]);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "px4-autotune", autoLoad: true });
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

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Autotune" subtitle={`PX4 ${isFixedWing ? "fixed-wing" : isVtol ? "multicopter + fixed-wing" : "multicopter"} auto-tuning`}
          icon={<Wand2 size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <div className="flex items-start gap-2 border border-status-warning/40 bg-status-warning/5 p-3">
          <AlertTriangle size={14} className="text-status-warning mt-0.5 shrink-0" />
          <p className="text-[11px] text-text-secondary">
            Autotune injects test signals in flight. Fly in a stable mode with room to maneuver, set
            &ldquo;Start Autotune&rdquo; to enabled, save, then arm. Keep &ldquo;Apply Gains&rdquo; on
            &ldquo;after disarm&rdquo; unless you understand in-air application.
          </p>
        </div>

        <div className="border border-border-default bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-3"><Wand2 size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">Autotune Settings</h2></div>
          <div className="space-y-3">{fields.map(renderField)}</div>
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
