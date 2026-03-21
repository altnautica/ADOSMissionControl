/**
 * @module WaypointListItem
 * @description Individual waypoint row in the right panel list. Shows compact view
 * (sequence badge, command letter, altitude) and expandable inline editor for
 * lat/lon/alt/speed/command/hold-time. Supports drag-and-drop reordering.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { GripVertical, X, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Waypoint, WaypointCommand } from "@/lib/types";
import { usePlannerStore } from "@/stores/planner-store";
import { COMMAND_OPTIONS, CMD_LETTER } from "./waypoint-constants";
import { CommandSpecificEditors } from "./WaypointCommandEditors";

const FRAME_LABELS: Record<string, string> = { relative: "AGL", absolute: "MSL", terrain: "Terrain" };

interface WaypointListItemProps {
  waypoint: Waypoint;
  index: number;
  expanded: boolean;
  selected: boolean;
  multiSelected?: boolean;
  onToggleExpand: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (update: Partial<Waypoint>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragOver: boolean;
}

export function WaypointListItem({
  waypoint, index, expanded, selected, multiSelected = false,
  onToggleExpand, onSelect, onUpdate, onRemove,
  onDragStart, onDragOver, onDragEnd, onDrop, dragOver,
}: WaypointListItemProps) {
  const t = useTranslations("planner");
  const cmd = waypoint.command ?? "WAYPOINT";
  const letter = CMD_LETTER[cmd] ?? "W";
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  const frameLabel = FRAME_LABELS[defaultFrame] ?? "AGL";

  const [localLat, setLocalLat] = useState(waypoint.lat.toFixed(6));
  const [localLon, setLocalLon] = useState(waypoint.lon.toFixed(6));
  const [localAlt, setLocalAlt] = useState(String(waypoint.alt));
  const [localSpeed, setLocalSpeed] = useState(waypoint.speed !== undefined ? String(waypoint.speed) : "");
  const [localHoldTime, setLocalHoldTime] = useState(waypoint.holdTime !== undefined ? String(waypoint.holdTime) : "");
  const [localParam1, setLocalParam1] = useState(waypoint.param1 !== undefined ? String(waypoint.param1) : "");
  const [localParam2, setLocalParam2] = useState(waypoint.param2 !== undefined ? String(waypoint.param2) : "");
  const [localParam3, setLocalParam3] = useState(waypoint.param3 !== undefined ? String(waypoint.param3) : "");

  useEffect(() => { setLocalLat(waypoint.lat.toFixed(6)); }, [waypoint.lat]);
  useEffect(() => { setLocalLon(waypoint.lon.toFixed(6)); }, [waypoint.lon]);
  useEffect(() => { setLocalAlt(String(waypoint.alt)); }, [waypoint.alt]);
  useEffect(() => { setLocalSpeed(waypoint.speed !== undefined ? String(waypoint.speed) : ""); }, [waypoint.speed]);
  useEffect(() => { setLocalHoldTime(waypoint.holdTime !== undefined ? String(waypoint.holdTime) : ""); }, [waypoint.holdTime]);
  useEffect(() => { setLocalParam1(waypoint.param1 !== undefined ? String(waypoint.param1) : ""); }, [waypoint.param1]);
  useEffect(() => { setLocalParam2(waypoint.param2 !== undefined ? String(waypoint.param2) : ""); }, [waypoint.param2]);
  useEffect(() => { setLocalParam3(waypoint.param3 !== undefined ? String(waypoint.param3) : ""); }, [waypoint.param3]);

  const commitField = useCallback(
    (field: keyof Waypoint, value: string) => {
      if (value === "" && (field === "speed" || field === "holdTime")) { onUpdate({ [field]: undefined }); return; }
      const num = parseFloat(value);
      if (!isNaN(num)) onUpdate({ [field]: num });
    },
    [onUpdate]
  );

  return (
    <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDrop={onDrop}
      className={cn(
        "border-b border-border-default transition-colors",
        selected && "bg-accent-primary/5", multiSelected && "bg-accent-selected/5",
        dragOver && "border-t-2 border-t-accent-primary"
      )}>
      {/* Compact row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-tertiary" onClick={onSelect}>
        <GripVertical size={12} className="text-text-tertiary shrink-0 cursor-grab" />
        {multiSelected && (
          <div className="w-3 h-3 border border-accent-primary bg-accent-primary/30 shrink-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-accent-primary" />
          </div>
        )}
        <div className="w-5 h-5 flex items-center justify-center bg-accent-primary text-[10px] font-mono font-semibold text-white shrink-0">{index + 1}</div>
        <div className="w-5 h-5 flex items-center justify-center bg-bg-tertiary text-[10px] font-mono font-semibold text-text-secondary shrink-0 border border-border-default">{letter}</div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-primary truncate">{cmd}</span>
          <span className="text-[10px] font-mono text-text-tertiary">{waypoint.alt}m</span>
          <span className="text-[9px] font-mono text-accent-primary/70 bg-accent-primary/10 px-1 py-px">{frameLabel}</span>
          {waypoint.groundElevation !== undefined && (
            <span className="text-[9px] font-mono text-status-success bg-status-success/10 px-1 py-px">{t("aboveGround", { alt: Math.round(waypoint.alt), elev: Math.round(waypoint.groundElevation) })}</span>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} className="text-text-tertiary hover:text-text-primary shrink-0 cursor-pointer">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-text-tertiary hover:text-status-error transition-colors shrink-0 cursor-pointer">
          <X size={12} />
        </button>
      </div>

      {/* Expanded inline edit */}
      {expanded && (
        <div className="px-3 pb-2 pt-1 flex flex-col gap-2 bg-bg-tertiary/50">
          <div className="grid grid-cols-2 gap-2">
            <Input label={t("lat")} type="number" step="0.0001" value={localLat}
              onChange={(e) => setLocalLat(e.target.value)} onBlur={() => commitField("lat", localLat)} />
            <Input label={t("lon")} type="number" step="0.0001" value={localLon}
              onChange={(e) => setLocalLon(e.target.value)} onBlur={() => commitField("lon", localLon)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t("altitude")} type="number" unit="m" value={localAlt}
              onChange={(e) => setLocalAlt(e.target.value)} onBlur={() => commitField("alt", localAlt)} />
            <Input label={t("speed")} type="number" unit="m/s" placeholder={t("default")} value={localSpeed}
              onChange={(e) => setLocalSpeed(e.target.value)} onBlur={() => commitField("speed", localSpeed)} />
          </div>
          <Select label={t("command")} options={COMMAND_OPTIONS} value={cmd}
            onChange={(v) => onUpdate({ command: v as WaypointCommand })} />
          <CommandSpecificEditors
            cmd={cmd} waypoint={waypoint}
            localParam1={localParam1} localParam2={localParam2} localParam3={localParam3} localHoldTime={localHoldTime}
            setLocalParam1={setLocalParam1} setLocalParam2={setLocalParam2} setLocalParam3={setLocalParam3} setLocalHoldTime={setLocalHoldTime}
            commitField={commitField} onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}
