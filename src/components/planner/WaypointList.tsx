/**
 * @module WaypointList
 * @description Scrollable list of waypoints in the right panel with drag-and-drop
 * reordering. Renders {@link WaypointListItem} for each waypoint.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { WaypointListItem } from "./WaypointListItem";
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
  onAddManual: () => void;
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
  onAddManual,
}: WaypointListProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const selectedWaypointIds = usePlannerStore((s) => s.selectedWaypointIds);
  const toggleWaypointSelection = usePlannerStore((s) => s.toggleWaypointSelection);
  const selectRange = usePlannerStore((s) => s.selectRange);

  const waypointIds = waypoints.map((wp) => wp.id);

  const handleMultiSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selectedId) {
      selectRange(selectedId, id, waypointIds);
    } else if (e.ctrlKey || e.metaKey) {
      toggleWaypointSelection(id);
    } else {
      onSelect(id);
      onExpand(id);
    }
  }, [selectedId, waypointIds, selectRange, toggleWaypointSelection, onSelect, onExpand]);

  const handleDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((toIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from !== null && from !== toIndex) {
      onReorder(from, toIndex);
    }
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, [onReorder]);

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
        <WaypointListItem
          key={wp.id}
          waypoint={wp}
          index={i}
          expanded={expandedId === wp.id}
          selected={selectedId === wp.id}
          multiSelected={selectedWaypointIds.includes(wp.id)}
          onToggleExpand={() => onExpand(expandedId === wp.id ? null : wp.id)}
          onSelect={(e) => handleMultiSelect(wp.id, e)}
          onUpdate={(update) => onUpdate(wp.id, update)}
          onRemove={() => onRemove(wp.id)}
          onDragStart={handleDragStart(i)}
          onDragOver={handleDragOver(i)}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop(i)}
          dragOver={dragOverIndex === i && dragIndexRef.current !== i}
        />
      ))}
    </div>
  );
}
