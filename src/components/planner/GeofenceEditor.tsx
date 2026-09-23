/**
 * @module GeofenceEditor
 * @description Geofence configuration panel. Binds directly to geofence-store
 * for enable/type/altitude/action so the drawn boundary, validation, simulation,
 * and FC upload all read the same source of truth.
 * Supports circle/polygon fence types with upload/download to FC.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useGeofenceStore } from "@/stores/geofence-store";
import type { FenceType, BreachAction } from "@/stores/geofence-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useMissionStore } from "@/stores/mission-store";
import { useFenceUploadStatus } from "@/hooks/use-upload-status";
import { Upload, Download, Pentagon, Circle, Trash2, ShieldPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Resolve the boundary the auto-fence should wrap. Prefers an active
 * pattern/survey boundary (survey polygon, structure-scan polygon, corridor
 * path) and falls back to the current mission's waypoint set. Returns an empty
 * list when nothing is available.
 */
function resolveBoundaryPoints(): [number, number][] {
  const pattern = usePatternStore.getState();
  const survey = pattern.surveyConfig.polygon;
  if (survey && survey.length >= 3) return survey;
  const structure = pattern.structureScanConfig.structurePolygon;
  if (structure && structure.length >= 3) return structure;
  const corridor = pattern.corridorConfig.pathPoints;
  if (corridor && corridor.length >= 2) return corridor;
  const waypoints = useMissionStore.getState().waypoints;
  if (waypoints.length > 0) {
    return waypoints.map((w) => [w.lat, w.lon] as [number, number]);
  }
  return [];
}

interface GeofenceEditorProps {
  /** Enter a draw tool for the given fence shape. */
  onDrawOnMap?: (type: "polygon" | "circle") => void;
}

