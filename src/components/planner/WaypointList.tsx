/**
 * @module WaypointList
 * @description Scrollable list of waypoints in the right panel with drag-and-drop
 * reordering. Renders {@link WaypointListItem} for each waypoint.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { WaypointListItem } from "./WaypointListItem";
import { ACTION_DRAG_TYPE } from "./ActionRow";
import { usePlannerStore } from "@/stores/planner-store";
import type { Waypoint } from "@/lib/types";

interface WaypointListProps {
  waypoints: Waypoint[];
  selectedId: string | null;
  expandedId: string | null;
  onSelect: (id: string) => void;
  onExpand: (id: string | null) => void;
  onUpdate: (id: string, update: Partial<Waypoint>) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onInsertAt?: (index: number) => void;
}

export function WaypointList({
  waypoints,
  selectedId,
  expandedId,
  onSelect,
  onExpand,
  onUpdate,
  onRemove,
  onReorder,
  onInsertAt,
}: WaypointListProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const selectedWaypointIds = usePlannerStore((s) => s.selectedWaypointIds);
  const toggleWaypointSelection = usePlannerStore((s) => s.toggleWaypointSelection);
  const selectRange = usePlannerStore((s) => s.selectRange);

  // Row handlers stay identity-stable so a memoised row re-renders only when
  // its own waypoint or flags change; they read the latest list through a ref.
  const latest = useRef({ selectedId, waypoints, onSelect, onExpand, onReorder });
  useLayoutEffect(() => {
    latest.current = { selectedId, waypoints, onSelect, onExpand, onReorder };
  });

  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    const l = latest.current;
    if (e.shiftKey && l.selectedId) {
      selectRange(l.selectedId, id, l.waypoints.map((wp) => wp.id));
    } else if (e.ctrlKey || e.metaKey) {
      toggleWaypointSelection(id);
    } else {
      l.onSelect(id);
      l.onExpand(id);
    }
  }, [selectRange, toggleWaypointSelection]);

  const handleExpand = useCallback((id: string | null) => latest.current.onExpand(id), []);

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    // An attached action dragged across rows is not a waypoint reorder.
    if (e.dataTransfer.types.includes(ACTION_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((toIndex: number, e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(ACTION_DRAG_TYPE)) return;
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from !== null && from !== toIndex) {
      latest.current.onReorder(from, toIndex);
    }
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  const t = useTranslations("planner");

  if (waypoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <p className="text-xs text-text-tertiary">{t("noWaypoints")}</p>
        <p className="text-[10px] text-text-tertiary">{t("addWaypointHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {waypoints.map((wp, i) => (
        // Off-screen rows skip layout and paint, so a long survey list stays cheap.
        <div key={wp.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_34px]">
          <WaypointListItem
            waypoint={wp}
            index={i}
            expanded={expandedId === wp.id}
            selected={selectedId === wp.id}
            multiSelected={selectedWaypointIds.includes(wp.id)}
            onExpand={handleExpand}
            onSelect={handleSelect}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            dragOver={dragOverIndex === i && dragIndexRef.current !== i}
          />
          {/* Insert button between waypoints */}
          {onInsertAt && (
            <div className="flex justify-center py-0.5 group">
              <button
                onClick={() => onInsertAt(i + 1)}
                className="flex items-center gap-0.5 px-2 py-0.5 text-[9px] font-mono text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-accent-primary hover:bg-accent-primary/10 rounded transition-all cursor-pointer"
                title={t("insertWaypointHere")}
              >
                <Plus size={10} />
                {t("insert")}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
