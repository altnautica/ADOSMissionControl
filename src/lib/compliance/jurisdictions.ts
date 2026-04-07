/**
 * Jurisdiction registry for compliance exports.
 *
 * Each jurisdiction declares its required + optional fields, retention period,
 * supported output formats, and the PDF template id used by the exporter.
 *
 * Phase 7b: only `IN_DGCA` and `GENERIC` are fully populated. Other entries
 * are stubs that Phase 7c fills with their actual rules and templates.
 *
 * @module compliance/jurisdictions
 * @license GPL-3.0-only
 */

import type { FlightRecord, OperatorProfile, AircraftRecord } from "@/lib/types";

export type JurisdictionCode =
  | "IN_DGCA"
  | "US_FAA_PART107"
  | "US_FAA_PART137"
  | "EU_EASA_OPEN"
  | "EU_EASA_SPECIFIC"
  | "EU_EASA_CERTIFIED"
  | "UK_CAA"
  | "AU_CASA_REOC"
  | "CA_TC"
  | "JP_JCAB"
  | "AE_GCAA"
  | "SG_CAAS"
  | "BR_ANAC"
  | "ICAO"
  | "GENERIC"
  | "INSURANCE_SKYWATCH"
  | "INSURANCE_FLOCK";

export type FieldRef =
  | { kind: "record"; key: keyof FlightRecord }
  | { kind: "operator"; key: keyof OperatorProfile }
  | { kind: "aircraft"; key: keyof AircraftRecord };

export type ExportFormat = "pdf" | "csv" | "xml" | "json";

export interface JurisdictionSpec {
  code: JurisdictionCode;
  displayName: string;
  countryIso3: string;
  regulator: string;
  regulationRef: string;
  /** Fields the regulator strictly requires. Validator raises errors when missing. */
  requiredFields: FieldRef[];
  /** Recommended fields. Validator raises warnings when missing. */
  optionalFields: FieldRef[];
  /** Required record retention in months. 0 = no mandate. */
  retentionMonths: number;
  /** Plain-language description of when an export is required. */
  whenRequired: string;
  /** Output formats this jurisdiction's exporter supports. */
  outputFormats: ExportFormat[];
  /** PDF template id (resolved by `exporter.ts` to a React PDF component). */
  pdfTemplate: string;
}

// ── DGCA India (Phase 7b reference template) ─────────────────

const IN_DGCA: JurisdictionSpec = {
  code: "IN_DGCA",
  displayName: "DGCA India — Drone Rules 2021",
  countryIso3: "IND",
  regulator: "Directorate General of Civil Aviation (DGCA)",
  regulationRef: "Drone Rules 2021 + DGCA CAR Section 3 Series X",
  requiredFields: [
    { kind: "operator", key: "pilotFirstName" },
    { kind: "operator", key: "pilotLastName" },
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "aircraft", key: "registrationNumber" }, // DGCA UIN
    { kind: "record", key: "startTime" },
    { kind: "record", key: "endTime" },
    { kind: "record", key: "duration" },
    { kind: "record", key: "takeoffLat" },
    { kind: "record", key: "takeoffLon" },
    { kind: "record", key: "landingLat" },
    { kind: "record", key: "landingLon" },
    { kind: "record", key: "maxAlt" },
  ],
  optionalFields: [
    { kind: "operator", key: "operatorName" },
    { kind: "aircraft", key: "manufacturer" },
    { kind: "aircraft", key: "model" },
    { kind: "aircraft", key: "mtomKg" },
    { kind: "aircraft", key: "category" },
    { kind: "record", key: "suiteType" },
    { kind: "operator", key: "insurerName" },
  ],
  retentionMonths: 60, // DGCA expects records to be kept for audit. 5 years is industry-conservative.
  whenRequired: "All civil UAS operations in India.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "dgca-india",
};

// ── Generic / superset (always available) ────────────────────