export function GeofenceEditor({ onDrawOnMap }: GeofenceEditorProps) {
  const t = useTranslations("geofence");
  const { toast } = useToast();

  const [autoFenceBuffer, setAutoFenceBuffer] = useState(50);
  // The max-altitude field text. Only a positive number reaches the store:
  // an empty field is not "no ceiling" (that silently disabled the validator's
  // FENCE_ALT_MAX check), it is an input error.
  const [maxAltText, setMaxAltText] = useState<string | null>(null);

  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const breachAction = useGeofenceStore((s) => s.breachAction);
  const setEnabled = useGeofenceStore((s) => s.setEnabled);
  const setFenceType = useGeofenceStore((s) => s.setFenceType);
  const setMaxAltitude = useGeofenceStore((s) => s.setMaxAltitude);
  const setBreachAction = useGeofenceStore((s) => s.setBreachAction);
  const generateFromBoundary = useGeofenceStore((s) => s.generateFromBoundary);
  const uploadFence = useGeofenceStore((s) => s.uploadFence);
  const downloadFence = useGeofenceStore((s) => s.downloadFence);
  const clearFence = useGeofenceStore((s) => s.clearFence);
  const uploadState = useGeofenceStore((s) => s.uploadState);
  const fenceStatus = useFenceUploadStatus();
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);

  const GEOFENCE_TYPE_OPTIONS = useMemo(() => [
    { value: "circle", label: t("circle") },
    { value: "polygon", label: t("polygon") },
  ], [t]);

  const GEOFENCE_ACTION_OPTIONS = useMemo(() => [
    { value: "RTL", label: t("rtlOrLand") },
    { value: "LAND", label: t("land") },
    { value: "REPORT", label: t("report") },
  ], [t]);

  const hasFenceGeometry =
    fenceType === "polygon" ? polygonPoints.length >= 3 : circleCenter !== null;

  const handleAutoFence = () => {
    const boundary = resolveBoundaryPoints();
    if (boundary.length === 0) {
      toast(t("autoFenceNoBoundary"), "info");
      return;
    }
    generateFromBoundary(boundary, autoFenceBuffer);
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex items-center justify-between">
        <Toggle label={t("enableGeofence")} checked={enabled} onChange={setEnabled} />
        <Badge variant={enabled ? "success" : "neutral"} size="sm">
          {enabled ? t("active") : t("off")}
        </Badge>
      </div>

      {/* One-click fence around the current mission/pattern boundary. */}
      <div className="flex items-end gap-2 border-t border-border-default pt-2">
        <div className="flex-1">
          <Input
            label={t("autoFenceBuffer")}
            type="number"
            unit="m"
            min={0}
            value={String(autoFenceBuffer)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setAutoFenceBuffer(Number.isFinite(v) && v >= 0 ? v : 0);
            }}
            placeholder="50"
          />
        </div>
        <button
          type="button"
          onClick={handleAutoFence}
          title={t("autoFence")}
          className="flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-mono
            text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10
            transition-colors cursor-pointer whitespace-nowrap"
        >
          <ShieldPlus size={12} />
          {t("autoFence")}
        </button>
      </div>

      {enabled && (
        <>
          <Select
            label={t("type")}
            options={GEOFENCE_TYPE_OPTIONS}
            value={fenceType}
            onChange={(v) => setFenceType(v as FenceType)}
          />
          <Input
            label={t("maxAltitude")}
            type="number"
            unit="m"
            value={maxAltText ?? String(maxAltitude)}
            onChange={(e) => {
              setMaxAltText(e.target.value);
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0) setMaxAltitude(v);
            }}
            onBlur={() => setMaxAltText(null)}
            error={maxAltText !== null && !(parseFloat(maxAltText) > 0) ? t("maxAltitudeRequired") : undefined}
            placeholder="120"
          />
          <Select
            label={t("fenceAction")}
            options={GEOFENCE_ACTION_OPTIONS}
            value={breachAction}
            onChange={(v) => setBreachAction(v as BreachAction)}
          />

          {/* Draw on Map button */}
          {onDrawOnMap && (
            <button
              onClick={() => onDrawOnMap(fenceType === "polygon" ? "polygon" : "circle")}
              className="flex items-center justify-center gap-2 py-1.5 text-xs font-mono
                text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10
                transition-colors cursor-pointer"
            >
              {fenceType === "polygon" ? <Pentagon size={12} /> : <Circle size={12} />}
              {t("drawOnMap")}
            </button>
          )}

          {/* Fence geometry status */}
          <div className="text-[10px] font-mono text-text-tertiary">
            {fenceType === "polygon" && polygonPoints.length > 0 && (
              <span>{t("fencePointsDefined", { count: polygonPoints.length })}</span>
            )}
            {fenceType === "circle" && circleCenter && (
              <span>{t("circleFenceSet")}</span>
            )}
            {!hasFenceGeometry && (
              <span>{t("noFenceBoundary")}</span>
            )}
          </div>

          {/* Upload / Download buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { void uploadFence().then((r) => { if (!r.success) toast(r.message, "error"); }); }}
              disabled={!hasFenceGeometry}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono transition-colors cursor-pointer",
                "border border-border-default",
                hasFenceGeometry
                  ? "text-text-primary hover:bg-bg-tertiary"
                  : "text-text-tertiary opacity-50 cursor-not-allowed"
              )}
            >
              <Upload size={12} />
              {uploadState === "uploading" ? t("uploading") : t("uploadFence")}
            </button>
            <button
              onClick={() => {
                void downloadFence().then((r) => toast(r.message, r.success ? "success" : "error"));
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono
                text-text-primary border border-border-default hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              <Download size={12} />
              {t("download")}
            </button>
            <button
              onClick={() => clearFence()}
              disabled={!hasFenceGeometry}
              title="Clear fence"
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-mono transition-colors cursor-pointer border border-border-default",
                hasFenceGeometry
                  ? "text-text-secondary hover:text-status-error hover:border-status-error/40"
                  : "text-text-tertiary opacity-50 cursor-not-allowed"
              )}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {fenceStatus === "on-aircraft" && (
            <div className="text-[10px] font-mono text-status-success">{t("fenceUploaded")}</div>
          )}
          {fenceStatus === "older-on-aircraft" && uploadState !== "error" && (
            <div className="text-[10px] font-mono text-status-warning">{t("olderFenceOnAircraft")}</div>
          )}
          {uploadState === "error" && (
            <div className="text-[10px] font-mono text-status-error">{t("uploadFailed")}</div>
          )}
        </>
      )}
    </div>
  );
}
