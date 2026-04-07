/**
 * Compliance exporter dispatch.
 *
 * Phase 7b implements only the PDF path for `IN_DGCA`. CSV / JSON / XML and
 * the other 13 jurisdictions land in Phase 7c.
 *
 * @module compliance/exporter
 * @license GPL-3.0-only
 */

import type { FlightRecord, OperatorProfile, AircraftRecord } from "@/lib/types";
import type { JurisdictionCode, ExportFormat } from "./jurisdictions";
import { JURISDICTIONS } from "./jurisdictions";

export interface ExportInput {
  records: FlightRecord[];
  jurisdiction: JurisdictionCode;
  format: ExportFormat;
  operator: OperatorProfile;
  aircraftIndex: Record<string, AircraftRecord>;
}

export class ExportNotSupported extends Error {
  constructor(jurisdiction: JurisdictionCode, format: ExportFormat) {
    super(`Export not yet supported: ${jurisdiction} as ${format}`);
    this.name = "ExportNotSupported";
  }
}

/**
 * Render an export to a Blob. Dynamic-imports the PDF renderer chunk so the
 * History tab stays light for users who never trigger an export.
 */
export async function exportFlights(input: ExportInput): Promise<Blob> {
  const { records, jurisdiction, format, operator, aircraftIndex } = input;
  const spec = JURISDICTIONS[jurisdiction];
  if (!spec) throw new ExportNotSupported(jurisdiction, format);

  if (format === "pdf" && jurisdiction === "IN_DGCA") {
    if (records.length !== 1) {
      throw new Error("Phase 7b PDF export expects exactly one record");
    }
    const record = records[0];
    const aircraft = aircraftIndex[record.droneId];

    // Lazy-import @react-pdf/renderer (and the template) to keep the History
    // tab bundle small.
    const [{ pdf }, { DgcaIndiaTemplate }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./pdf/templates/dgca-india"),
    ]);
    const doc = (
      <DgcaIndiaTemplate
        record={record}
        operator={operator}
        aircraft={aircraft}
        generatedAt={new Date()}
      />
    );
    const blob = await pdf(doc).toBlob();
    return blob;
  }

  throw new ExportNotSupported(jurisdiction, format);
}

/** Trigger a browser download for the given blob and filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
