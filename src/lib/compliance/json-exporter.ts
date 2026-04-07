/**
 * Per-jurisdiction JSON exporter.
 *
 * Wraps the records in a self-describing envelope so downstream consumers
 * (Zapier, Airdata, custom auditors) can identify the schema version,
 * regulator, and the exact fields the regulator requires.
 *
 * @module compliance/json-exporter
 * @license GPL-3.0-only
 */

import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import type { JurisdictionSpec } from "./jurisdictions";
import { readField, refLabel } from "./field-reader";

const SCHEMA_VERSION = 1;

interface ComplianceJsonEnvelope {
  schemaVersion: number;
  generatedAt: string;
  jurisdiction: {
    code: string;
    displayName: string;
    countryIso3: string;
    regulator: string;
    regulationRef: string;
    retentionMonths: number;
  };
  operator: OperatorProfile;
  flights: ComplianceFlightEntry[];
}

interface ComplianceFlightEntry {
  id: string;
  droneId: string;
  droneName: string;
  /** Resolved required fields for the jurisdiction (key → value). */
  required: Record<string, unknown>;
  /** Resolved optional fields for the jurisdiction. */
  optional: Record<string, unknown>;
  /** Full original FlightRecord for downstream re-use. */
  record: FlightRecord;
  /** Aircraft snapshot at export time. */
  aircraft?: AircraftRecord;
}

export function exportComplianceJson(
  records: FlightRecord[],
  spec: JurisdictionSpec,
  operator: OperatorProfile,
  aircraftIndex: Record<string, AircraftRecord>,
): string {
  const envelope: ComplianceJsonEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    jurisdiction: {
      code: spec.code,
      displayName: spec.displayName,
      countryIso3: spec.countryIso3,
      regulator: spec.regulator,
      regulationRef: spec.regulationRef,
      retentionMonths: spec.retentionMonths,
    },
    operator,
    flights: records.map((record) => {
      const aircraft = aircraftIndex[record.droneId];
      const required: Record<string, unknown> = {};
      const optional: Record<string, unknown> = {};
      for (const ref of spec.requiredFields) {
        required[refLabel(ref)] = readField(ref, record, operator, aircraft);
      }
      for (const ref of spec.optionalFields) {
        optional[refLabel(ref)] = readField(ref, record, operator, aircraft);
      }
      return {
        id: record.id,
        droneId: record.droneId,
        droneName: record.droneName,
        required,
        optional,
        record,
        aircraft,
      };
    }),
  };
  return JSON.stringify(envelope, null, 2);
}
