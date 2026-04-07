/**
 * Field reader helpers shared by validator + CSV / JSON exporters.
 *
 * A jurisdiction's required/optional fields are declared as `FieldRef`s
 * (record / operator / aircraft + key). This module resolves those refs
 * against a flight + operator + aircraft trio.
 *
 * @module compliance/field-reader
 * @license GPL-3.0-only
 */

import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import type { FieldRef } from "./jurisdictions";

/** Read a single field. Returns `undefined` if missing or unresolvable. */
export function readField(
  ref: FieldRef,
  record: FlightRecord,
  operator: OperatorProfile,
  aircraft: AircraftRecord | undefined,
): unknown {
  if (ref.kind === "record") return record[ref.key];
  if (ref.kind === "operator") return operator[ref.key];
  if (ref.kind === "aircraft") return aircraft?.[ref.key];
  return undefined;
}

/** Stable string label for a field reference (e.g. `record.startTime`). */
export function refLabel(ref: FieldRef): string {
  return `${ref.kind}.${String(ref.key)}`;
}

/** Format a value for CSV / JSON export. Arrays → joined, dates → ISO. */
export function formatFieldValue(value: unknown, key: string): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join("; ");
  }
  // Heuristic: epoch-style timestamps stored on the record (`startTime`,
  // `endTime`, `updatedAt`) read better as ISO strings in compliance exports.
  if (typeof value === "number" && /Time$|^date$|^updatedAt$/.test(key)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
