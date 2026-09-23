"use client";

import { useMemo, useState } from "react";
import { Plane, Save, RotateCcw, HardDrive, ArrowLeftRight, ShieldAlert } from "lucide-react";

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

// Verified against PX4 VTOL params (vtol_att_control / standard / tiltrotor).
const CORE: Field[] = [
  { param: "VT_TYPE", label: "VTOL Type", kind: "enum" },
  { param: "VT_F_TRANS_DUR", label: "Front Transition Dur (s)", kind: "number", min: 0.1, max: 20, step: 0.1 },
  { param: "VT_B_TRANS_DUR", label: "Back Transition Dur (s)", kind: "number", min: 0.1, max: 20, step: 0.1 },
  { param: "VT_F_TRANS_THR", label: "Front Transition Throttle", kind: "number", min: 0, max: 1, step: 0.01 },
  { param: "VT_ARSP_BLEND", label: "Airspeed Blend (m/s)", kind: "number", min: 0, max: 30, step: 0.5 },
  { param: "VT_ARSP_TRANS", label: "Airspeed Transition (m/s)", kind: "number", min: 0, max: 30, step: 0.5 },
  { param: "VT_TRANS_TIMEOUT", label: "Transition Timeout (s)", kind: "number", min: 0.1, max: 30, step: 0.5 },
  { param: "VT_TRANS_MIN_TM", label: "Min Transition Time (s)", kind: "number", min: 0, max: 20, step: 0.5 },
];

const QUADCHUTE: Field[] = [
  { param: "VT_FW_MIN_ALT", label: "Quad-chute Min Alt (m)", kind: "number", min: 0, max: 200, step: 1 },
  { param: "VT_FW_QC_P", label: "Quad-chute Max Pitch (deg)", kind: "number", min: 0, max: 180, step: 1 },
  { param: "VT_FW_QC_R", label: "Quad-chute Max Roll (deg)", kind: "number", min: 0, max: 180, step: 1 },
  { param: "VT_QC_ALT_LOSS", label: "Quad-chute Alt Loss (m)", kind: "number", min: 0, max: 200, step: 1 },
];

const TILTROTOR: Field[] = [
  { param: "VT_TILT_MC", label: "Tilt in Hover", kind: "number", min: 0, max: 1, step: 0.01 },
  { param: "VT_TILT_TRANS", label: "Tilt in Transition", kind: "number", min: 0, max: 1, step: 0.01 },
  { param: "VT_TILT_FW", label: "Tilt in Forward Flight", kind: "number", min: 0, max: 1, step: 0.01 },
  { param: "VT_TRANS_P2_DUR", label: "Transition Phase-2 Dur (s)", kind: "number", min: 0.1, max: 5, step: 0.1 },
  { param: "VT_BT_TILT_DUR", label: "Back-transition Tilt Dur (s)", kind: "number", min: 0.1, max: 10, step: 0.1 },
];

const STANDARD: Field[] = [
  { param: "VT_FWD_THRUST_EN", label: "Forward Thrust in Hover", kind: "enum" },
  { param: "VT_FWD_THRUST_SC", label: "Forward Thrust Scale", kind: "number", min: 0, max: 5, step: 0.1 },
  { param: "VT_B_TRANS_RAMP", label: "Back-transition Ramp (s)", kind: "number", min: 0, max: 20, step: 0.5 },
  { param: "VT_PSHER_SLEW", label: "Pusher Slew Rate (1/s)", kind: "number", min: 0, max: 5, step: 0.05 },
];

const ALL_FIELDS = [...CORE, ...QUADCHUTE, ...TILTROTOR, ...STANDARD];

export function Px4VtolPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-vtol");
  const [saving, setSaving] = useState(false);
  const [showTilt, setShowTilt] = useState(false);
  const [showStd, setShowStd] = useState(false);
  const [showQc, setShowQc] = useState(false);

  const paramNames = useMemo(() => ALL_FIELDS.map((f) => f.param), []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "px4-vtol", autoLoad: true });
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

  const collapsible = (title: string, icon: React.ReactNode, open: boolean, toggle: () => void, fields: Field[]) => (
    <div className="border border-border-default bg-bg-secondary">
      <button onClick={toggle} className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50">
        {icon}<h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <span className="text-[10px] text-text-tertiary ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{fields.map(renderField)}</div>}
    </div>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="VTOL Transition" subtitle="PX4 VTOL type, transition timing, quad-chute, and airframe-specific tilt/thrust"
          icon={<ArrowLeftRight size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <div className="border border-border-default bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-3"><ArrowLeftRight size={14} className="text-accent-primary" /><h2 className="text-sm font-medium text-text-primary">Transition</h2></div>
          <div className="space-y-3">{CORE.map(renderField)}</div>
        </div>

        {collapsible("Quad-Chute (FW → MC safety)", <ShieldAlert size={14} className="text-accent-primary" />, showQc, () => setShowQc((v) => !v), QUADCHUTE)}
        {collapsible("Tiltrotor", <Plane size={14} className="text-accent-primary" />, showTilt, () => setShowTilt((v) => !v), TILTROTOR)}
        {collapsible("Standard VTOL (pusher)", <Plane size={14} className="text-accent-primary" />, showStd, () => setShowStd((v) => !v), STANDARD)}

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
