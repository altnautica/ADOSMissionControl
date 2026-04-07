/**
 * Per-jurisdiction XML exporter.
 *
 * Builds a self-describing XML document keyed off the jurisdiction's
 * required + optional fields. Used for ICAO Annex 6 reporting today; any
 * jurisdiction whose spec lists `xml` in `outputFormats` is eligible.
 *
 * No external XML library — manual emission with strict escaping. Output is
 * pretty-printed and validates as well-formed XML.
 *
 * @module compliance/xml-exporter
 * @license GPL-3.0-only
 */

import type {
  FlightRecord,
  OperatorProfile,
  AircraftRecord,
} from "@/lib/types";
import type { JurisdictionSpec, FieldRef } from "./jurisdictions";
import { readField, refLabel, formatFieldValue } from "./field-reader";

const NS = "https://altnautica.com/compliance/v1";
const SCHEMA_VERSION = 1;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: string | number | undefined, indent: number): string {
  const pad = "  ".repeat(indent);
  if (value === undefined || value === null || value === "") {
    return `${pad}<${name} />`;
  }
  return `${pad}<${name}>${xmlEscape(String(value))}</${name}>`;
}

function buildFieldElements(
  refs: FieldRef[],
  record: FlightRecord,
  operator: OperatorProfile,
  aircraft: AircraftRecord | undefined,
  indent: number,
): string {
  return refs
    .map((ref) => {
      const value = readField(ref, record, operator, aircraft);
      const formatted = formatFieldValue(value, String(ref.key));
      return tag(refLabel(ref).replace(".", "_"), formatted, indent);
    })
    .join("\n");
}

export function exportComplianceXml(
  records: FlightRecord[],
  spec: JurisdictionSpec,
  operator: OperatorProfile,
  aircraftIndex: Record<string, AircraftRecord>,
): string {
  const generatedAt = new Date().toISOString();

  const flightsXml = records
    .map((record) => {
      const aircraft = aircraftIndex[record.droneId];
      return [
        `    <flight id="${xmlEscape(record.id)}">`,
        tag("droneId", record.droneId, 3),
        tag("droneName", record.droneName, 3),
        `      <required>`,
        buildFieldElements(spec.requiredFields, record, operator, aircraft, 4),
        `      </required>`,
        `      <optional>`,
        buildFieldElements(spec.optionalFields, record, operator, aircraft, 4),
        `      </optional>`,
        record.pilotSignatureHash
          ? `      <signature hash="${xmlEscape(record.pilotSignatureHash)}" signedAt="${new Date(record.pilotSignedAt ?? 0).toISOString()}" />`
          : "",
        `    </flight>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const operatorXml = [
    tag("name", operator.operatorName, 3),
    tag("certNumber", operator.operatorCertNumber, 3),
    tag("certIssuer", operator.operatorCertIssuer, 3),
    tag("pilotFirstName", operator.pilotFirstName, 3),
    tag("pilotLastName", operator.pilotLastName, 3),
    tag("pilotLicenseNumber", operator.pilotLicenseNumber, 3),
    tag("pilotLicenseIssuer", operator.pilotLicenseIssuer, 3),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<complianceExport
  xmlns="${NS}"
  schemaVersion="${SCHEMA_VERSION}"
  generatedAt="${generatedAt}"
  jurisdictionCode="${xmlEscape(spec.code)}"
  regulator="${xmlEscape(spec.regulator)}"
  regulationRef="${xmlEscape(spec.regulationRef)}"
  retentionMonths="${spec.retentionMonths}">
  <operator>
${operatorXml}
  </operator>
  <flights count="${records.length}">
${flightsXml}
  </flights>
</complianceExport>
`;
}
