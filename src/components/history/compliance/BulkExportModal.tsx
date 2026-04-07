"use client";

/**
 * Bulk compliance export modal — pick jurisdiction + format and export
 * the current History selection as a single logbook (PDF/CSV/JSON).
 *
 * Triggered from {@link HistoryBulkActions}. Aggregates the validator across
 * all selected records so the operator sees how many are missing required
 * fields before exporting.
 *
 * Phase 7c-2 — XML, sign-and-lock, multi-step wizard land in 7c-3.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { X, FileText, FileJson, FileType, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { listJurisdictions, type JurisdictionCode } from "@/lib/compliance/jurisdictions";
import { exportFlights, downloadBlob } from "@/lib/compliance/exporter";
import { validateForJurisdiction } from "@/lib/compliance/validator";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import type { FlightRecord } from "@/lib/types";

interface BulkExportModalProps {
  open: boolean;
  records: FlightRecord[];
  onClose: () => void;
}

type Format = "pdf" | "csv" | "json";

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: "pdf", label: "PDF logbook" },
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
];

export function BulkExportModal({ open, records, onClose }: BulkExportModalProps) {
  const operator = useOperatorProfileStore((s) => s.profile);
  const aircraftIndex = useAircraftRegistryStore((s) => s.aircraft);

  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>(
    (operator.defaultJurisdiction as JurisdictionCode) || "GENERIC",
  );
  const [format, setFormat] = useState<Format>("pdf");
  const [busy, setBusy] = useState(false);

  const jurisdictionOptions = useMemo(
    () =>
      listJurisdictions().map((j) => ({
        value: j.code,
        label: j.displayName,
      })),
    [],
  );

  // Aggregate validator across all selected records.
  const aggregate = useMemo(() => {
    let errorCount = 0;
    let warningCount = 0;
    let recordsWithErrors = 0;
    for (const r of records) {
      const issues = validateForJurisdiction(r, operator, aircraftIndex[r.droneId], jurisdiction);
      const errs = issues.filter((i) => i.severity === "error").length;
      const warns = issues.filter((i) => i.severity === "warning").length;
      errorCount += errs;
      warningCount += warns;
      if (errs > 0) recordsWithErrors += 1;
    }
    return { errorCount, warningCount, recordsWithErrors };
  }, [records, operator, aircraftIndex, jurisdiction]);

  const handleExport = async () => {
    setBusy(true);
    try {
      const blob = await exportFlights({
        records,
        jurisdiction,
        format,
        operator,
        aircraftIndex,
      });
      const today = new Date().toISOString().slice(0, 10);
      const ext = format === "pdf" ? "pdf" : format === "csv" ? "csv" : "json";
      downloadBlob(blob, `ados-${jurisdiction.toLowerCase()}-logbook-${today}.${ext}`);
      onClose();
    } catch (err) {
      console.error("[BulkExportModal] export failed", err);
      if (typeof window !== "undefined") window.alert(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Bulk Compliance Export
          </h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <p className="text-[11px] text-text-secondary">
            Exporting <span className="text-text-primary font-mono">{records.length}</span> selected
            flight{records.length === 1 ? "" : "s"}.
          </p>

          <Card title="Jurisdiction" padding={true}>
            <Select
              label="Regulator"
              value={jurisdiction}
              onChange={(v) => setJurisdiction(v as JurisdictionCode)}
              options={jurisdictionOptions}
              searchable
            />
          </Card>

          <Card title="Format" padding={true}>
            <Select
              label="Output"
              value={format}
              onChange={(v) => setFormat(v as Format)}
              options={FORMAT_OPTIONS}
            />
          </Card>

          <Card title="Validation" padding={true}>
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant={
                  aggregate.errorCount > 0
                    ? "error"
                    : aggregate.warningCount > 0
                      ? "warning"
                      : "success"
                }
                size="sm"
              >
                {aggregate.errorCount > 0
                  ? `${aggregate.errorCount} errors`
                  : aggregate.warningCount > 0
                    ? `${aggregate.warningCount} warnings`
                    : "Ready"}
              </Badge>
              {aggregate.recordsWithErrors > 0 && (
                <span className="text-[10px] text-text-tertiary">
                  ({aggregate.recordsWithErrors} of {records.length} records have errors)
                </span>
              )}
            </div>
            {aggregate.errorCount > 0 && (
              <div className="flex items-start gap-1.5 text-[10px] text-text-secondary">
                <AlertTriangle size={10} className="text-status-warning mt-0.5 shrink-0" />
                <span>
                  Required fields are missing on some records. The export still runs — fix the
                  fields in Settings → Operator &amp; Aircraft and re-export for a clean logbook.
                </span>
              </div>
            )}
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={
                format === "pdf" ? (
                  <FileType size={12} />
                ) : format === "csv" ? (
                  <FileText size={12} />
                ) : (
                  <FileJson size={12} />
                )
              }
              onClick={handleExport}
              disabled={busy || records.length === 0}
            >
              {busy ? "Generating…" : `Export ${records.length} flight${records.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
