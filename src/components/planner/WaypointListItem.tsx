/**
 * @module WaypointListItem
 * @description Individual waypoint row in the right panel list. Shows compact view
 * (sequence badge, command letter, altitude) and expandable inline editor for
 * lat/lon/alt/speed/command/hold-time. Supports drag-and-drop reordering.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { GripVertical, X, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { NavCommand, Waypoint, WaypointCommand } from "@/lib/types";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { waypointAltitudeAgl } from "@/lib/mission/altitude-frame";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { useDroneManager } from "@/stores/drone-manager";
import { NAV_COMMAND_OPTIONS, CMD_LETTER, INAV_ACTION_COMMANDS } from "./waypoint-constants";
import { cmdMap } from "@/lib/mission-io-formats";
import { useSupportedMissionCommands } from "@/hooks/use-supported-mission-commands";
import { CommandSpecificEditors, INavCommandEditors } from "./WaypointCommandEditors";
import { WaypointActionTimeline } from "./WaypointActionTimeline";

/** Altitude datum badge: relative altitudes are above home, not above ground. */
const FRAME_LABELS: Record<string, string> = { relative: "REL", absolute: "MSL", terrain: "Terrain" };

// ── iNav action options ───────────────────────────────────────

/**
 * The iNav waypoint actions that own a position, each mapped onto the
 * navigation command the mission model and the iNav translator share. SET_POI,
 * JUMP and SET_HEAD are attached actions (ROI, DO_JUMP, CONDITION_YAW).
 */
const INAV_ACTION_OPTIONS: { value: NavCommand; label: string }[] = [
  { value: "WAYPOINT",    label: "WAYPOINT" },
  { value: "LOITER",      label: "POSHOLD_UNLIM" },
  { value: "LOITER_TIME", label: "POSHOLD_TIME" },
  { value: "RTL",         label: "RTH" },
  { value: "LAND",        label: "LAND" },
];

/** iNav action name per navigation command, for the compact row. */
const INAV_ACTION_LABEL: Record<string, string> = Object.fromEntries(
  INAV_ACTION_OPTIONS.map((o) => [o.value, o.label]),
);

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
  // Hide nav commands the connected firmware would reject (e.g. PX4 rejects the
  // ArduPilot-only spline waypoint). null = no restriction, so show all. The
  // current command is always kept so an already-set waypoint still displays it.
  const supportedCmds = useSupportedMissionCommands();
  const navOptions = useMemo(() => {
    if (!supportedCmds) return NAV_COMMAND_OPTIONS;
    return NAV_COMMAND_OPTIONS.filter(
      (o) => o.value === cmd || supportedCmds.has(cmdMap[o.value]),
    );
  }, [supportedCmds, cmd]);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  // Badge the waypoint's OWN altitude reference (imported waypoints carry their
  // own frame); fall back to the mission default only when the waypoint has none.
  const frameLabel = FRAME_LABELS[waypoint.frame ?? defaultFrame] ?? "REL";
  // Terrain clearance below this waypoint: its altitude resolved in its own
  // frame against the launch point's terrain (the first waypoint's sample).
  const homeGroundElevation = useMissionStore((s) => s.waypoints[0]?.groundElevation);
  const clearance = waypointAltitudeAgl(waypoint, { homeGroundElevation, defaultFrame });

  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getProtocol();
  const isInav = protocol?.getVehicleInfo()?.firmwareType === "inav";

  // The compact row names the iNav action when the connected firmware is iNav,
  // otherwise the MAVLink command. Both derive from the one `command` field.
  const rowLabel = isInav ? (INAV_ACTION_LABEL[cmd] ?? cmd) : cmd;
  const rowLetter = CMD_LETTER[cmd] ?? "W";
  const inavOptions = INAV_ACTION_LABEL[cmd]
    ? INAV_ACTION_OPTIONS
    : [...INAV_ACTION_OPTIONS, { value: cmd, label: cmd }];

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
        selected && "bg-accent-primary/5", multiSelected && "bg-accent-secondary/5",
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
        <div className="w-5 h-5 flex items-center justify-center bg-bg-tertiary text-[10px] font-mono font-semibold text-text-secondary shrink-0 border border-border-default">{rowLetter}</div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-primary truncate">{rowLabel}</span>
          <span className="text-[10px] font-mono text-text-tertiary">{waypoint.alt}m</span>
          <span className="text-[9px] font-mono text-accent-primary/70 bg-accent-primary/10 px-1 py-px">{frameLabel}</span>
          {waypoint.groundElevation !== undefined && clearance !== null && (
            <span className={cn(
              "text-[9px] font-mono px-1 py-px",
              clearance < 0 ? "text-status-error bg-status-error/10"
                : clearance < DEFAULT_MIN_TERRAIN_CLEARANCE ? "text-status-warning bg-status-warning/10"
                : "text-status-success bg-status-success/10",
            )}>{t("aboveGround", { alt: Math.round(clearance), elev: Math.round(waypoint.groundElevation) })}</span>
          )}
          {(waypoint.actions?.length ?? 0) > 0 && (
            <span
              title={t("actions.chipTitle", { count: waypoint.actions!.length })}
              className="text-[9px] font-mono text-accent-secondary bg-accent-secondary/10 px-1 py-px flex items-center gap-0.5 shrink-0"
            >
              <Zap size={8} />{waypoint.actions!.length}
            </span>
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
          {isInav ? (
            <>
              <Select label="Action" options={inavOptions} value={cmd}
                onChange={(v) => {
                  // A new action starts from clean slots: a stale hold time would
                  // turn a WAYPOINT into a timed position hold on upload.
                  onUpdate({ command: v as NavCommand, holdTime: undefined, param1: undefined, param2: undefined, param3: undefined });
                }} />
              <INavCommandEditors
                cmd={cmd}
                localParam1={localParam1} localHoldTime={localHoldTime}
                setLocalParam1={setLocalParam1} setLocalHoldTime={setLocalHoldTime}
                commitField={commitField}
              />
              <WaypointActionTimeline waypoint={waypoint} onUpdate={onUpdate} allowedCommands={INAV_ACTION_COMMANDS} />
            </>
          ) : (
            <>
              <Select label={t("command")} options={navOptions} value={cmd}
                onChange={(v) => onUpdate({ command: v as WaypointCommand })} />
              <CommandSpecificEditors
                cmd={cmd} params={waypoint}
                localParam1={localParam1} localParam2={localParam2} localParam3={localParam3} localHoldTime={localHoldTime}
                setLocalParam1={setLocalParam1} setLocalParam2={setLocalParam2} setLocalParam3={setLocalParam3} setLocalHoldTime={setLocalHoldTime}
                commitField={commitField} onUpdate={onUpdate}
              />
              <WaypointActionTimeline waypoint={waypoint} onUpdate={onUpdate} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
