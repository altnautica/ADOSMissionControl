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

// ── Field set helpers ────────────────────────────────────────

/** Fields most jurisdictions agree on. */
const COMMON_REQUIRED: FieldRef[] = [
  { kind: "operator", key: "pilotFirstName" },
  { kind: "operator", key: "pilotLastName" },
  { kind: "record", key: "startTime" },
  { kind: "record", key: "endTime" },
  { kind: "record", key: "duration" },
  { kind: "record", key: "takeoffLat" },
  { kind: "record", key: "takeoffLon" },
];

const COMMON_OPTIONAL: FieldRef[] = [
  { kind: "operator", key: "operatorName" },
  { kind: "aircraft", key: "manufacturer" },
  { kind: "aircraft", key: "model" },
  { kind: "record", key: "suiteType" },
];

// ── Real jurisdictions ───────────────────────────────────────

const US_FAA_PART107: JurisdictionSpec = {
  code: "US_FAA_PART107",
  displayName: "FAA Part 107",
  countryIso3: "USA",
  regulator: "Federal Aviation Administration",
  regulationRef: "14 CFR Part 107",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" }, // Remote Pilot Certificate
    { kind: "aircraft", key: "registrationNumber" }, // FAA registration / N-number
    { kind: "record", key: "maxAlt" },
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "aircraft", key: "mtomKg" },
    { kind: "operator", key: "insurerName" },
    { kind: "record", key: "landingLat" },
    { kind: "record", key: "landingLon" },
  ],
  retentionMonths: 0, // No federal mandate; FAA may request on demand.
  whenRequired: "Commercial small UAS operations under Part 107.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "us-faa-part107",
};

const US_FAA_PART137: JurisdictionSpec = {
  code: "US_FAA_PART137",
  displayName: "FAA Part 137 (Agriculture)",
  countryIso3: "USA",
  regulator: "Federal Aviation Administration",
  regulationRef: "14 CFR Part 137",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "operator", key: "operatorCertNumber" }, // Part 137 ag operator certificate
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "record", key: "suiteType" }, // expected to be "agriculture"
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 12,
  whenRequired: "Aerial application operations under Part 137. Records retained ≥ 12 months.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "us-faa-part137",
};

const EU_EASA_OPEN: JurisdictionSpec = {
  code: "EU_EASA_OPEN",
  displayName: "EASA Open Category",
  countryIso3: "EUR",
  regulator: "European Union Aviation Safety Agency",
  regulationRef: "Implementing Regulation (EU) 2019/947",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseClass" }, // A1/A3 vs A2 competency
    { kind: "aircraft", key: "registrationNumber" }, // operator registration
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "aircraft", key: "category" },
    { kind: "aircraft", key: "mtomKg" },
  ],
  retentionMonths: 24,
  whenRequired: "Open category VLOS operations. Records retained ≥ 24 months.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "eu-easa-open",
};

const EU_EASA_SPECIFIC: JurisdictionSpec = {
  code: "EU_EASA_SPECIFIC",
  displayName: "EASA Specific (SORA)",
  countryIso3: "EUR",
  regulator: "European Union Aviation Safety Agency",
  regulationRef: "IR (EU) 2019/947 + SORA",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "operator", key: "operatorCertNumber" }, // operational authorisation
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "record", key: "maxAlt" },
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "aircraft", key: "mtomKg" },
    { kind: "operator", key: "insurerName" },
  ],
  retentionMonths: 24,
  whenRequired: "Specific category operations under SORA. ConOps + risk assessment required.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "eu-easa-specific",
};

const EU_EASA_CERTIFIED: JurisdictionSpec = {
  code: "EU_EASA_CERTIFIED",
  displayName: "EASA Certified",
  countryIso3: "EUR",
  regulator: "European Union Aviation Safety Agency",
  regulationRef: "IR (EU) 2019/947 (Certified Category)",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "operator", key: "operatorCertNumber" },
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "aircraft", key: "airworthinessCertNumber" },
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 60,
  whenRequired: "Certified category — manned-aviation-class oversight.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "eu-easa-certified",
};

const UK_CAA: JurisdictionSpec = {
  code: "UK_CAA",
  displayName: "UK CAA — CAP 722",
  countryIso3: "GBR",
  regulator: "UK Civil Aviation Authority",
  regulationRef: "CAP 722 / CAP 2606",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "operator", key: "operatorCertNumber" }, // Operational Authorisation
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "operator", key: "insurerName" },
  ],
  retentionMonths: 24,
  whenRequired: "All commercial UAS operations under Operational Authorisation.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "uk-caa",
};

const AU_CASA_REOC: JurisdictionSpec = {
  code: "AU_CASA_REOC",
  displayName: "CASA ReOC",
  countryIso3: "AUS",
  regulator: "Civil Aviation Safety Authority",
  regulationRef: "Part 101 MOS",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotArn" },
    { kind: "operator", key: "operatorCertNumber" }, // ReOC number
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "aircraft", key: "category" },
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "aircraft", key: "mtomKg" },
  ],
  retentionMonths: 84, // 7 years for operational records
  whenRequired: "Commercial / >2 kg / BVLOS operations under a ReOC.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "au-casa-reoc",
};

