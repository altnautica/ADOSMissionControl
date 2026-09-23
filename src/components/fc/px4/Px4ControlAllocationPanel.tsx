/**
 * @module Px4ControlAllocationPanel
 * @description PX4 control-allocation (CA_*) setup: airframe + allocation
 * method, reversible-motor mask, per-rotor thrust/moment/direction/tilt
 * coefficients, control surfaces, and tilt servos. Enum labels and ranges come
 * from the bundled PX4 param metadata.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo, useState } from "react";
import { Save, RotateCcw, HardDrive, Sliders } from "lucide-react";

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
import { BitmaskEditor } from "@/components/ui/bitmask-editor";
import {
  type CaField,
  CA_ALL_PARAM_NAMES,
  CA_MAX_ROTORS,
  CA_MAX_SURFACES,
  CA_MAX_TILTS,
  CA_R_REV_BITS,
  caRotorFields,
  caSurfaceFields,
  caTiltFields,
} from "./px4-control-allocation-constants";

const AIRFRAME_FIELDS: CaField[] = [
  { param: "CA_AIRFRAME", label: "Airframe", kind: "enum" },
  { param: "CA_METHOD", label: "Allocation method", kind: "enum" },
];

export function Px4ControlAllocationPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-control-allocation");
  const [saving, setSaving] = useState(false);
  const [revEditor, setRevEditor] = useState(false);

  const paramNames = useMemo(() => CA_ALL_PARAM_NAMES, []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "px4-control-allocation", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const rotorCount = Math.min(CA_MAX_ROTORS, Math.max(0, Math.trunc(params.get("CA_ROTOR_COUNT") ?? 0)));
  const surfaceCount = Math.min(CA_MAX_SURFACES, Math.max(0, Math.trunc(params.get("CA_SV_CS_COUNT") ?? 0)));
  const tiltCount = Math.min(CA_MAX_TILTS, Math.max(0, Math.trunc(params.get("CA_SV_TL_COUNT") ?? 0)));
  const revValue = Math.trunc(params.get("CA_R_REV") ?? 0);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    toast(ok ? "Saved to flight controller" : "Some parameters failed to save", ok ? "success" : "warning");
  }
  async function handleFlash() { showFlashResult(await commitToFlash()); }
  function handleRevert() { revertAll(); toast("Reverted to FC values", "info"); }

  const renderField = (f: CaField) => {
    const value = params.get(f.param) ?? 0;
    const isDirty = dirtyParams.has(f.param);
    const meta = paramMeta.get(f.param);
    return (
      <div key={f.param} className="grid grid-cols-[180px_1fr] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
        {f.kind === "enum" && meta?.values && meta.values.size > 0 ? (
          <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(f.param, v)} />
        ) : (
          <input
            type="number" min={meta?.range?.min} max={meta?.range?.max} step="any" value={value}
            onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value) || 0)}
            className={cn(
              "w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors",
              isDirty ? "border-status-warning" : "border-border-default",
            )}
          />
        )}
      </div>
    );
  };

  const indexedCards = (count: number, fields: (i: number) => CaField[], label: string) =>
    Array.from({ length: count }, (_, i) => (
      <div key={i} className="border border-border-default bg-bg-tertiary/30 p-3">
        <div className="text-[11px] font-mono text-text-tertiary mb-2">{label} {i + 1}</div>
        <div className="space-y-2">{fields(i).map(renderField)}</div>
      </div>
    ));

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Control Allocation"
            subtitle="PX4 airframe, allocation method, rotor coefficients, control surfaces, and tilt servos"
            icon={<Sliders size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
            onRead={refresh} connected={connected} error={error}
          />

          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <h2 className="text-sm font-medium text-text-primary">Airframe</h2>
            {AIRFRAME_FIELDS.map(renderField)}
            <div className="grid grid-cols-[180px_1fr] items-center gap-3">
              <div>
                <span className="text-xs text-text-secondary">Reversible motors</span>
                <span className="text-[9px] text-text-tertiary block font-mono">{pn("CA_R_REV")}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setRevEditor(true)}>
                {revValue === 0 ? "None" : `${revValue} — set bits…`}
              </Button>
            </div>
          </div>

          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <h2 className="text-sm font-medium text-text-primary">Rotors</h2>
            {renderField({ param: "CA_ROTOR_COUNT", label: "Rotor count", kind: "enum" })}
            {rotorCount > 0
              ? indexedCards(rotorCount, caRotorFields, "Rotor")
              : hasLoaded && <p className="text-[10px] text-text-tertiary">Set a rotor count to configure rotor coefficients.</p>}
          </div>

          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <h2 className="text-sm font-medium text-text-primary">Control Surfaces</h2>
            {renderField({ param: "CA_SV_CS_COUNT", label: "Surface count", kind: "enum" })}
            {surfaceCount > 0 && indexedCards(surfaceCount, caSurfaceFields, "Surface")}
          </div>

          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <h2 className="text-sm font-medium text-text-primary">Tilt Servos</h2>
            {renderField({ param: "CA_SV_TL_COUNT", label: "Tilt-servo count", kind: "enum" })}
            {tiltCount > 0 && indexedCards(tiltCount, caTiltFields, "Tilt")}
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

      <BitmaskEditor
        open={revEditor}
        onClose={() => setRevEditor(false)}
        title="Reversible motors (CA_R_REV)"
        bitmask={CA_R_REV_BITS}
        value={revValue}
        onApply={(v) => setLocalValue("CA_R_REV", v)}
      />
    </ArmedWarningBanner>
  );
}
