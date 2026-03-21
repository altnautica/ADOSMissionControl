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

interface RallyPointEditorProps {
  /** When true, the next map click will place a rally point. */
  addingRallyPoint: boolean;
  /** Toggle the "adding rally point" mode. */
  onToggleAdding: (adding: boolean) => void;
}

export function RallyPointEditor({
  addingRallyPoint,
  onToggleAdding,
}: RallyPointEditorProps) {
  const t = useTranslations("rally");
  const points = useRallyStore((s) => s.points);
  const removePoint = useRallyStore((s) => s.removePoint);
  const updatePoint = useRallyStore((s) => s.updatePoint);
  const uploadRallyPoints = useRallyStore((s) => s.uploadRallyPoints);
  const downloadRallyPoints = useRallyStore((s) => s.downloadRallyPoints);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"success" | "error" | null>(null);

  const handleUpload = useCallback(async () => {
    setUploading(true);
    setUploadStatus(null);
    try {
      await uploadRallyPoints();
      setUploadStatus("success");
      setTimeout(() => setUploadStatus(null), 3000);
    } catch {
      setUploadStatus("error");
      setTimeout(() => setUploadStatus(null), 3000);
    } finally {
      setUploading(false);
    }
  }, [uploadRallyPoints]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadRallyPoints();
    } finally {
      setDownloading(false);
    }
  }, [downloadRallyPoints]);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onToggleAdding(!addingRallyPoint)}
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
          disabled={uploading || points.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Upload size={10} />
          {uploading ? "..." : t("uploadRally")}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Download size={10} />
          {downloading ? "..." : t("downloadRally")}
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

      {uploadStatus === "success" && (
        <p className="text-[10px] text-status-success font-mono">
          {t("rallyUploaded")}
        </p>
      )}
      {uploadStatus === "error" && (
        <p className="text-[10px] text-status-error font-mono">
          {t("rallyUploadFailed")}
        </p>
      )}

      {addingRallyPoint && (
        <p className="text-[10px] text-accent-primary font-mono animate-pulse">
          {t("clickToAdd")}
        </p>
      )}
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
