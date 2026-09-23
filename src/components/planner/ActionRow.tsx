/**
 * @module ActionRow
 * @description One attached action inside a waypoint's action timeline: a compact
 * row (grip, type icon, label, key-parameter summary) that expands to an inline
 * parameter editor. DO_JUMP gets a target-waypoint picker; every other action
 * reuses the shared per-command parameter editors.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  GripVertical, X, ChevronDown, ChevronRight,
  Camera, Move3d, Crosshair, EyeOff, Gauge, RotateCw, SlidersHorizontal,
  Grab, ArrowDownUp, ToggleRight, CornerUpRight, Timer, Ruler, Shield, Home, Hash,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  ActionCommand, CommandMissionAction, MissionAction, RawMissionAction,
} from "@/lib/types";
import { CommandSpecificEditors } from "./WaypointCommandEditors";

/** Lucide icon per action command. */
const ACTION_ICON: Record<ActionCommand, LucideIcon> = {
  DO_SET_CAM_TRIGG: Camera,
  DO_DIGICAM: Camera,
  DO_MOUNT_CONTROL: Move3d,
  ROI: Crosshair,
  DO_SET_ROI_NONE: EyeOff,
  DO_SET_SPEED: Gauge,
  CONDITION_YAW: RotateCw,
  DO_SET_SERVO: SlidersHorizontal,
  DO_GRIPPER: Grab,
  DO_WINCH: ArrowDownUp,
  DO_AUX_FUNCTION: ToggleRight,
  DO_JUMP: CornerUpRight,
  DELAY: Timer,
  CONDITION_DISTANCE: Ruler,
  DO_FENCE_ENABLE: Shield,
  DO_SET_HOME: Home,
};

/** One selectable jump target: a navigation waypoint's id + its 1-based label. */
export interface NavTarget {
  id: string;
  label: string;
}

/**
 * A short, mostly unit-based summary of an action's key parameters, shown on the
 * compact row (e.g. "5 m/s", "90°", "→ WP2 ×3"). Returns "" when there is nothing
 * meaningful to summarize.
 */
function summarize(action: CommandMissionAction, targets: NavTarget[]): string {
  const p1 = action.param1;
  const p2 = action.param2;
  switch (action.command) {
    case "DO_SET_SPEED": return p2 !== undefined ? `${p2} m/s` : "";
    case "DO_SET_CAM_TRIGG": return p1 ? `every ${p1} m` : "";
    case "CONDITION_YAW": return p1 !== undefined ? `${p1}°` : "";
    case "DELAY": return p1 !== undefined ? `${p1} s` : "";
    case "CONDITION_DISTANCE": return p1 !== undefined ? `${p1} m` : "";
    case "DO_MOUNT_CONTROL": return p1 !== undefined ? `pitch ${p1}°` : "";
    case "DO_SET_SERVO": return p1 !== undefined && p2 !== undefined ? `#${p1} · ${p2} us` : "";
    case "DO_FENCE_ENABLE": return p1 ? "enable" : "disable";
    case "DO_JUMP": {
      const target = action.jumpTargetId ? targets.find((t) => t.id === action.jumpTargetId) : undefined;
      const rep = p2 && p2 > 1 ? ` ×${p2}` : "";
      return target ? `→ ${target.label}${rep}` : "→ ?";
    }
    default: return "";
  }
}

