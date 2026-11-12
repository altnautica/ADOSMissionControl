"use client";

/**
 * @module outline/OutlineWaypointRow
 * @description One waypoint row of the plan outline: index badge, command,
 * altitude with its frame, and the terrain clearance under it. The row is a
 * drag source and drop target for reordering; the delete button shows on
 * hover or focus. Editing happens in the inspector, which follows selection.
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { useTranslations } from "next-intl";
import { GripVertical, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AltitudeFrame, Waypoint } from "@/lib/types/mission";
import { waypointAltitudeAgl } from "@/lib/mission/altitude-frame";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { isGroundContactCommand } from "@/lib/validation/autopilot-rules";
import { INAV_ACTION_LABEL, NAV_COMMAND_OPTIONS } from "../waypoint-constants";

/** Altitude datum chip: relative altitudes are above home, not above ground. */
const FRAME_LABELS: Record<string, string> = { relative: "REL", absolute: "MSL" };

const NAV_COMMAND_LABEL: Record<string, string> = Object.fromEntries(
  NAV_COMMAND_OPTIONS.map((o) => [o.value, o.label]),
);

interface OutlineWaypointRowProps {
  waypoint: Waypoint;
  index: number;
  /** The single selected waypoint (the inspector is editing it). */
  selected: boolean;
  /** Part of a batch selection. */
  multiSelected: boolean;
  isInav: boolean;
  defaultFrame: AltitudeFrame;
  homeGroundElevation: number | undefined;
  /** Handlers take the row's id / index so the list passes stable references. */
  onClick: (id: string, e: React.MouseEvent) => void;
  onRemove: (id: string) => void;
  onDragStart: (index: number, e: React.DragEvent) => void;
  onDragOver: (index: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (index: number, e: React.DragEvent) => void;
  dragOver: boolean;
  registerRow: (id: string, el: HTMLElement | null) => void;
  /** Right-click on the row: the list opens the row menu. Absent on iNav, which has no row menu. */
  onContextMenu?: (index: number, e: React.MouseEvent) => void;
}

export const OutlineWaypointRow = memo(function OutlineWaypointRow({
  waypoint, index, selected, multiSelected, isInav, defaultFrame, homeGroundElevation,
  onClick, onRemove, onDragStart, onDragOver, onDragEnd, onDrop, dragOver, registerRow, onContextMenu,
}: OutlineWaypointRowProps) {
  const t = useTranslations("planner");
  const id = waypoint.id;
  const cmd = waypoint.command ?? "WAYPOINT";
  const label = isInav ? (INAV_ACTION_LABEL[cmd] ?? cmd) : (NAV_COMMAND_LABEL[cmd] ?? cmd);
  // Chip the waypoint's own altitude reference; imported waypoints carry one.
  const frame = waypoint.frame ?? defaultFrame;
  const frameLabel = frame === "terrain" ? t("inspector.defaults.frameTerrain") : (FRAME_LABELS[frame] ?? "REL");
  const clearance = waypointAltitudeAgl(waypoint, { homeGroundElevation, defaultFrame });
  // Takeoff, landing and RTL rows sit at the surface by design: no hazard colour.
  const clearanceHazard = clearance !== null && !isGroundContactCommand(waypoint.command);
  // RTL flies at the vehicle's own return altitude; the item's altitude field
  // is not used, so neither it nor a clearance under it means anything.
  const isRtl = cmd === "RTL";
  // A terrain-frame altitude already is the height above ground: a second
  // AGL figure repeats it and crowds the command name out of the row.
  const showClearance = !isRtl && frame !== "terrain";
  const actionCount = waypoint.actions?.length ?? 0;
  const highlighted = selected || multiSelected;

  return (
    <div
      ref={(el) => registerRow(id, el)}
      data-waypoint-id={id}
      draggable
      onDragStart={(e) => onDragStart(index, e)}
      onDragOver={(e) => onDragOver(index, e)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(index, e)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(index, e) : undefined}
      className={cn(
        "group/row relative flex h-7 items-center gap-1 pl-1 pr-2 transition-colors",
        highlighted ? "bg-accent-primary/10" : "hover:bg-bg-tertiary",
        dragOver && "shadow-[inset_0_2px_0_0_var(--color-accent-primary)]",
      )}
    >
      <GripVertical
        size={12}
        aria-hidden
        className="shrink-0 cursor-grab text-text-tertiary opacity-0 group-hover/row:opacity-100"
      />
      <button
        type="button"
        onClick={(e) => onClick(id, e)}
        aria-pressed={highlighted}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded text-left cursor-pointer focus-ring"
      >
        <span
          className={cn(
            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-mono text-[11px] font-semibold",
            highlighted ? "bg-accent-primary text-bg-primary" : "bg-bg-tertiary text-text-secondary",
          )}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary" title={label}>{label}</span>
        {isRtl ? (
          <span className="shrink-0 font-mono text-[11px] text-text-tertiary" title={t("outline.rtlAltitude")}>
            —
          </span>
        ) : (
          <>
            <span className="shrink-0 font-mono text-[11px] text-text-secondary">{waypoint.alt}m</span>
            <span className="shrink-0 rounded bg-bg-tertiary px-1 text-[11px] text-text-tertiary">{frameLabel}</span>
          </>
        )}
        {showClearance && clearance !== null && waypoint.groundElevation !== undefined && (
          <span
            title={t("aboveGround", { alt: Math.round(clearance), elev: Math.round(waypoint.groundElevation) })}
            className={cn(
              "shrink-0 font-mono text-[11px]",
              !clearanceHazard ? "text-text-tertiary"
                : clearance < 0 ? "text-status-error"
                : clearance < DEFAULT_MIN_TERRAIN_CLEARANCE ? "text-status-warning"
                : "text-text-tertiary",
            )}
          >
            {t("outline.clearance", { alt: Math.round(clearance) })}
          </span>
        )}
        {actionCount > 0 && (
          <span
            title={t("actions.chipTitle", { count: actionCount })}
            className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-text-tertiary"
          >
            <Zap size={10} aria-hidden />{actionCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={t("outline.deleteWaypoint", { n: index + 1 })}
        title={t("outline.deleteWaypoint", { n: index + 1 })}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-opacity hover:text-status-error group-hover/row:opacity-100 focus-visible:opacity-100 cursor-pointer focus-ring"
      >
        <X size={12} />
      </button>
    </div>
  );
});
