"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";

import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useFenceUploadStatus } from "@/hooks/use-upload-status";
import { Shield, MapPin, ArrowUp, Circle, Download, Upload, Plus, Trash2, ToggleLeft, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { FenceEnableToggle, FenceTypeBits, FENCE_TYPE_BITS, ParamInput, AltitudeBandViz } from "./geofence-components";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

// ── Constants ────────────────────────────────────────────────

const FENCE_PARAMS = [
  "FENCE_ENABLE", "FENCE_TYPE", "FENCE_ALT_MAX", "FENCE_ALT_MIN",
  "FENCE_RADIUS", "FENCE_MARGIN", "FENCE_ACTION", "FENCE_TOTAL",
];

// ── Component ────────────────────────────────────────────────

/**
 * ArduPilot geofence. PX4 has none of these params: its canonical FENCE_ENABLE
 * maps to GF_ACTION (the breach ACTION enum), so an enable toggle here would
 * rewrite a Return action to Warning. PX4's fence is set in the Failsafe
 * panel's PX4 geofence card instead.
 */
export function GeofencePanel() {
  const t = useTranslations("geofence.panel");
  const { firmwareType } = useFirmwareCapabilities();
  if (firmwareType === "px4") {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl flex items-start gap-2 p-3 border border-border-default bg-bg-secondary">
          <Info size={14} className="text-accent-primary shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">
            {t("px4Note")}
          </p>
        </div>
      </div>
    );
  }
  return <ArduPilotGeofencePanel />;
}

