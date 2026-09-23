/**
 * Field reader helpers shared by the validator, the CSV / JSON / XML
 * exporters and the PDF templates.
 *
 * A jurisdiction's required/optional fields are declared as `FieldRef`s
 * (record / operator / aircraft + key). This module resolves those refs
 * against a flight + operator + aircraft trio.
 *
 * A flight record freezes the pilot and aircraft identity at arm time. Those
 * frozen values win over the live operator profile and aircraft registry, so
 * a past flight keeps certifying the pilot and aircraft that actually flew it
 * after the profile is edited. The live value is used only when the record
 * carries no snapshot for that field.
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

/** Operator-profile fields the record freezes at arm time, by resolved pilot field. */
const PILOT_FIELD: Partial<Record<keyof OperatorProfile, keyof ResolvedPilot>> = {
  pilotFirstName: "firstName",
  pilotLastName: "lastName",
  pilotLicenseNumber: "licenseNumber",
  pilotLicenseIssuer: "licenseIssuer",
};

/** Aircraft-registry fields the record freezes at arm time, by resolved identity field. */
const AIRCRAFT_FIELD: Partial<Record<keyof AircraftRecord, keyof ResolvedAircraftIdentity>> = {
  registrationNumber: "registration",
  serialNumber: "serial",
  mtomKg: "mtomKg",
};

/** Read a single field. Returns `undefined` if missing or unresolvable. */
export function readField(
  ref: FieldRef,
  record: FlightRecord,
  operator: OperatorProfile,
  aircraft: AircraftRecord | undefined,
): unknown {
  if (ref.kind === "record") return record[ref.key];
  if (ref.kind === "operator") {
    const field = PILOT_FIELD[ref.key];
    return field ? resolvePilot(record, operator)[field] : operator[ref.key];
  }
  if (ref.kind === "aircraft") {
    const field = AIRCRAFT_FIELD[ref.key];
    return field ? resolveAircraftIdentity(record, aircraft)[field] : aircraft?.[ref.key];
  }
  return undefined;
}

/** Pilot identity for one flight: the arm-time snapshot, else the live profile. */
export interface ResolvedPilot {
  firstName?: string;
  lastName?: string;
  licenseNumber?: string;
  licenseIssuer?: string;
}

/** The pilot fields a flight record freezes at arm time. */
type PilotSnapshot = Pick<
  FlightRecord,
  "pilotFirstName" | "pilotLastName" | "pilotLicenseNumber" | "pilotLicenseIssuer"
>;

export function resolvePilot(record: PilotSnapshot, operator: OperatorProfile): ResolvedPilot {
  return {
    firstName: record.pilotFirstName ?? operator.pilotFirstName,
    lastName: record.pilotLastName ?? operator.pilotLastName,
    licenseNumber: record.pilotLicenseNumber ?? operator.pilotLicenseNumber,
    licenseIssuer: record.pilotLicenseIssuer ?? operator.pilotLicenseIssuer,
  };
}

/**
 * The one pilot who flew every record in `records`, for a cover block that
 * names a single pilot. Null when the records' arm-time pilots disagree: each
 * flight then carries its own pilot. With no records, the live profile.
 */
export function commonPilot(records: FlightRecord[], operator: OperatorProfile): ResolvedPilot | null {
  if (records.length === 0) return resolvePilot({}, operator);
  const first = resolvePilot(records[0], operator);
  for (const record of records) {
    const p = resolvePilot(record, operator);
    if (
      p.firstName !== first.firstName ||
      p.lastName !== first.lastName ||
      p.licenseNumber !== first.licenseNumber ||
      p.licenseIssuer !== first.licenseIssuer
    ) {
      return null;
    }
  }
  return first;
}

/** Aircraft identity for one flight: the arm-time snapshot, else the live registry. */
export interface ResolvedAircraftIdentity {
  registration?: string;
  serial?: string;
  mtomKg?: number;
}

export function resolveAircraftIdentity(
  record: FlightRecord,
  aircraft: AircraftRecord | undefined,
): ResolvedAircraftIdentity {
  return {
    registration: record.aircraftRegistration ?? aircraft?.registrationNumber,
    serial: record.aircraftSerial ?? aircraft?.serialNumber,
    mtomKg: record.aircraftMtomKg ?? aircraft?.mtomKg,
  };
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
