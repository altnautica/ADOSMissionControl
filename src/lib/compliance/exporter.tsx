/**
 * Compliance exporter dispatch.
 *
 * - PDF path: `IN_DGCA` → bespoke single-flight template; every other
 *   jurisdiction → shared `GenericLogbookTemplate`.
 * - CSV / JSON / XML paths still throw `ExportNotSupported` until 7c-2/7c-3.
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

  if (format === "pdf") {
    // Lazy-import the renderer chunk so the History tab stays small.
    const { pdf } = await import("@react-pdf/renderer");

    if (jurisdiction === "IN_DGCA") {
      if (records.length !== 1) {
        throw new Error("DGCA single-flight template expects exactly one record");
      }
      const record = records[0];
      const aircraft = aircraftIndex[record.droneId];
      const { DgcaIndiaTemplate } = await import("./pdf/templates/dgca-india");
      return await pdf(
        <DgcaIndiaTemplate
          record={record}
          operator={operator}
          aircraft={aircraft}
          generatedAt={new Date()}
        />,
      ).toBlob();
    }

    if (records.length === 0) {
      throw new Error("No flights selected for export");
    }
    const { GenericLogbookTemplate } = await import("./pdf/templates/_generic-logbook");
    return await pdf(
      <GenericLogbookTemplate
        spec={spec}
        records={records}
        operator={operator}
        aircraftIndex={aircraftIndex}
        generatedAt={new Date()}
      />,
    ).toBlob();
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
