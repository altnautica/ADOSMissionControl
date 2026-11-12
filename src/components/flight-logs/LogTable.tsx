"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { HistoryTable, type SortKey, type SortDir } from "@/components/history/HistoryTable";
import type { FlightRecord } from "@/lib/types";

const LIST_WIDTH_MIN = 280;
const LIST_WIDTH_MAX = 560;
const LIST_WIDTH_DEFAULT = 360;

export interface UseListLayoutResult {
  listWidth: number;
  listCollapsed: boolean;
  setListCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  toggleListCollapsed: () => void;
  handleResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleResizeEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function useListLayout(): UseListLayoutResult {
  const [listWidth, setListWidth] = useState<number>(LIST_WIDTH_DEFAULT);
  const [listCollapsed, setListCollapsed] = useState<boolean>(false);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("history.listWidth");
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n)) setListWidth(Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, n)));
    }
    const collapsed = window.localStorage.getItem("history.listCollapsed");
    if (collapsed === "1") setListCollapsed(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("history.listWidth", String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("history.listCollapsed", listCollapsed ? "1" : "0");
  }, [listCollapsed]);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { startX: e.clientX, startWidth: listWidth };
  }, [listWidth]);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    const dx = e.clientX - resizingRef.current.startX;
    const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, resizingRef.current.startWidth + dx));
    setListWidth(next);
  }, []);

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
    resizingRef.current = null;
  }, []);

  const toggleListCollapsed = useCallback(() => setListCollapsed((v) => !v), []);

  return {
    listWidth,
    listCollapsed,
    setListCollapsed,
    toggleListCollapsed,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  };
}

export interface LogTableProps {
  records: FlightRecord[];
  selectedRecord: FlightRecord | null;
  onSelectRecord: (record: FlightRecord | null) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, range: boolean) => void;
  onSelectAllPage: (ids: string[], allSelected: boolean) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  listWidth: number;
  listCollapsed: boolean;
  onResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** The list is the trash view, so an empty list reads "Trash is empty". */
  trashMode: boolean;
  /** Clears the search and filters from the empty-list state. */
  onResetFilters: () => void;
}

export function LogTable({
  records,
  selectedRecord,
  onSelectRecord,
  selectedIds,
  onToggleSelect,
  onSelectAllPage,
  sortKey,
  sortDir,
  onSortChange,
  listWidth,
  listCollapsed,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  trashMode,
  onResetFilters,
}: LogTableProps) {
  const t = useTranslations("history");
  return (
    <>
      {!(selectedRecord && listCollapsed) && (
        <div
          className="h-full overflow-hidden"
          style={
            selectedRecord
              ? { width: listWidth, flex: "0 0 auto" }
              : { flex: "1 1 auto", minWidth: 0 }
          }
        >
          <HistoryTable
            records={records}
            selectedId={selectedRecord?.id ?? null}
            onSelect={onSelectRecord}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelectAllPage={onSelectAllPage}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={onSortChange}
            compact={!!selectedRecord}
            trashMode={trashMode}
            onResetFilters={onResetFilters}
          />
        </div>
      )}

      {selectedRecord && !listCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className="w-1 shrink-0 cursor-col-resize bg-border-default hover:bg-accent-primary/60 transition-colors"
          title={t("dragToResize")}
        />
      )}
    </>
  );
}
