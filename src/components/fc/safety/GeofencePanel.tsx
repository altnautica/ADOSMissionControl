"use client";

import { useState, useCallback } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { useGeofenceStore } from "@/stores/geofence-store";
import { Shield, HardDrive, Save, MapPin, ArrowUp, Circle, Download, Upload, Plus, Trash2, ToggleLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { Card, FenceTypeChip, ParamInput, AltitudeBandViz } from "./geofence-components";

// ── Constants ────────────────────────────────────────────────

const FENCE_PARAMS = [
  "FENCE_ENABLE", "FENCE_TYPE", "FENCE_ALT_MAX", "FENCE_ALT_MIN",
  "FENCE_RADIUS", "FENCE_MARGIN", "FENCE_ACTION", "FENCE_TOTAL",
];

const FENCE_TYPE_BITS = {
  ALT_MAX: 1 << 0,
  CIRCLE: 1 << 1,
  POLYGON: 1 << 2,
} as const;

const FENCE_ACTION_OPTIONS = [
  { value: "0", label: "0 — Report Only" },
  { value: "1", label: "1 — RTL or Land" },
  { value: "2", label: "2 — Always Land" },
  { value: "3", label: "3 — Brake (Auto)" },
  { value: "4", label: "4 — SmartRTL or RTL" },
  { value: "5", label: "5 — SmartRTL or Land" },
];

// ── Component ────────────────────────────────────────────────

export function GeofencePanel() {
  const { toast } = useToast();
  const { label: pl } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={paramMeta} />;

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: FENCE_PARAMS, panelId: "geofence", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);

  const zones = useGeofenceStore((s) => s.zones);
  const addZone = useGeofenceStore((s) => s.addZone);
  const removeZone = useGeofenceStore((s) => s.removeZone);
  const toggleZoneRole = useGeofenceStore((s) => s.toggleZoneRole);
  const uploadFence = useGeofenceStore((s) => s.uploadFence);
  const downloadFence = useGeofenceStore((s) => s.downloadFence);
  const uploadState = useGeofenceStore((s) => s.uploadState);
  const downloadState = useGeofenceStore((s) => s.downloadState);
  const breachStatus = useGeofenceStore((s) => s.breachStatus);
  const breachCount = useGeofenceStore((s) => s.breachCount);
  const breachType = useGeofenceStore((s) => s.breachType);

  const fenceEnable = params.get("FENCE_ENABLE") ?? 0;
  const fenceType = params.get("FENCE_TYPE") ?? 0;
  const fenceAction = params.get("FENCE_ACTION") ?? 0;
  const fenceAltMax = params.get("FENCE_ALT_MAX") ?? 100;
  const fenceAltMin = params.get("FENCE_ALT_MIN") ?? 0;
  const fenceRadius = params.get("FENCE_RADIUS") ?? 300;
  const fenceMargin = params.get("FENCE_MARGIN") ?? 2;
  const fenceTotal = params.get("FENCE_TOTAL") ?? 0;

  const hasAltFence = (fenceType & FENCE_TYPE_BITS.ALT_MAX) !== 0;
  const hasCircleFence = (fenceType & FENCE_TYPE_BITS.CIRCLE) !== 0;
  const hasPolygonFence = (fenceType & FENCE_TYPE_BITS.POLYGON) !== 0;
  const hasDirty = dirtyParams.size > 0;

  const toggleFenceTypeBit = useCallback((bit: number) => {
    const current = params.get("FENCE_TYPE") ?? 0;
    setLocalValue("FENCE_TYPE", current ^ bit);
  }, [params, setLocalValue]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    toast(ok ? "Geofence parameters saved to RAM" : "Failed to save some parameters", ok ? "success" : "error");
  }, [saveAllToRam, toast]);

  const handleFlash = useCallback(async () => {
    setCommitting(true);
    const ok = await commitToFlash();
    setCommitting(false);
    toast(ok ? "Written to flash — persists after reboot" : "Failed to write to flash", ok ? "success" : "error");
  }, [commitToFlash, toast]);

  const handleUpload = useCallback(async () => {
    await uploadFence();
    toast("Fence points uploaded to FC", "success");
  }, [uploadFence, toast]);

  const handleDownload = useCallback(async () => {
    await downloadFence();
    toast("Fence points downloaded from FC", "success");
  }, [downloadFence, toast]);

  const breachLabel = breachType === 0 ? "None" : breachType === 1 ? "Min Altitude" : breachType === 2 ? "Max Altitude" : "Boundary";

  return (
    <ArmedLockOverlay>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader title="Geofence Configuration" subtitle="Configure geographical boundary enforcement and breach actions"
            icon={<Shield size={16} />} loading={loading} loadProgress={loadProgress}
            hasLoaded={hasLoaded} onRead={refresh} connected={true} error={error} />

          <Card icon={<Shield size={14} />} title="Geofence Enable" description="Master enable for fence enforcement">
            <div className="flex items-center gap-3">
              <label className="text-xs text-text-secondary">{pl("FENCE_ENABLE")}</label>
              <button onClick={() => setLocalValue("FENCE_ENABLE", fenceEnable ? 0 : 1)}
                className={cn("w-10 h-5 rounded-full relative transition-colors", fenceEnable ? "bg-accent-primary" : "bg-bg-tertiary border border-border-default")}>
                <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", fenceEnable ? "translate-x-5" : "translate-x-0.5")} />
              </button>
              <span className="text-[10px] font-mono text-text-tertiary">{fenceEnable ? "ENABLED" : "DISABLED"}</span>
            </div>
          </Card>

          <Card icon={<MapPin size={14} />} title="Fence Type" description="Select which fence boundaries to enforce (bitmask)">
            <div className="flex gap-2">
              <FenceTypeChip label="Altitude" icon={<ArrowUp size={10} />} active={hasAltFence} onClick={() => toggleFenceTypeBit(FENCE_TYPE_BITS.ALT_MAX)} />
              <FenceTypeChip label="Circle" icon={<Circle size={10} />} active={hasCircleFence} onClick={() => toggleFenceTypeBit(FENCE_TYPE_BITS.CIRCLE)} />
              <FenceTypeChip label="Polygon" icon={<MapPin size={10} />} active={hasPolygonFence} onClick={() => toggleFenceTypeBit(FENCE_TYPE_BITS.POLYGON)} />
            </div>
            <p className="text-[10px] font-mono text-text-tertiary mt-1">FENCE_TYPE = {fenceType} (0x{fenceType.toString(16).padStart(2, "0")})</p>
          </Card>

          {hasCircleFence && (
            <Card icon={<Circle size={14} />} title="Circle Fence" description="Maximum horizontal distance from home">
              <ParamInput label={lbl("FENCE_RADIUS — Max Radius")} value={fenceRadius} unit="m" min={0} step={10} onChange={(v) => setLocalValue("FENCE_RADIUS", v)} />
              <ParamInput label={lbl("FENCE_MARGIN — Warning Margin")} value={fenceMargin} unit="m" min={0} step={1} onChange={(v) => setLocalValue("FENCE_MARGIN", v)} />
            </Card>
          )}

          {hasAltFence && (
            <Card icon={<ArrowUp size={14} />} title="Altitude Fence" description="Altitude ceiling and floor">
              <ParamInput label={lbl("FENCE_ALT_MAX — Max Altitude")} value={fenceAltMax} unit="m" min={0} step={5} onChange={(v) => setLocalValue("FENCE_ALT_MAX", v)} />
              <ParamInput label={lbl("FENCE_ALT_MIN — Min Altitude")} value={fenceAltMin} unit="m" min={-100} step={0.5} onChange={(v) => setLocalValue("FENCE_ALT_MIN", v)} />
              <AltitudeBandViz altMin={fenceAltMin} altMax={fenceAltMax} />
            </Card>
          )}

          {hasPolygonFence && (
            <Card icon={<MapPin size={14} />} title="Polygon Fence" description="Polygon boundary fence">
              <div className="text-xs text-text-secondary">Polygon vertices: <span className="font-mono text-text-primary">{fenceTotal}</span></div>
              <div className="flex gap-2 mt-2">
                <button onClick={handleUpload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border-default transition-colors text-text-primary hover:bg-bg-tertiary cursor-pointer">
                  <Upload size={10} />{uploadState === "uploading" ? "Uploading..." : "Upload Points"}
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border-default text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer">
                  <Download size={10} />{downloadState === "downloading" ? "Downloading..." : "Download Points"}
                </button>
              </div>
              {uploadState === "uploaded" && <p className="text-[10px] font-mono text-status-success mt-1">Fence points uploaded</p>}
              {downloadState === "downloaded" && <p className="text-[10px] font-mono text-status-success mt-1">Fence points downloaded</p>}
            </Card>
          )}

          <Card icon={<MapPin size={14} />} title="Zones" description="Inclusion (must stay inside) and exclusion (must stay outside) zones">
            {zones.length === 0 && <p className="text-[10px] text-text-tertiary">No zones defined. Add zones using the buttons below.</p>}
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center justify-between py-1.5 border-b border-border-default last:border-0">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", zone.role === "inclusion" ? "bg-status-success" : "bg-status-error")} />
                  <span className="text-xs text-text-primary font-mono">{zone.role === "inclusion" ? "INCL" : "EXCL"} {zone.type}</span>
                  <span className="text-[10px] text-text-tertiary">{zone.type === "polygon" ? `${zone.polygonPoints.length} pts` : `${Math.round(zone.circleRadius)}m`}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleZoneRole(zone.id)} className="p-1 text-text-tertiary hover:text-text-primary transition-colors" title="Toggle inclusion/exclusion"><ToggleLeft size={12} /></button>
                  <button onClick={() => removeZone(zone.id)} className="p-1 text-text-tertiary hover:text-status-error transition-colors" title="Remove zone"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button onClick={() => addZone({ role: "inclusion", type: "polygon", polygonPoints: [], circleCenter: null, circleRadius: 100 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors bg-status-success/10 border-status-success/30 text-status-success hover:bg-status-success/20">
                <Plus size={10} />Inclusion
              </button>
              <button onClick={() => addZone({ role: "exclusion", type: "polygon", polygonPoints: [], circleCenter: null, circleRadius: 100 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors bg-status-error/10 border-status-error/30 text-status-error hover:bg-status-error/20">
                <Plus size={10} />Exclusion
              </button>
            </div>
          </Card>

          <Card icon={<Shield size={14} />} title="Breach Action" description="Action taken when fence is breached">
            <Select label={lbl("FENCE_ACTION")} options={FENCE_ACTION_OPTIONS} value={String(fenceAction)} onChange={(v) => setLocalValue("FENCE_ACTION", Number(v))} />
          </Card>

          {breachStatus > 0 && (
            <Card icon={<Shield size={14} />} title="Breach Active" description="Current fence breach information">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-status-error animate-pulse" />
                <div>
                  <p className="text-xs text-status-error font-medium">Breach: {breachLabel}</p>
                  <p className="text-[10px] text-text-tertiary font-mono">Total breaches: {breachCount}</p>
                </div>
              </div>
            </Card>
          )}

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty} loading={saving} onClick={handleSave}>Save to RAM</Button>
            {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} loading={committing} onClick={handleFlash}>Write to Flash</Button>}
            {hasDirty && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>
    </ArmedLockOverlay>
  );
}
