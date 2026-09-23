"use client";

/**
 * A shared param-form FC panel: renders titled sections of enum / number /
 * bitmask fields for a set of parameters, with the standard load/save/flash/
 * revert controls, armed lock, and metadata-driven enum + bitmask editors. Each
 * concrete panel (Airspeed, Harmonic Notch, Sailboat, Gripper, ADS-B, …) is a
 * thin field spec that renders through this. Fields are all optional so a panel
 * degrades gracefully when the feature isn't configured on the vehicle.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState, type ReactNode } from "react";
import { Save, RotateCcw, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import type { VehicleClass } from "@/lib/protocol/types";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { EnumSelect } from "../parameters/EnumSelect";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { BitmaskEditor } from "@/components/ui/bitmask-editor";

export interface ParamField {
  param: string;
  label: string;
  kind: "enum" | "number" | "bitmask";
  min?: number;
  max?: number;
  step?: number;
}

export interface ParamSection {
  title: string;
  fields: ParamField[];
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Restrict the section to specific vehicle classes. A panel can mix params
   *  that only exist on some vehicles (e.g. copter/rover proximity avoidance in
   *  the aerial ADS-B panel); without this gate those params have no metadata on
   *  the other vehicles and render as raw numbers. Omit to show for any vehicle. */
  vehicleClasses?: VehicleClass[];
}

interface ParamFieldsPanelProps {
  panelId: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  sectionIcon: ReactNode;
  sections: ParamSection[];
  /** Show a "feature not configured" note when a gate param reads "off". */
  gate?: { param: string; off: (v: number) => boolean; message: string };
}

export function ParamFieldsPanel({
  panelId,
  title,
  subtitle,
  icon,
  sectionIcon,
  sections,
  gate,
}: ParamFieldsPanelProps) {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { vehicleClass } = useFirmwareCapabilities();
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll(panelId);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.title, s.defaultOpen ?? true])),
  );
  const [bitmaskEdit, setBitmaskEdit] = useState<string | null>(null);

  // Sections gated to other vehicle classes are dropped so their params are
  // neither loaded nor rendered as raw numbers on a vehicle that lacks them.
  const visibleSections = useMemo(
    () =>
      sections.filter(
        (s) =>
          !s.vehicleClasses ||
          (vehicleClass != null && s.vehicleClasses.includes(vehicleClass)),
      ),
    [sections, vehicleClass],
  );
  const allParams = useMemo(
    () => visibleSections.flatMap((s) => s.fields.map((f) => f.param)),
    [visibleSections],
  );
  const {
    params, loading, error, dirtyParams, hasRamWrites, loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames: allParams, optionalParams: allParams, panelId, autoLoad: true });
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

  const renderField = (f: ParamField) => {
    const value = params.get(f.param);
    const isDirty = dirtyParams.has(f.param);
    const meta = paramMeta.get(f.param);
    if (value === undefined) {
      // Not read yet, the read failed, or the vehicle has no such param:
      // never present a stand-in 0 as the vehicle's value.
      return (
        <div key={f.param} className="grid grid-cols-[200px_1fr] items-center gap-3">
          <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
          <span className="text-xs font-mono text-text-tertiary">{hasLoaded ? "not present" : "—"}</span>
        </div>
      );
    }
    return (
      <div key={f.param} className="grid grid-cols-[200px_1fr] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
        {f.kind === "enum" && meta?.values && meta.values.size > 0 ? (
          <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(f.param, v)} />
        ) : f.kind === "bitmask" && meta?.bitmask && meta.bitmask.size > 0 ? (
          <button
            onClick={() => setBitmaskEdit(f.param)}
            className={cn(
              "w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-left focus:outline-none hover:border-accent-primary transition-colors",
              isDirty ? "border-status-warning" : "border-border-default",
            )}
          >
            0x{(value >>> 0).toString(16).toUpperCase()} · edit bits…
          </button>
        ) : (
          <input
            type="number" min={f.min} max={f.max} step={f.step} value={value}
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

  // Only a gate value actually read from the vehicle can say the feature is off.
  const gateValue = gate ? params.get(gate.param) : undefined;
  const gateOff = gate !== undefined && gateValue !== undefined && gate.off(gateValue);
  const bitmaskMeta = bitmaskEdit ? paramMeta.get(bitmaskEdit) : undefined;

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title={title} subtitle={subtitle} icon={icon}
            loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
            onRead={refresh} connected={connected} error={error}
          />

          {gate && gateOff && (
            <div className="border border-border-default bg-bg-secondary/60 px-4 py-3 text-xs text-text-tertiary">
              {gate.message}
            </div>
          )}

          {visibleSections.map((s) =>
            s.collapsible ? (
              <div key={s.title} className="border border-border-default bg-bg-secondary">
                <button
                  onClick={() => setOpen((o) => ({ ...o, [s.title]: !o[s.title] }))}
                  className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50"
                >
                  <span className="text-accent-primary">{sectionIcon}</span>
                  <h2 className="text-sm font-medium text-text-primary">{s.title}</h2>
                  <span className="text-[10px] text-text-tertiary ml-auto">{open[s.title] ? "▾" : "▸"}</span>
                </button>
                {open[s.title] && <div className="px-4 pb-4 space-y-3">{s.fields.map(renderField)}</div>}
              </div>
            ) : (
              <div key={s.title} className="border border-border-default bg-bg-secondary p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-accent-primary">{sectionIcon}</span>
                  <h2 className="text-sm font-medium text-text-primary">{s.title}</h2>
                </div>
                <div className="space-y-3">{s.fields.map(renderField)}</div>
              </div>
            ),
          )}

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
            <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={!hasDirty} onClick={handleRevert}>Revert</Button>
            {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
            {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
            {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>

      {bitmaskEdit && bitmaskMeta?.bitmask && (
        <BitmaskEditor
          open
          onClose={() => setBitmaskEdit(null)}
          title={pn(bitmaskEdit)}
          bitmask={bitmaskMeta.bitmask}
          value={params.get(bitmaskEdit) ?? 0}
          onApply={(v) => { setLocalValue(bitmaskEdit, v); setBitmaskEdit(null); }}
        />
      )}
    </ArmedWarningBanner>
  );
}