function ArduPilotGeofencePanel() {
  const t = useTranslations("geofence.panel");
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { label: pl } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  // FENCE_ACTION is vehicle-specific (Copter 4 = Brake or Land, Plane has
  // 0/1/6/7/8); the options come from the vehicle's metadata, shared with the
  // Failsafe panel through the same resolver.
  const { enumValues } = useParamEnums(paramMeta);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={paramMeta} />;

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: FENCE_PARAMS, panelId: "geofence", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);
  const connected = useDroneManager((s) => !!s.getSelectedProtocol());

  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);

  const zones = useGeofenceStore((s) => s.zones);
  const addZone = useGeofenceStore((s) => s.addZone);
  const removeZone = useGeofenceStore((s) => s.removeZone);
  const toggleZoneRole = useGeofenceStore((s) => s.toggleZoneRole);
  const uploadFence = useGeofenceStore((s) => s.uploadFence);
  const downloadFence = useGeofenceStore((s) => s.downloadFence);
  const clearVehicleFence = useGeofenceStore((s) => s.clearVehicleFence);
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [confirmClear, setConfirmClear] = useState(false);
  const uploadState = useGeofenceStore((s) => s.uploadState);
  const downloadState = useGeofenceStore((s) => s.downloadState);
  // "Uploaded" only while this drone holds exactly the fence shown here.
  const fenceStatus = useFenceUploadStatus();
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

  const hasCeiling = (fenceType & FENCE_TYPE_BITS.ALT_MAX) !== 0;
  const hasFloor = (fenceType & FENCE_TYPE_BITS.ALT_MIN) !== 0;
  const hasAltFence = hasCeiling || hasFloor;
  const hasCircleFence = (fenceType & FENCE_TYPE_BITS.CIRCLE) !== 0;
  const hasPolygonFence = (fenceType & FENCE_TYPE_BITS.POLYGON) !== 0;
  const hasDirty = dirtyParams.size > 0;

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    toast(ok ? t("savedToRam") : t("saveFailed"), ok ? "success" : "error");
  }, [saveAllToRam, toast, t]);

  const handleFlash = useCallback(async () => {
    setCommitting(true);
    const outcome = await commitToFlash();
    setCommitting(false);
    showFlashResult(outcome);
  }, [commitToFlash, showFlashResult]);

  const handleUpload = useCallback(async () => {
    const result = await uploadFence();
    toast(result.message, result.success ? "success" : "error");
  }, [uploadFence, toast]);

  const handleDownload = useCallback(async () => {
    const result = await downloadFence();
    toast(result.message, result.success ? "success" : "error");
  }, [downloadFence, toast]);

  const handleClearVehicleFence = useCallback(async () => {
    setConfirmClear(false);
    const result = await clearVehicleFence();
    toast(result.message, result.success ? "success" : "error");
  }, [clearVehicleFence, toast]);

  const breachLabel = breachType === 0 ? t("breachNone") : breachType === 1 ? t("breachMinAlt") : breachType === 2 ? t("breachMaxAlt") : t("breachBoundary");

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader title={t("title")} subtitle={t("subtitle")}
            icon={<Shield size={16} />} loading={loading} loadProgress={loadProgress}
            hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

          <FcSection icon={<Shield size={14} />} title={t("enableTitle")} description={t("enableDesc")}>
            <FenceEnableToggle label={pl("FENCE_ENABLE")} enabled={fenceEnable !== 0} onChange={(v) => setLocalValue("FENCE_ENABLE", v)} />
          </FcSection>

          <FcSection icon={<MapPin size={14} />} title={t("typeTitle")} description={t("typeDesc")}>
            <FenceTypeBits value={fenceType} onChange={(v) => setLocalValue("FENCE_TYPE", v)} />
          </FcSection>

          {hasCircleFence && (
            <FcSection icon={<Circle size={14} />} title={t("circleTitle")} description={t("circleDesc")}>
              <ParamInput label={lbl(`FENCE_RADIUS — ${t("maxRadius")}`)} value={fenceRadius} unit="m" min={0} step={10} onChange={(v) => setLocalValue("FENCE_RADIUS", v)} />
              <ParamInput label={lbl(`FENCE_MARGIN — ${t("warningMargin")}`)} value={fenceMargin} unit="m" min={0} step={1} onChange={(v) => setLocalValue("FENCE_MARGIN", v)} />
            </FcSection>
          )}

          {hasAltFence && (
            <FcSection icon={<ArrowUp size={14} />} title={t("altTitle")} description={t("altDesc")}>
              {hasCeiling && <ParamInput label={lbl(`FENCE_ALT_MAX — ${t("maxAltitude")}`)} value={fenceAltMax} unit="m" min={0} step={5} onChange={(v) => setLocalValue("FENCE_ALT_MAX", v)} />}
              {hasFloor && <ParamInput label={lbl(`FENCE_ALT_MIN — ${t("minAltitude")}`)} value={fenceAltMin} unit="m" min={-100} step={0.5} onChange={(v) => setLocalValue("FENCE_ALT_MIN", v)} />}
              <AltitudeBandViz altMin={hasFloor ? fenceAltMin : null} altMax={hasCeiling ? fenceAltMax : null} />
            </FcSection>
          )}

          {hasPolygonFence && (
            <FcSection icon={<MapPin size={14} />} title={t("polygonTitle")} description={t("polygonDesc")}>
              <div className="text-xs text-text-secondary">{t("polygonVertices")} <span className="font-mono text-text-primary">{fenceTotal}</span></div>
              <div className="flex gap-2 mt-2">
                <button onClick={handleUpload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border-default transition-colors text-text-primary hover:bg-bg-tertiary cursor-pointer">
                  <Upload size={10} />{uploadState === "uploading" ? t("uploading") : t("uploadPoints")}
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border-default text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer">
                  <Download size={10} />{downloadState === "downloading" ? t("downloading") : t("downloadPoints")}
                </button>
                <button onClick={() => setConfirmClear(true)} disabled={isHardBlocked} title={hardBlockMessage || undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border-default text-status-error hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <Trash2 size={10} />{t("removeFromAircraft")}
                </button>
              </div>
              {fenceStatus === "on-aircraft" && <p className="text-[10px] font-mono text-status-success mt-1">{t("pointsUploaded")}</p>}
              {fenceStatus === "older-on-aircraft" && <p className="text-[10px] font-mono text-status-warning mt-1">{t("olderOnAircraft")}</p>}
              {downloadState === "downloaded" && <p className="text-[10px] font-mono text-status-success mt-1">{t("pointsDownloaded")}</p>}
            </FcSection>
          )}
          <ConfirmDialog
            open={confirmClear}
            onConfirm={() => { void handleClearVehicleFence(); }}
            onCancel={() => setConfirmClear(false)}
            title={t("removeTitle")}
            message={t("removeMessage")}
            confirmLabel={t("removeConfirm")}
            variant="danger"
          />

          <FcSection icon={<MapPin size={14} />} title={t("zonesTitle")} description={t("zonesDesc")}>
            {zones.length === 0 && <p className="text-[10px] text-text-tertiary">{t("noZones")}</p>}
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center justify-between py-1.5 border-b border-border-default last:border-0">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", zone.role === "inclusion" ? "bg-status-success" : "bg-status-error")} />
                  <span className="text-xs text-text-primary font-mono">{zone.role === "inclusion" ? t("incl") : t("excl")} {t(`zoneType.${zone.type}`)}</span>
                  <span className="text-[10px] text-text-tertiary">{zone.type === "polygon" ? t("points", { count: zone.polygonPoints.length }) : `${Math.round(zone.circleRadius)}m`}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleZoneRole(zone.id)} className="p-1 text-text-tertiary hover:text-text-primary transition-colors" title={t("toggleRole")}><ToggleLeft size={12} /></button>
                  <button onClick={() => removeZone(zone.id)} className="p-1 text-text-tertiary hover:text-status-error transition-colors" title={t("removeZone")}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button onClick={() => addZone({ role: "inclusion", type: "polygon", polygonPoints: [], circleCenter: null, circleRadius: 100 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors bg-status-success/10 border-status-success/30 text-status-success hover:bg-status-success/20">
                <Plus size={10} />{t("inclusion")}
              </button>
              <button onClick={() => addZone({ role: "exclusion", type: "polygon", polygonPoints: [], circleCenter: null, circleRadius: 100 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors bg-status-error/10 border-status-error/30 text-status-error hover:bg-status-error/20">
                <Plus size={10} />{t("exclusion")}
              </button>
            </div>
          </FcSection>

          <FcSection icon={<Shield size={14} />} title={t("breachActionTitle")} description={t("breachActionDesc")}>
            <ParamEnumSelect label={lbl("FENCE_ACTION")} values={enumValues("FENCE_ACTION")} value={fenceAction} onChange={(v) => setLocalValue("FENCE_ACTION", v)} />
          </FcSection>

          {breachStatus > 0 && (
            <FcSection icon={<Shield size={14} />} title={t("breachActiveTitle")} description={t("breachActiveDesc")}>
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-status-error animate-pulse" />
                <div>
                  <p className="text-xs text-status-error font-medium">{t("breach", { label: breachLabel })}</p>
                  <p className="text-[10px] text-text-tertiary font-mono">{t("totalBreaches", { count: breachCount })}</p>
                </div>
              </div>
            </FcSection>
          )}

          <PanelSaveBar
            saveLabel="saveToRam"
            onSave={handleSave}
            saving={saving}
            saveDisabled={!hasDirty}
            showFlash={hasRamWrites}
            onFlash={handleFlash}
            flashing={committing}
            showUnsavedHint={hasDirty}
          />
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
