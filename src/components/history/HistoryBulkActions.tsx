"use client";

/**
 * Floating bulk-actions bar that appears when ≥1 history row is selected.
 *
 * Phase 3 actions: Export CSV, Favorite/Unfavorite, Delete, Clear.
 * Phase 7 will add jurisdiction-aware bulk export wizard.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download, Star, StarOff, Trash2, X } from "lucide-react";
import type { FlightRecord } from "@/lib/types";
import { exportFlightRecordsAsCsv } from "@/lib/csv-export";
import { useHistoryStore } from "@/stores/history-store";

interface HistoryBulkActionsProps {
  records: FlightRecord[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

export function HistoryBulkActions({
  records,
  selectedIds,
  onClearSelection,
}: HistoryBulkActionsProps) {
  const t = useTranslations("history");

  if (selectedIds.size === 0) return null;

  const selectedRecords = records.filter((r) => selectedIds.has(r.id));

  const handleExport = () => {
    exportFlightRecordsAsCsv(selectedRecords);
  };

  const handleFavorite = (favorite: boolean) => {
    const store = useHistoryStore.getState();
    for (const id of selectedIds) {
      store.updateRecord(id, { favorite });
    }
    void store.persistToIDB();
  };

  const handleDelete = () => {
    const msg = t("deleteConfirm", { count: selectedIds.size });
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    const store = useHistoryStore.getState();
    for (const id of selectedIds) {
      store.removeRecord(id);
    }
    void store.persistToIDB();
    onClearSelection();
  };

  return (
    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-md border border-border-default bg-surface-secondary px-3 py-2 shadow-lg">
      <span className="text-xs font-mono text-text-secondary mr-2">
        {t("selected", { count: selectedIds.size })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<Download size={14} />}
        onClick={handleExport}
        title={t("exportBtn")}
      >
        {t("exportBtn")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<Star size={14} />}
        onClick={() => handleFavorite(true)}
        title={t("favorite")}
      >
        {t("favorite")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<StarOff size={14} />}
        onClick={() => handleFavorite(false)}
        title={t("unfavorite")}
      >
        {t("unfavorite")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash2 size={14} />}
        onClick={handleDelete}
        title={t("delete")}
      >
        {t("delete")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<X size={14} />}
        onClick={onClearSelection}
        title={t("clear")}
      />
    </div>
  );
}
