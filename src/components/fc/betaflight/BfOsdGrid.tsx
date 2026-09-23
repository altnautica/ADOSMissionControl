"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BfOsdElement, VideoSystem } from "./bf-osd-constants";
import { VIDEO_COLS, VIDEO_ROWS, CELL_WIDTH, CELL_HEIGHT, isVisibleInProfile } from "./bf-osd-constants";

interface BfOsdGridProps {
  elements: BfOsdElement[];
  /** 1-based OSD profile the grid shows and edits. */
  activeProfile: number;
  /** Profiles the firmware supports (1 when compiled out, else 3). */
  profileCount: number;
  videoSystem: VideoSystem;
  selectedId: number | null;
  onSelectElement: (id: number | null) => void;
  onUpdateElement: (id: number, updates: Partial<BfOsdElement>) => void;
}

export function BfOsdGrid({
  elements, activeProfile, profileCount, videoSystem, selectedId,
  onSelectElement, onUpdateElement,
}: BfOsdGridProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const rows = VIDEO_ROWS[videoSystem];
  const cols = VIDEO_COLS[videoSystem];

  const pageElements = useMemo(
    () => elements.filter((el) => isVisibleInProfile(el, activeProfile)),
    [elements, activeProfile],
  );

  const selectedElement = useMemo(
    () => (selectedId !== null ? elements.find((el) => el.id === selectedId) : undefined),
    [elements, selectedId],
  );

  const getGridCell = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!gridRef.current) return null;
      const rect = gridRef.current.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / CELL_WIDTH);
      const y = Math.floor((clientY - rect.top) / CELL_HEIGHT);
      if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
      return { x, y };
    },
    [rows, cols],
  );

  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent, elementId: number) => {
      e.preventDefault();
      setDragging(elementId);
      onSelectElement(elementId);
      const cell = getGridCell(e.clientX, e.clientY);
      if (cell) setDragGhost(cell);
    },
    [getGridCell, onSelectElement],
  );

  const handleGridMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging === null) return;
      const cell = getGridCell(e.clientX, e.clientY);
      if (cell) setDragGhost(cell);
    },
    [dragging, getGridCell],
  );

  const handleGridMouseUp = useCallback(() => {
    if (dragging !== null && dragGhost) {
      onUpdateElement(dragging, { x: dragGhost.x, y: dragGhost.y });
    }
    setDragging(null);
    setDragGhost(null);
  }, [dragging, dragGhost, onUpdateElement]);

  const handleGridClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragging !== null) return;
      const cell = getGridCell(e.clientX, e.clientY);
      if (!cell) return;
      const el = pageElements.find((pe) => pe.x === cell.x && pe.y === cell.y);
      onSelectElement(el ? el.id : null);
    },
    [dragging, getGridCell, pageElements, onSelectElement],
  );

  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <div
        ref={gridRef}
        className="relative border border-border-default bg-bg-tertiary overflow-auto select-none"
        style={{
          width: cols * CELL_WIDTH,
          height: rows * CELL_HEIGHT,
          minWidth: cols * CELL_WIDTH,
          minHeight: rows * CELL_HEIGHT,
        }}
        onMouseMove={handleGridMouseMove}
        onMouseUp={handleGridMouseUp}
        onMouseLeave={handleGridMouseUp}
        onClick={handleGridClick}
      >
        {/* Grid lines */}
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => (
            <div
              key={`cell-${r}-${c}`}
              className="absolute border-r border-b border-border-default/30"
              style={{
                left: c * CELL_WIDTH,
                top: r * CELL_HEIGHT,
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
              }}
            />
          )),
        )}

        {/* Elements on grid */}
        {pageElements.map((el) => {
          const isSelected = el.id === selectedId;
          const isDraggingThis = dragging === el.id;
          return (
            <div
              key={`el-${el.id}`}
              className={cn(
                "absolute flex items-center justify-center cursor-grab z-10",
                "text-[10px] font-mono leading-none truncate px-0.5",
                isSelected
                  ? "bg-accent-primary/30 text-accent-primary ring-1 ring-accent-primary"
                  : "bg-accent-primary/15 text-text-primary hover:bg-accent-primary/25",
                isDraggingThis && "opacity-40",
              )}
              style={{
                left: el.x * CELL_WIDTH,
                top: el.y * CELL_HEIGHT,
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
              }}
              onMouseDown={(e) => handleGridMouseDown(e, el.id)}
            >
              {el.shortLabel}
            </div>
          );
        })}

        {/* Drag ghost */}
        {dragging !== null && dragGhost && (
          <div
            className="absolute flex items-center justify-center z-20 pointer-events-none
                       bg-accent-primary/40 text-accent-primary text-[10px] font-mono ring-1 ring-accent-primary"
            style={{
              left: dragGhost.x * CELL_WIDTH,
              top: dragGhost.y * CELL_HEIGHT,
              width: CELL_WIDTH,
              height: CELL_HEIGHT,
            }}
          >
            {elements.find((el) => el.id === dragging)?.shortLabel}
          </div>
        )}
      </div>

      {/* Selected element position editor */}
      {selectedElement && (
        <div className="flex items-center gap-3 p-2 bg-bg-secondary border border-border-default">
          <span className="text-xs text-text-primary font-medium truncate max-w-[160px]">
            {selectedElement.name}
          </span>
          <div className="flex items-center gap-2">
            <div className="w-16">
              <Input
                label="X"
                type="number"
                min={0}
                max={cols - 1}
                value={selectedElement.x}
                onChange={(e) =>
                  onUpdateElement(selectedElement.id, {
                    x: Math.min(cols - 1, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
              />
            </div>
            <div className="w-16">
              <Input
                label="Y"
                type="number"
                min={0}
                max={rows - 1}
                value={selectedElement.y}
                onChange={(e) =>
                  onUpdateElement(selectedElement.id, {
                    y: Math.min(rows - 1, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
              />
            </div>
            <div className="flex items-center gap-2" role="group" aria-label="Visible in OSD profiles">
              {Array.from({ length: profileCount }, (_, i) => {
                const bit = 1 << i;
                return (
                  <label key={i} className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-accent-primary w-3.5 h-3.5"
                      checked={(selectedElement.profiles & bit) !== 0}
                      onChange={() => onUpdateElement(selectedElement.id, { profiles: selectedElement.profiles ^ bit })}
                    />
                    Profile {i + 1}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