const CA_TC: JurisdictionSpec = {
  code: "CA_TC",
  displayName: "Transport Canada — CARs Part IX",
  countryIso3: "CAN",
  regulator: "Transport Canada",
  regulationRef: "CARs Part IX",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseClass" }, // Basic / Advanced
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 12,
  whenRequired: "All UAS ≥ 250 g. Records retained ≥ 12 months.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "ca-tc",
};

const JP_JCAB: JurisdictionSpec = {
  code: "JP_JCAB",
  displayName: "JCAB Japan (DIPS 2.0)",
  countryIso3: "JPN",
  regulator: "Japan Civil Aviation Bureau",
  regulationRef: "Civil Aeronautics Act (revised 2022)",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "aircraft", key: "registrationNumber" }, // DIPS registration symbol
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "operator", key: "operatorAddress" },
  ],
  retentionMonths: 0,
  whenRequired: "All UAS ≥ 100 g. BVLOS / level-3-4 ops require DIPS approval.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "jp-jcab",
};

const AE_GCAA: JurisdictionSpec = {
  code: "AE_GCAA",
  displayName: "GCAA UAE",
  countryIso3: "ARE",
  regulator: "General Civil Aviation Authority",
  regulationRef: "GCAA UAS Regulations",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 0,
  whenRequired: "All commercial UAS operations in UAE airspace.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "ae-gcaa",
};

const SG_CAAS: JurisdictionSpec = {
  code: "SG_CAAS",
  displayName: "CAAS Singapore",
  countryIso3: "SGP",
  regulator: "Civil Aviation Authority of Singapore",
  regulationRef: "AC 101-2-1",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "operatorCertNumber" }, // UA permit number
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 12,
  whenRequired: "Commercial / permittable operations. Records retained ≥ 12 months.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "sg-caas",
};

const BR_ANAC: JurisdictionSpec = {
  code: "BR_ANAC",
  displayName: "ANAC Brazil",
  countryIso3: "BRA",
  regulator: "Agência Nacional de Aviação Civil",
  regulationRef: "RBAC-E No. 94",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: [
    ...COMMON_OPTIONAL,
    { kind: "operator", key: "insurerName" },
  ],
  retentionMonths: 24,
  whenRequired: "All civil commercial UAS operations.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "br-anac",
};

const ICAO: JurisdictionSpec = {
  code: "ICAO",
  displayName: "ICAO Annex 6 Part IV",
  countryIso3: "INT",
  regulator: "International Civil Aviation Organization",
  regulationRef: "ICAO Annex 6 Part IV (RPAS)",
  requiredFields: [
    ...COMMON_REQUIRED,
    { kind: "operator", key: "pilotLicenseNumber" },
    { kind: "operator", key: "operatorCertNumber" },
    { kind: "aircraft", key: "registrationNumber" },
  ],
  optionalFields: COMMON_OPTIONAL,
  retentionMonths: 24,
  whenRequired: "International RPAS operations across signatory states.",
  outputFormats: ["pdf", "csv", "json", "xml"],
  pdfTemplate: "icao",
};

const INSURANCE_SKYWATCH: JurisdictionSpec = {
  code: "INSURANCE_SKYWATCH",
  displayName: "SkyWatch.AI Logbook",
  countryIso3: "—",
  regulator: "SkyWatch.AI",
  regulationRef: "Insurance reporting format",
  requiredFields: [
    { kind: "operator", key: "pilotFirstName" },
    { kind: "operator", key: "pilotLastName" },
    { kind: "operator", key: "insurancePolicyNumber" },
    { kind: "record", key: "startTime" },
    { kind: "record", key: "duration" },
  ],
  optionalFields: [
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "aircraft", key: "model" },
    { kind: "record", key: "takeoffLat" },
    { kind: "record", key: "takeoffLon" },
  ],
  retentionMonths: 36,
  whenRequired: "Insurance hours-tracking and incident documentation.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "insurance-skywatch",
};

const INSURANCE_FLOCK: JurisdictionSpec = {
  code: "INSURANCE_FLOCK",
  displayName: "Flock Insurance Logbook",
  countryIso3: "—",
  regulator: "Flock",
  regulationRef: "Insurance reporting format",
  requiredFields: [
    { kind: "operator", key: "pilotFirstName" },
    { kind: "operator", key: "pilotLastName" },
    { kind: "operator", key: "insurancePolicyNumber" },
    { kind: "record", key: "startTime" },
    { kind: "record", key: "duration" },
  ],
  optionalFields: [
    { kind: "aircraft", key: "registrationNumber" },
    { kind: "aircraft", key: "model" },
  ],
  retentionMonths: 36,
  whenRequired: "Pay-per-flight insurance reporting.",
  outputFormats: ["pdf", "csv", "json"],
  pdfTemplate: "insurance-flock",
};

export const JURISDICTIONS: Record<JurisdictionCode, JurisdictionSpec> = {
  IN_DGCA,
  GENERIC,
  US_FAA_PART107,
  US_FAA_PART137,
  EU_EASA_OPEN,
  EU_EASA_SPECIFIC,
  EU_EASA_CERTIFIED,
  UK_CAA,
  AU_CASA_REOC,
  CA_TC,
  JP_JCAB,
  AE_GCAA,
  SG_CAAS,
  BR_ANAC,
  ICAO,
  INSURANCE_SKYWATCH,
  INSURANCE_FLOCK,
};

/** Convenience: list all jurisdictions in display order. */
export function listJurisdictions(): JurisdictionSpec[] {
  return Object.values(JURISDICTIONS);
}
