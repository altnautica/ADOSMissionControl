/**
 * @module RallyPointEditor
 * @description Rally (safe return) point editor panel. Allows adding, editing,
 * uploading, and downloading rally points. Rally points are alternate landing
 * locations the FC can use during failsafe events.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Upload, Download, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useRallyStore, type RallyPoint } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useRallyUploadStatus } from "@/hooks/use-upload-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { recordHistory } from "@/lib/planner-history";

export function RallyPointEditor() {
  const t = useTranslations("rally");
  // Rally placement is the single sticky "rally" tool — keep clicking to drop
  // several points. The panel button is just another way to arm the same tool.
  const activeTool = usePlannerStore((s) => s.activeTool);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const addingRallyPoint = activeTool === "rally";
  const points = useRallyStore((s) => s.points);
  const removePoint = useRallyStore((s) => s.removePoint);
  const updatePoint = useRallyStore((s) => s.updatePoint);
  const clearPoints = useRallyStore((s) => s.clearPoints);
  const uploadRallyPoints = useRallyStore((s) => s.uploadRallyPoints);
  const downloadRallyPoints = useRallyStore((s) => s.downloadRallyPoints);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // The last transfer's failure, shown until the next attempt. Success is not
  // latched here: "uploaded" is derived from the upload receipt, so an edit
  // or a drone switch changes it immediately.
  const [transferError, setTransferError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const uploadStatus = useRallyUploadStatus();
  // Transfers need a selected flight controller that speaks the rally protocol.
  const canUpload = useDroneManager((s) => !!s.getSelectedProtocol()?.uploadRallyPoints);
  const canDownload = useDroneManager((s) => !!s.getSelectedProtocol()?.downloadRallyPoints);

  const handleUpload = useCallback(async () => {
    setUploading(true);
    setTransferError(null);
    const r = await uploadRallyPoints();
    if (!r.success) setTransferError(`${t("rallyUploadFailed")}: ${r.message}`);
    setUploading(false);
  }, [uploadRallyPoints, t]);

  const runDownload = useCallback(async () => {
    setConfirmReplace(false);
    setDownloading(true);
    setTransferError(null);
    // The undo step is recorded only when the download succeeded and is about
    // to replace the local points.
    const r = await downloadRallyPoints(recordHistory);
    if (!r.success) setTransferError(`${t("downloadFailed")}: ${r.message}`);
    setDownloading(false);
  }, [downloadRallyPoints, t]);

  const handleDownload = useCallback(() => {
    if (points.length > 0) setConfirmReplace(true);
    else void runDownload();
  }, [points.length, runDownload]);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setActiveTool(addingRallyPoint ? "select" : "rally")}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono border cursor-pointer transition-colors ${
            addingRallyPoint
              ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
              : "bg-bg-tertiary border-border-default text-text-secondary hover:text-text-primary"
          }`}
        >
          <Plus size={10} />
          {t("addRally")}
        </button>
        <button
          onClick={handleUpload}
          disabled={uploading || points.length === 0 || !canUpload}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Upload size={10} />
          {uploading ? "..." : t("uploadRally")}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading || !canDownload}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Download size={10} />
          {downloading ? "..." : t("downloadRally")}
        </button>
        <button
          onClick={() => clearPoints()}
          disabled={points.length === 0}
          title="Clear all rally points"
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-status-error disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Rally point list */}
      {points.length === 0 ? (
        <p className="text-[10px] text-text-tertiary font-mono py-1">
          {t("noRallyPoints")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {points.map((point, idx) => (
            <RallyPointRow
              key={point.id}
              point={point}
              index={idx}
              onUpdate={updatePoint}
              onRemove={removePoint}
            />
          ))}
        </div>
      )}

      {uploadStatus === "on-aircraft" && (
        <p className="text-[10px] text-status-success font-mono">
          {t("rallyUploaded")}
        </p>
      )}
      {uploadStatus === "older-on-aircraft" && (
        <p className="text-[10px] text-status-warning font-mono">
          {t("olderRallyOnAircraft")}
        </p>
      )}
      {transferError && (
        <p className="text-[10px] text-status-error font-mono">{transferError}</p>
      )}

      {addingRallyPoint && (
        <p className="text-[10px] text-accent-primary font-mono animate-pulse">
          {t("clickToAdd")}
        </p>
      )}

      <ConfirmDialog
        open={confirmReplace}
        title={t("downloadRally")}
        message={t("replaceLocalConfirm", { count: points.length })}
        onConfirm={() => void runDownload()}
        onCancel={() => setConfirmReplace(false)}
      />
    </div>
  );
}

// ── Individual rally point row ────────────────────────────────

interface RallyPointRowProps {
  point: RallyPoint;
  index: number;
  onUpdate: (id: string, update: Partial<RallyPoint>) => void;
  onRemove: (id: string) => void;
}

function RallyPointRow({ point, index, onUpdate, onRemove }: RallyPointRowProps) {
  const [localLat, setLocalLat] = useState(point.lat.toFixed(6));
  const [localLon, setLocalLon] = useState(point.lon.toFixed(6));
  const [localAlt, setLocalAlt] = useState(String(point.alt));

  const commitLat = useCallback(() => {
    const v = parseFloat(localLat);
    if (!isNaN(v) && v >= -90 && v <= 90) onUpdate(point.id, { lat: v });
    else setLocalLat(point.lat.toFixed(6));
  }, [localLat, point.id, point.lat, onUpdate]);

  const commitLon = useCallback(() => {
    const v = parseFloat(localLon);
    if (!isNaN(v) && v >= -180 && v <= 180) onUpdate(point.id, { lon: v });
    else setLocalLon(point.lon.toFixed(6));
  }, [localLon, point.id, point.lon, onUpdate]);

  const commitAlt = useCallback(() => {
    const v = parseFloat(localAlt);
    if (!isNaN(v) && v >= 0) onUpdate(point.id, { alt: v });
    else setLocalAlt(String(point.alt));
  }, [localAlt, point.id, point.alt, onUpdate]);

  return (
    <div className="flex items-start gap-1.5 p-1.5 bg-bg-tertiary/50 border border-border-default">
      {/* Index badge */}
      <div className="flex items-center justify-center w-5 h-5 shrink-0 mt-0.5">
        <MapPin size={12} className="text-status-warning" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-mono font-semibold text-text-secondary">
          R{index + 1}
        </span>
        <div className="grid grid-cols-3 gap-1 mt-1">
          <Input
            label="Lat"
            type="number"
            step="0.0001"
            value={localLat}
            onChange={(e) => setLocalLat(e.target.value)}
            onBlur={commitLat}
          />
          <Input
            label="Lon"
            type="number"
            step="0.0001"
            value={localLon}
            onChange={(e) => setLocalLon(e.target.value)}
            onBlur={commitLon}
          />
          <Input
            label="Alt"
            type="number"
            unit="m"
            value={localAlt}
            onChange={(e) => setLocalAlt(e.target.value)}
            onBlur={commitAlt}
          />
        </div>
      </div>
      <button
        onClick={() => onRemove(point.id)}
        className="text-text-tertiary hover:text-status-error transition-colors shrink-0 mt-0.5 cursor-pointer"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