interface ActionRowProps {
  action: MissionAction;
  /** Navigation waypoints a DO_JUMP may target (excludes non-nav rows). */
  targets: NavTarget[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (update: Partial<CommandMissionAction>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragOver: boolean;
}

/** One attached action: an editable modelled command or a read-only raw item. */
export function ActionRow(props: ActionRowProps) {
  const { action } = props;
  return action.command === "RAW"
    ? <RawActionRow {...props} action={action} />
    : <CommandActionRow {...props} action={action} />;
}

/**
 * A mission item this GCS does not model, kept verbatim from a download or
 * import. It is shown read-only as its MAV_CMD number and can only be moved or
 * removed, so the upload re-emits exactly what the vehicle or file held.
 */
function RawActionRow({
  action, expanded, onToggleExpand, onRemove,
  onDragStart, onDragOver, onDragEnd, onDrop, dragOver,
}: Omit<ActionRowProps, "action"> & { action: RawMissionAction }) {
  const t = useTranslations("planner");
  const label = `MAV_CMD ${action.rawCommand}`;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      className={cn(
        "border border-border-default/60 rounded bg-bg-secondary/60",
        dragOver && "border-t-2 border-t-accent-secondary",
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GripVertical size={11} className="text-text-tertiary shrink-0 cursor-grab" />
        <Hash size={12} className="text-text-tertiary shrink-0" />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
        >
          <span className="text-[10px] font-mono text-text-primary truncate">{label}</span>
          <span className="text-[9px] font-mono text-text-tertiary truncate">read-only</span>
        </button>
        <button onClick={onToggleExpand} className="text-text-tertiary hover:text-text-primary shrink-0 cursor-pointer">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          onClick={onRemove}
          aria-label={t("actions.remove")}
          className="text-text-tertiary hover:text-status-error transition-colors shrink-0 cursor-pointer"
        >
          <X size={11} />
        </button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pt-0.5 text-[9px] font-mono text-text-tertiary">
          p1–4: {action.param1}, {action.param2}, {action.param3}, {action.param4} · x/y/z: {action.x}, {action.y}, {action.z} · frame {action.frame}
        </div>
      )}
    </div>
  );
}

function CommandActionRow({
  action, targets, expanded, onToggleExpand, onUpdate, onRemove,
  onDragStart, onDragOver, onDragEnd, onDrop, dragOver,
}: Omit<ActionRowProps, "action"> & { action: CommandMissionAction }) {
  const t = useTranslations("planner");
  const Icon = ACTION_ICON[action.command];
  const label = t(`actions.cmd.${action.command}`);
  const summary = summarize(action, targets);

  const [p1, setP1] = useState(action.param1 !== undefined ? String(action.param1) : "");
  const [p2, setP2] = useState(action.param2 !== undefined ? String(action.param2) : "");
  const [p3, setP3] = useState(action.param3 !== undefined ? String(action.param3) : "");

  // Commit a single numeric parameter, clearing it when the field is emptied.
  const commitField = useCallback(
    (field: "param1" | "param2" | "param3" | "holdTime", value: string) => {
      if (field === "holdTime") return; // actions have no hold time
      if (value === "") { onUpdate({ [field]: undefined }); return; }
      const num = parseFloat(value);
      if (!isNaN(num)) onUpdate({ [field]: num });
    },
    [onUpdate],
  );

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      className={cn(
        "border border-border-default/60 rounded bg-bg-secondary/60",
        dragOver && "border-t-2 border-t-accent-secondary",
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GripVertical size={11} className="text-text-tertiary shrink-0 cursor-grab" />
        <Icon size={12} className="text-accent-secondary shrink-0" />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
        >
          <span className="text-[10px] font-mono text-text-primary truncate">{label}</span>
          {summary && <span className="text-[9px] font-mono text-text-tertiary truncate">{summary}</span>}
        </button>
        <button onClick={onToggleExpand} className="text-text-tertiary hover:text-text-primary shrink-0 cursor-pointer">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          onClick={onRemove}
          aria-label={t("actions.remove")}
          className="text-text-tertiary hover:text-status-error transition-colors shrink-0 cursor-pointer"
        >
          <X size={11} />
        </button>
      </div>

      {expanded && (
        <div className="px-2 pb-2 pt-0.5 flex flex-col gap-1.5">
          {action.command === "DO_JUMP" ? (
            <div className="flex flex-col gap-1.5">
              <Select
                label={t("actions.jumpTarget")}
                options={targets.map((tg) => ({ value: tg.id, label: tg.label }))}
                value={action.jumpTargetId ?? ""}
                onChange={(v) => onUpdate({ jumpTargetId: v })}
                placeholder={t("actions.jumpTargetPlaceholder")}
              />
              <Input
                label={t("repeat")} type="number" placeholder="1" value={p2}
                onChange={(e) => setP2(e.target.value)} onBlur={() => commitField("param2", p2)}
              />
              {!action.jumpTargetId && (
                <span className="text-[9px] text-status-error">{t("actions.jumpNoTarget")}</span>
              )}
              {p2 !== "" && Number(p2) < 0 && (
                <span className="text-[9px] text-status-warning">{t("actions.jumpForever")}</span>
              )}
            </div>
          ) : (
            <CommandSpecificEditors
              cmd={action.command}
              params={action}
              localParam1={p1} localParam2={p2} localParam3={p3} localHoldTime=""
              setLocalParam1={setP1} setLocalParam2={setP2} setLocalParam3={setP3} setLocalHoldTime={() => {}}
              commitField={commitField}
              onUpdate={onUpdate}
            />
          )}
        </div>
      )}
    </div>
  );
}
