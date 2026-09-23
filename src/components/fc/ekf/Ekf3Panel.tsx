"use client";

import { useMemo, useState } from "react";
import { Compass, Save, RotateCcw, HardDrive, Layers } from "lucide-react";

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

interface Field {
  param: string;
  label: string;
  /** enum → dropdown (from metadata); number → free numeric input. */
  kind: "enum" | "number";
  min?: number;
  max?: number;
  step?: number;
}

const GENERAL: Field[] = [
  { param: "AHRS_EKF_TYPE", label: "Primary Estimator", kind: "enum" },
  { param: "EK3_ENABLE", label: "EKF3 Enable", kind: "enum" },
  { param: "EK3_IMU_MASK", label: "IMU Mask", kind: "number", min: 0, max: 127, step: 1 },
  { param: "EK3_PRIMARY", label: "Primary Core", kind: "number", min: 0, max: 2, step: 1 },
];

const SOURCE_SET_1: Field[] = [
  { param: "EK3_SRC1_POSXY", label: "Position XY", kind: "enum" },
  { param: "EK3_SRC1_VELXY", label: "Velocity XY", kind: "enum" },
  { param: "EK3_SRC1_POSZ", label: "Position Z", kind: "enum" },
  { param: "EK3_SRC1_VELZ", label: "Velocity Z", kind: "enum" },
  { param: "EK3_SRC1_YAW", label: "Yaw", kind: "enum" },
];

const SOURCE_SET_2: Field[] = [
  { param: "EK3_SRC2_POSXY", label: "Position XY", kind: "enum" },
  { param: "EK3_SRC2_VELXY", label: "Velocity XY", kind: "enum" },
  { param: "EK3_SRC2_POSZ", label: "Position Z", kind: "enum" },
  { param: "EK3_SRC2_VELZ", label: "Velocity Z", kind: "enum" },
  { param: "EK3_SRC2_YAW", label: "Yaw", kind: "enum" },
];

const SOURCE_SET_3: Field[] = [
  { param: "EK3_SRC3_POSXY", label: "Position XY", kind: "enum" },
  { param: "EK3_SRC3_VELXY", label: "Velocity XY", kind: "enum" },
  { param: "EK3_SRC3_POSZ", label: "Position Z", kind: "enum" },
  { param: "EK3_SRC3_VELZ", label: "Velocity Z", kind: "enum" },
  { param: "EK3_SRC3_YAW", label: "Yaw", kind: "enum" },
];

const OPTIONS: Field[] = [
  { param: "EK3_SRC_OPTIONS", label: "Source Options", kind: "number", min: 0, max: 1, step: 1 },
];

const NOISE: Field[] = [
  { param: "EK3_POSNE_M_NSE", label: "Horiz. Position Noise (m)", kind: "number", min: 0.1, max: 10, step: 0.1 },
  { param: "EK3_ALT_M_NSE", label: "Altitude Noise (m)", kind: "number", min: 0.1, max: 10, step: 0.1 },
  { param: "EK3_VELNE_M_NSE", label: "Horiz. Velocity Noise (m/s)", kind: "number", min: 0.05, max: 5, step: 0.05 },
  { param: "EK3_VELD_M_NSE", label: "Vertical Velocity Noise (m/s)", kind: "number", min: 0.05, max: 5, step: 0.05 },
  { param: "EK3_MAG_M_NSE", label: "Compass Noise", kind: "number", min: 0.01, max: 0.5, step: 0.01 },
];

const ALL_FIELDS = [
  ...GENERAL, ...SOURCE_SET_1, ...SOURCE_SET_2, ...SOURCE_SET_3, ...OPTIONS, ...NOISE,
] as const;

export function Ekf3Panel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("ekf3");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, panelId: "ekf3", autoLoad: true });
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
    const value = params.get(f.param);
    const isDirty = dirtyParams.has(f.param);
    const meta = paramMeta.get(f.param);
    return (
      <div key={f.param} className="grid grid-cols-[200px_1fr] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
        {value === undefined ? (
          // Never an editable 0 for a parameter that was not read.
          <span className="text-xs font-mono text-text-tertiary">{hasLoaded ? "not present" : "—"}</span>
        ) : f.kind === "enum" && meta?.values && meta.values.size > 0 ? (
          <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(f.param, v)} />
        ) : (
          <input type="number" min={f.min} max={f.max} step={f.step} value={value}
            onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value) || 0)}
            className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
        )}
      </div>
    );
  };

  const section = (title: string, fields: Field[], hint?: string) => (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Compass size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      </div>
      {hint && <p className="text-[10px] text-text-tertiary mb-3">{hint}</p>}
      <div className="space-y-3">{fields.map(renderField)}</div>
    </div>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="EKF3 Estimator" subtitle="Extended Kalman Filter source sets, IMU selection, and measurement noise"
          icon={<Compass size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        {section("General", GENERAL)}
        {section("Source Set 1", SOURCE_SET_1, "The default fusion sources for position, velocity, and yaw.")}

        <div className="border border-border-default bg-bg-secondary">
          <button onClick={() => setShowAdvanced((a) => !a)} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
            <Layers size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Alternate Source Sets &amp; Noise</h2>
            <span className="text-[10px] text-text-tertiary ml-auto">{showAdvanced ? "▾" : "▸"}</span>
          </button>
          {showAdvanced && (
            <div className="px-4 pb-4 space-y-6">
              <div className="space-y-3 pt-2">{SOURCE_SET_2.map(renderField)}</div>
              <div className="space-y-3">{SOURCE_SET_3.map(renderField)}</div>
              <div className="space-y-3">{OPTIONS.map(renderField)}</div>
              <div className="space-y-3">{NOISE.map(renderField)}</div>
            </div>
          )}
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
