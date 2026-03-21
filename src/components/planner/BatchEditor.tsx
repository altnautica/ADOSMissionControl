"use client";

/**
 * @module BatchEditor
 * @description Multi-select waypoint editing panel.
 * Shift+click and Ctrl/Cmd+click for multi-selection.
 * Bulk change altitude, speed, command, or delete selected waypoints.
 * @license GPL-3.0-only
 */

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Trash2, MountainSnow, Gauge, Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMissionStore } from "@/stores/mission-store";
import type { WaypointCommand } from "@/lib/types";

interface BatchEditorProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

const BATCH_COMMANDS: Array<{ value: string; label: string }> = [
  { value: "WAYPOINT", label: "Waypoint" },
  { value: "LOITER", label: "Loiter" },
  { value: "LOITER_TIME", label: "Loiter (Time)" },
  { value: "SPLINE_WAYPOINT", label: "Spline" },
];

export function BatchEditor({ selectedIds, onClearSelection }: BatchEditorProps) {
  const t = useTranslations("planner");
  const updateWaypoint = useMissionStore((s) => s.updateWaypoint);
  const removeWaypoint = useMissionStore((s) => s.removeWaypoint);
  const setWaypoints = useMissionStore((s) => s.setWaypoints);
  const waypoints = useMissionStore((s) => s.waypoints);

  const [batchAlt, setBatchAlt] = useState<number | null>(null);
  const [batchSpeed, setBatchSpeed] = useState<number | null>(null);
  const [batchCommand, setBatchCommand] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const count = selectedIds.length;

  const applyAltitude = useCallback(() => {
    if (batchAlt === null) return;
    for (const id of selectedIds) {
      updateWaypoint(id, { alt: batchAlt });
    }
  }, [selectedIds, batchAlt, updateWaypoint]);

  const applySpeed = useCallback(() => {
    if (batchSpeed === null) return;
    for (const id of selectedIds) {
      updateWaypoint(id, { speed: batchSpeed });
    }
  }, [selectedIds, batchSpeed, updateWaypoint]);

  const applyCommand = useCallback(() => {
    if (!batchCommand) return;
    for (const id of selectedIds) {
      updateWaypoint(id, { command: batchCommand as WaypointCommand });
    }
  }, [selectedIds, batchCommand, updateWaypoint]);

  const deleteSelected = useCallback(() => {
    const remaining = waypoints.filter((wp) => !selectedIds.includes(wp.id));
    setWaypoints(remaining);
    onClearSelection();
  }, [waypoints, selectedIds, setWaypoints, onClearSelection]);

  if (count < 2) {
    return (
      <div className="px-3 py-2">
        <p className="text-[10px] text-text-tertiary font-mono">
          {t("batchEditHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          {t("waypointsSelected", { count })}
        </span>
        <button
          onClick={onClearSelection}
          className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          {t("clear")}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <MountainSnow size={12} className="text-text-tertiary shrink-0" />
        <Input
          type="number"
          value={batchAlt ?? ""}
          onChange={(e) => setBatchAlt(e.target.value ? Number(e.target.value) : null)}
          min={0}
          max={10000}
          step={5}
          className="flex-1"
          label={t("altitudeM")}
        />
        <Button variant="ghost" size="sm" onClick={applyAltitude} disabled={batchAlt === null}>
          {t("set")}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Gauge size={12} className="text-text-tertiary shrink-0" />
        <Input
          type="number"
          value={batchSpeed ?? ""}
          onChange={(e) => setBatchSpeed(e.target.value ? Number(e.target.value) : null)}
          min={0}
          max={100}
          step={1}
          className="flex-1"
          label={t("speedMs")}
        />
        <Button variant="ghost" size="sm" onClick={applySpeed} disabled={batchSpeed === null}>
          {t("set")}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Command size={12} className="text-text-tertiary shrink-0" />
        <Select
          value={batchCommand}
          onChange={setBatchCommand}
          options={BATCH_COMMANDS}
          placeholder={t("commandPlaceholder")}
          className="flex-1"
        />
        <Button variant="ghost" size="sm" onClick={applyCommand} disabled={!batchCommand}>
          {t("set")}
        </Button>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-status-error"
        icon={<Trash2 size={12} />}
        onClick={() => setShowDeleteConfirm(true)}
      >
        {t("deleteWaypoints", { count })}
      </Button>

      <ConfirmDialog
        open={showDeleteConfirm}
        onConfirm={() => {
          deleteSelected();
          setShowDeleteConfirm(false);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        title={t("deleteWaypointsTitle")}
        message={t("deleteWaypointsConfirm", { count })}
        confirmLabel={t("delete")}
        variant="danger"
      />
    </div>
  );
}
