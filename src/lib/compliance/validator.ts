/**
 * Compliance validator — checks a flight + operator + aircraft trio against
 * a jurisdiction's required/optional fields and produces a list of issues.
 *
 * Phase 7b: covers field-presence rules (required → error, optional → warning)
 * for every jurisdiction. DGCA gets one extra rule for the 120 m AGL limit.
 *
 * @module compliance/validator
 * @license GPL-3.0-only
 */

import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import { JURISDICTIONS, type JurisdictionCode, type FieldRef } from "./jurisdictions";
import { readField, refLabel } from "./field-reader";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  field: string;
  severity: ValidationSeverity;
  message: string;
  /** Optional UI hint for where to fix it. */
  fixTab?: "operator" | "aircraft" | "notes";
}

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function refTab(ref: FieldRef): "operator" | "aircraft" | "notes" {
  if (ref.kind === "operator") return "operator";
  if (ref.kind === "aircraft") return "aircraft";
  return "notes";
}

export function validateForJurisdiction(
  record: FlightRecord,
  operator: OperatorProfile,
  aircraft: AircraftRecord | undefined,
  code: JurisdictionCode,
): ValidationIssue[] {
  const spec = JURISDICTIONS[code];
  if (!spec) return [];

  const issues: ValidationIssue[] = [];

  for (const ref of spec.requiredFields) {
    const value = readField(ref, record, operator, aircraft);
    if (isMissing(value)) {
      issues.push({
        field: refLabel(ref),
        severity: "error",
        message: `Required by ${spec.displayName}: ${refLabel(ref)} is missing.`,
        fixTab: refTab(ref),
      });
    }
  }
  for (const ref of spec.optionalFields) {
    const value = readField(ref, record, operator, aircraft);
    if (isMissing(value)) {
      issues.push({
        field: refLabel(ref),
        severity: "warning",
        message: `Recommended by ${spec.displayName}: ${refLabel(ref)} is missing.`,
        fixTab: refTab(ref),
      });
    }
  }

  // DGCA-specific rule: max altitude > 120 m AGL requires authorization ref.
  if (code === "IN_DGCA" && record.maxAlt > 120) {
    issues.push({
      field: "record.maxAlt",
      severity: "warning",
      message: `DGCA Drone Rules 2021 limit Micro/Small operations to 120 m AGL. This flight reached ${record.maxAlt} m. Add an authorisation reference to the notes.`,
      fixTab: "notes",
    });
  }

  return issues;
}
