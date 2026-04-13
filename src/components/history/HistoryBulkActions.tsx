"use client";

/**
 * Floating bulk-actions bar that appears when ≥1 history row is selected.
 *
 * Phase 3 actions: Export CSV, Favorite/Unfavorite, Delete, Clear.
 * Phase 7 will add jurisdiction-aware bulk export wizard.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download, Star, StarOff, Trash2, X, FileType, GitCompare, Layers, Map } from "lucide-react";
import type { FlightRecord } from "@/lib/types";
import { exportFlightRecordsAsCsv } from "@/lib/csv-export";
import { useHistoryStore } from "@/stores/history-store";
import { BulkExportModal } from "./compliance/BulkExportModal";
import { CompareModal } from "./compare/CompareModal";
import { OverlayModal } from "./compare/OverlayModal";
import { FleetCoverageModal } from "./maps/FleetCoverageModal";

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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [fleetMapOpen, setFleetMapOpen] = useState(false);

  if (selectedIds.size === 0) return null;

  const selectedRecords = records.filter((r) => selectedIds.has(r.id));
  const canCompare = selectedRecords.length === 2;
  const canOverlay = selectedRecords.length >= 2 && selectedRecords.length <= 5;

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
    <>
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
          variant="primary"
          size="sm"
          icon={<FileType size={14} />}
          onClick={() => setBulkOpen(true)}
          title={t("complianceLogbook")}
        >
          {t("logbook")}
        </Button>
        {canCompare && (
          <Button
            variant="secondary"
            size="sm"
            icon={<GitCompare size={14} />}
            onClick={() => setCompareOpen(true)}
            title={t("compareFlights")}
          >
            {t("compare")}
          </Button>
        )}
        {canOverlay && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Layers size={14} />}
            onClick={() => setOverlayOpen(true)}
            title={t("overlayFlights", { count: selectedRecords.length })}
          >
            {t("overlay")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<Map size={14} />}
          onClick={() => setFleetMapOpen(true)}
          title={t("fleetCoverage")}
        >
          {t("fleetMap")}
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

      <BulkExportModal
        open={bulkOpen}
        records={selectedRecords}
        onClose={() => setBulkOpen(false)}
      />

      <CompareModal
        open={compareOpen}
        recordA={selectedRecords[0] ?? null}
        recordB={selectedRecords[1] ?? null}
        onClose={() => setCompareOpen(false)}
      />

      <OverlayModal
        open={overlayOpen}
        records={selectedRecords}
        onClose={() => setOverlayOpen(false)}
      />

      <FleetCoverageModal
        open={fleetMapOpen}
        records={records}
        onClose={() => setFleetMapOpen(false)}
      />
    </>
  );
}
