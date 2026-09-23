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
import { NumericField } from "@/components/ui/numeric-field";
import { useRallyStore, type RallyPoint } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useRallyUploadStatus } from "@/hooks/use-upload-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { recordHistory } from "@/lib/planner-history";

export function RallyPointEditor() {
  const t = useTranslations("rally");
  const tCommon = useTranslations("common");
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
  const [confirmClear, setConfirmClear] = useState(false);
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

  // Every panel edit is one undo step, recorded before the change lands.
  const handleUpdate = useCallback((id: string, update: Partial<RallyPoint>) => {
    recordHistory();
    updatePoint(id, update);
  }, [updatePoint]);
  const handleRemove = useCallback((id: string) => {
    recordHistory();
    removePoint(id);
  }, [removePoint]);
  const handleClear = useCallback(() => {
    setConfirmClear(false);
    recordHistory();
    clearPoints();
  }, [clearPoints]);

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
          onClick={() => setConfirmClear(true)}
          disabled={points.length === 0}
          title={t("clearRally")}
          aria-label={t("clearRally")}
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
              onUpdate={handleUpdate}
              onRemove={handleRemove}
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
      <ConfirmDialog
        open={confirmClear}
        title={t("clearRally")}
        message={t("clearAllConfirm", { count: points.length })}
        variant="danger"
        confirmLabel={tCommon("delete")}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
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
  // Fields follow the point, so a map drag shows here at once and a later blur
  // never writes the pre-drag coordinates back.
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
          <NumericField label="Lat" step="0.0001" min={-90} max={90} value={point.lat}
            onCommit={(lat) => onUpdate(point.id, { lat })} />
          <NumericField label="Lon" step="0.0001" min={-180} max={180} value={point.lon}
            onCommit={(lon) => onUpdate(point.id, { lon })} />
          <NumericField label="Alt" unit="m" min={0} value={point.alt}
            onCommit={(alt) => onUpdate(point.id, { alt })} />
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
