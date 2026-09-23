"use client";

/**
 * Floating bulk-actions bar that appears when ≥1 history row is selected.
 *
 * Actions: Export CSV, Favorite/Unfavorite, Delete, Clear. In the trash
 * view Delete is replaced by Restore and Delete permanently.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download, Star, StarOff, Trash2, X, FileType, GitCompare, Layers, Map, ArchiveRestore } from "lucide-react";
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
  /** Replace the table selection, e.g. with the flights a coverage search matched. */
  onSelect: (ids: Set<string>) => void;
  /** The table is showing the trash: offer Restore and Delete permanently. */
  trashMode: boolean;
}

export function HistoryBulkActions({
  records,
  selectedIds,
  onClearSelection,
  onSelect,
  trashMode,
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
    const msg = t("moveToTrashConfirm", { count: selectedIds.size });
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    const store = useHistoryStore.getState();
    for (const id of selectedIds) {
      store.removeRecord(id);
    }
    void store.persistToIDB();
    onClearSelection();
  };

  const handleRestore = () => {
    const store = useHistoryStore.getState();
    for (const id of selectedIds) {
      store.restoreRecord(id);
    }
    void store.persistToIDB();
    onClearSelection();
  };

  const handleDeletePermanently = () => {
    const msg = t("deletePermanentlyConfirm", { count: selectedIds.size });
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    const store = useHistoryStore.getState();
    for (const id of selectedIds) {
      store.permanentlyDelete(id);
    }
    void store.persistToIDB();
    onClearSelection();
  };

  return (
    <>
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-md border border-border-default bg-bg-secondary px-3 py-2 shadow-lg">
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
        {trashMode ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArchiveRestore size={14} />}
              onClick={handleRestore}
              title={t("restore")}
            >
              {t("restore")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDeletePermanently}
              title={t("deletePermanently")}
            >
              {t("deletePermanently")}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={handleDelete}
            title={t("delete")}
          >
            {t("delete")}
          </Button>
        )}
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
        // A drawn search area selects the flights it matched, so the table
        // shows them and every bulk action applies to them. Clearing the area
        // keeps the selection (an empty one would close this bar and the map).
        onPolygonFilter={(ids) => {
          if (ids.size > 0) onSelect(ids);
        }}
      />
    </>
  );
}
