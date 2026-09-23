/**
 * @module PoiEditor
 * @description Plan-attached Points of Interest editor panel. Add, label,
 * annotate, reposition, and remove POIs. A POI is a pure GCS planning
 * annotation (a labelled marker with an optional note) — NOT an FC concept — so
 * there is no upload/download, only map rendering and save/load with the plan.
 * Mirrors {@link module:RallyPointEditor}.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { MapPinned, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumericField } from "@/components/ui/numeric-field";
import { useSyncedDraft } from "@/hooks/use-synced-draft";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePlanPoiStore, type PointOfInterest } from "@/stores/plan-poi-store";
import { usePlannerStore } from "@/stores/planner-store";

export function PoiEditor() {
  const t = useTranslations("poi");
  const tCommon = useTranslations("common");
  // POI placement is the single sticky "poi" tool — keep clicking to drop
  // several points. The panel button is just another way to arm the same tool.
  const activeTool = usePlannerStore((s) => s.activeTool);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const addingPoi = activeTool === "poi";
  const points = usePlanPoiStore((s) => s.points);
  const selectedId = usePlanPoiStore((s) => s.selectedId);
  const select = usePlanPoiStore((s) => s.select);
  const removePoint = usePlanPoiStore((s) => s.removePoint);
  const updatePoint = usePlanPoiStore((s) => s.updatePoint);
  const clearPoints = usePlanPoiStore((s) => s.clearPoints);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = useCallback(() => {
    setConfirmClear(false);
    clearPoints();
  }, [clearPoints]);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setActiveTool(addingPoi ? "select" : "poi")}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono border cursor-pointer transition-colors ${
            addingPoi
              ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
              : "bg-bg-tertiary border-border-default text-text-secondary hover:text-text-primary"
          }`}
        >
          <Plus size={10} />
          {t("add")}
        </button>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={points.length === 0}
          title={t("clear")}
          aria-label={t("clear")}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-bg-tertiary border border-border-default text-text-secondary hover:text-status-error disabled:opacity-40 cursor-pointer transition-colors"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* POI list */}
      {points.length === 0 ? (
        <p className="text-[10px] text-text-tertiary font-mono py-1">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {points.map((point, idx) => (
            <PoiRow
              key={point.id}
              point={point}
              index={idx}
              selected={point.id === selectedId}
              onSelect={select}
              onUpdate={updatePoint}
              onRemove={removePoint}
            />
          ))}
        </div>
      )}

      {addingPoi && (
        <p className="text-[10px] text-accent-primary font-mono animate-pulse">{t("placeHint")}</p>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={t("clear")}
        message={t("clearAllConfirm", { count: points.length })}
        variant="danger"
        confirmLabel={tCommon("delete")}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

// ── Individual POI row ────────────────────────────────────────

interface PoiRowProps {
  point: PointOfInterest;
  index: number;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, update: Partial<PointOfInterest>) => void;
  onRemove: (id: string) => void;
}

function PoiRow({ point, index, selected, onSelect, onUpdate, onRemove }: PoiRowProps) {
  const t = useTranslations("poi");
  // Drafts follow the point, so an undo or redo never gets reverted by a blur.
  const [localLabel, setLocalLabel] = useSyncedDraft(point.label ?? "");
  const [localNote, setLocalNote] = useSyncedDraft(point.note ?? "");

  // A blur that changed nothing writes nothing (and records no undo step).
  const commitLabel = useCallback(() => {
    const v = localLabel.trim() || undefined;
    if (v !== point.label) onUpdate(point.id, { label: v });
  }, [localLabel, point.id, point.label, onUpdate]);

  const commitNote = useCallback(() => {
    const v = localNote.trim() || undefined;
    if (v !== point.note) onUpdate(point.id, { note: v });
  }, [localNote, point.id, point.note, onUpdate]);

  return (
    <div
      onClick={() => onSelect(point.id)}
      className={`flex items-start gap-1.5 p-1.5 border cursor-pointer transition-colors ${
        selected
          ? "bg-accent-primary/10 border-accent-primary"
          : "bg-bg-tertiary/50 border-border-default hover:border-border-strong"
      }`}
    >
      {/* Index badge */}
      <div className="flex items-center justify-center w-5 h-5 shrink-0 mt-0.5">
        <MapPinned size={12} className="text-accent-secondary" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-mono font-semibold text-text-secondary">P{index + 1}</span>
        <div className="mt-1 flex flex-col gap-1">
          <Input
            label={t("label")}
            type="text"
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={commitLabel}
          />
          <div className="grid grid-cols-2 gap-1">
            {/* Coordinates follow the point, so a map drag never gets reverted by a blur. */}
            <NumericField label="Lat" step="0.0001" min={-90} max={90} value={point.lat}
              onCommit={(lat) => onUpdate(point.id, { lat })} />
            <NumericField label="Lon" step="0.0001" min={-180} max={180} value={point.lon}
              onCommit={(lon) => onUpdate(point.id, { lon })} />
          </div>
          <Input
            label={t("note")}
            type="text"
            value={localNote}
            onChange={(e) => setLocalNote(e.target.value)}
            onBlur={commitNote}
          />
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(point.id);
        }}
        title={t("remove")}
        className="text-text-tertiary hover:text-status-error transition-colors shrink-0 mt-0.5 cursor-pointer"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