const GENERIC: JurisdictionSpec = {
  code: "GENERIC",
  displayName: "Generic (no jurisdiction)",
  countryIso3: "—",
  regulator: "—",
  regulationRef: "ADOS Mission Control superset format",
  requiredFields: [
    { kind: "record", key: "startTime" },
    { kind: "record", key: "endTime" },
  ],
  optionalFields: [],
  retentionMonths: 0,
  whenRequired: "Default when no jurisdiction is selected.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "generic",
};

// ── Stub jurisdictions (Phase 7c will fill) ──────────────────

const STUB = (
  code: JurisdictionCode,
  displayName: string,
  countryIso3: string,
  regulator: string,
  regulationRef: string,
): JurisdictionSpec => ({
  code,
  displayName,
  countryIso3,
  regulator,
  regulationRef,
  requiredFields: [],
  optionalFields: [],
  retentionMonths: 0,
  whenRequired: "",
  outputFormats: ["pdf"],
  pdfTemplate: code.toLowerCase(),
});

export const JURISDICTIONS: Record<JurisdictionCode, JurisdictionSpec> = {
  IN_DGCA,
  GENERIC,
  US_FAA_PART107: STUB("US_FAA_PART107", "FAA Part 107", "USA", "Federal Aviation Administration", "14 CFR Part 107"),
  US_FAA_PART137: STUB("US_FAA_PART137", "FAA Part 137 (Agriculture)", "USA", "Federal Aviation Administration", "14 CFR Part 137"),
  EU_EASA_OPEN: STUB("EU_EASA_OPEN", "EASA Open Category", "EUR", "European Union Aviation Safety Agency", "IR (EU) 2019/947"),
  EU_EASA_SPECIFIC: STUB("EU_EASA_SPECIFIC", "EASA Specific (SORA)", "EUR", "European Union Aviation Safety Agency", "IR (EU) 2019/947 + SORA"),
  EU_EASA_CERTIFIED: STUB("EU_EASA_CERTIFIED", "EASA Certified", "EUR", "European Union Aviation Safety Agency", "IR (EU) 2019/947"),
  UK_CAA: STUB("UK_CAA", "UK CAA — CAP 722", "GBR", "UK Civil Aviation Authority", "CAP 722 / CAP 2606"),
  AU_CASA_REOC: STUB("AU_CASA_REOC", "CASA ReOC", "AUS", "Civil Aviation Safety Authority", "Part 101 MOS"),
  CA_TC: STUB("CA_TC", "Transport Canada", "CAN", "Transport Canada", "CARs Part IX"),
  JP_JCAB: STUB("JP_JCAB", "JCAB Japan (DIPS 2.0)", "JPN", "Japan Civil Aviation Bureau", "Civil Aeronautics Act (revised 2022)"),
  AE_GCAA: STUB("AE_GCAA", "GCAA UAE", "ARE", "General Civil Aviation Authority", "GCAA UAS Regulations"),
  SG_CAAS: STUB("SG_CAAS", "CAAS Singapore", "SGP", "Civil Aviation Authority of Singapore", "AC 101-2-1"),
  BR_ANAC: STUB("BR_ANAC", "ANAC Brazil", "BRA", "Agência Nacional de Aviação Civil", "RBAC-E No. 94"),
  ICAO: STUB("ICAO", "ICAO Annex 6 Part IV", "INT", "International Civil Aviation Organization", "ICAO Annex 6 Part IV (RPAS)"),
  INSURANCE_SKYWATCH: STUB("INSURANCE_SKYWATCH", "SkyWatch.AI Logbook", "—", "SkyWatch.AI", "Insurance reporting format"),
  INSURANCE_FLOCK: STUB("INSURANCE_FLOCK", "Flock Insurance Logbook", "—", "Flock", "Insurance reporting format"),
};

/** Convenience: list all jurisdictions in display order. */
export function listJurisdictions(): JurisdictionSpec[] {
  return Object.values(JURISDICTIONS);
}
