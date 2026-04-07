/**
 * Per-jurisdiction CSV exporter.
 *
 * Columns are derived from the jurisdiction's `requiredFields` ∪
 * `optionalFields`. The header row uses the field-ref label
 * (e.g. `operator.pilotFirstName`) so the column meaning is unambiguous
 * to auditors and machine-readable for downstream pipelines.
 *
 * @module compliance/csv-exporter
 * @license GPL-3.0-only
 */

import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import type { JurisdictionSpec } from "./jurisdictions";
import { readField, refLabel, formatFieldValue } from "./field-reader";

const CORE_HEADERS = ["record.id", "record.droneName"];

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportComplianceCsv(
  records: FlightRecord[],
  spec: JurisdictionSpec,
  operator: OperatorProfile,
  aircraftIndex: Record<string, AircraftRecord>,
): string {
  const fields = [...spec.requiredFields, ...spec.optionalFields];
  const headers = [...CORE_HEADERS, ...fields.map(refLabel)];

  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));

  for (const record of records) {
    const aircraft = aircraftIndex[record.droneId];
    const row: string[] = [
      csvEscape(record.id),
      csvEscape(record.droneName),
    ];
    for (const ref of fields) {
      const value = readField(ref, record, operator, aircraft);
      row.push(csvEscape(formatFieldValue(value, String(ref.key))));
    }
    lines.push(row.join(","));
  }

  return lines.join("\n");
}
