"use client";

import { useMemo, useState } from "react";
import { Satellite, Save, RotateCcw, HardDrive } from "lucide-react";

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

interface Field { param: string; label: string; kind: "enum" | "number"; min?: number; max?: number; step?: number }

// Verified against PX4 GPS driver params (gps/params.yaml). GNSS-system fields
// are bitmasks (bit0 GPS, 1 SBAS, 2 Galileo, 3 BeiDou, 4 GLONASS, 5 NAVIC).
const PRIMARY: Field[] = [
  { param: "GPS_1_PROTOCOL", label: "Protocol", kind: "enum" },
  { param: "GPS_1_GNSS", label: "GNSS Systems (bitmask)", kind: "number", min: 0, max: 63, step: 1 },
  { param: "GPS_UBX_DYNMODEL", label: "u-blox Dynamic Model", kind: "enum" },
  { param: "GPS_UBX_MODE", label: "u-blox Mode (RTK/heading)", kind: "enum" },
  { param: "GPS_YAW_OFFSET", label: "Dual-antenna Yaw Offset (deg)", kind: "number", min: 0, max: 360, step: 1 },
  { param: "GPS_SAT_INFO", label: "Publish Satellite Info", kind: "enum" },
];

const SECONDARY: Field[] = [
  { param: "GPS_2_PROTOCOL", label: "Protocol", kind: "enum" },
  { param: "GPS_2_GNSS", label: "GNSS Systems (bitmask)", kind: "number", min: 0, max: 63, step: 1 },
];

const ALL_FIELDS = [...PRIMARY, ...SECONDARY];

export function Px4GpsPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-gps");
  const [saving, setSaving] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: SECONDARY.map((f) => f.param), panelId: "px4-gps", autoLoad: true });
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
      <div key={f.param} className="grid grid-cols-[220px_1fr] items-center gap-3">
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
        <PanelHeader title="GPS Configuration" subtitle="PX4 GNSS protocol, systems, and u-blox setup"
          icon={<Satellite size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <div className="border border-border-default bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-3"><Satellite size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">Primary GPS</h2></div>
          <p className="text-[10px] text-text-tertiary mb-3">GNSS bitmask: GPS=1, SBAS=2, Galileo=4, BeiDou=8, GLONASS=16, NAVIC=32 (0 = receiver default). Most GPS params need a reboot.</p>
          <div className="space-y-3">{PRIMARY.map(renderField)}</div>
        </div>

        <div className="border border-border-default bg-bg-secondary">
          <button onClick={() => setShowSecondary((v) => !v)} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
            <Satellite size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Secondary GPS</h2>
            <span className="text-[10px] text-text-tertiary ml-auto">{showSecondary ? "▾" : "▸"}</span>
          </button>
          {showSecondary && <div className="px-4 pb-4 space-y-3">{SECONDARY.map(renderField)}</div>}
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
