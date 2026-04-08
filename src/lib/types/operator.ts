/**
 * Operator profile + aircraft registry types.
 *
 * Phase 7a — pure types, no behaviour. Consumed by:
 *  - {@link useOperatorProfileStore}
 *  - {@link useAircraftRegistryStore}
 *  - flight-lifecycle (snapshot pilot/aircraft into FlightRecord on arm)
 *  - compliance/* (Phase 7b/7c — validators + PDF templates)
 *
 * @module types/operator
 * @license GPL-3.0-only
 */

// ── Operator profile ─────────────────────────────────────────

export interface OperatorProfile {
  // Pilot
  pilotFirstName?: string;
  pilotLastName?: string;
  /** ISO date string. */
  pilotDob?: string;
  pilotLicenseNumber?: string;
  /** "DGCA" | "FAA" | "EASA" | "CAA UK" | … */
  pilotLicenseIssuer?: string;
  /** "Small" | "Part 107" | "A1/A3" | "STS-01" | … */
  pilotLicenseClass?: string;
  /** ISO date string. */
  pilotLicenseExpiry?: string;
  pilotEndorsements?: string[];
  /** Hours flown before ADOS started tracking. */
  pilotTotalHoursPriorPic?: number;
  /** CASA Aviation Reference Number. */
  pilotArn?: string;
  /** FAA TRUST certificate id. */
  pilotTrustId?: string;

  // Operator (organisation)
  operatorName?: string;
  /** ReOC, OA, LUC, Part 107 Waiver, RPC, etc. */
  operatorCertNumber?: string;
  operatorCertIssuer?: string;
  /** ISO date. */
  operatorCertExpiry?: string;
  operatorAddress?: string;

  // Insurance
  insurerName?: string;
  insurancePolicyNumber?: string;
  /** ISO date. */
  insuranceExpiry?: string;
  insuranceCoverageAmount?: string;

  // Defaults / preferences
  defaultJurisdiction?: string;
  defaultTimeZone?: string;
  units?: "metric" | "imperial";
  /** Base64-encoded PNG of the pilot signature. */
  signatureImageBase64?: string;
}

// ── Aircraft registry ────────────────────────────────────────

export type VehicleType = "copter" | "plane" | "vtol" | "rover" | "sub";

export type AircraftCategory = "nano" | "micro" | "small" | "medium" | "large";

export interface AircraftRecord {
  /** Matches FlightRecord.droneId — primary key. */
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /** DGCA UIN, FAA N-number, EASA reg, CASA reg, etc. */
  registrationNumber?: string;
  /** ASTM Remote ID serial. */
  remoteIdSerial?: string;
  category?: AircraftCategory;
  /** Max take-off mass in kg. */
  mtomKg?: number;
  vehicleType?: VehicleType;
  airworthinessCertNumber?: string;
  /** ISO date. */
  airworthinessExpiry?: string;
  insuranceCovered?: boolean;
  notes?: string;

  // Auto-rolled-up usage stats (updated by flight-lifecycle on disarm)
  totalFlightHours?: number;
  totalFlights?: number;
  /** ISO date of last maintenance. */
  lastMaintenanceDate?: string;
  /** Hours since last maintenance threshold. */
  nextMaintenanceDueHours?: number;
}

// ── Battery registry (Phase 12a) ─────────────────────────────

export type BatteryChemistry = "LiPo" | "Li-Ion" | "LiFePO4" | "Li-HV" | "NiMH" | "Other";

export interface BatteryPack {
  /** Stable ID. UUID generated client-side. */
  id: string;
  /** Manufacturer-assigned serial number. */
  serial?: string;
  /** Friendly name (e.g. "Pack A1 — 6S 1300mAh"). */
  label: string;
  chemistry?: BatteryChemistry;
  /** Series cell count. */
  cells?: number;
  /** Capacity in mAh. */
  capacityMah?: number;
  /** Continuous discharge rating ("65C", "20C"). */
  cRating?: string;
  manufacturer?: string;
  model?: string;
  /** ISO date the pack was put into service. */
  purchaseDate?: string;

  // Auto-tracked usage stats. Updated by recordCycle().
  cycleCount?: number;
  /** Estimated state-of-health 0..100 (cycle-degradation model). */
  healthPercent?: number;
  /** ISO timestamp of last full charge (manual entry; charger integration TBD). */
  lastChargedAt?: string;

  /** ISO date the pack was retired from service. Hides from active picker. */
  retiredAt?: string;
  notes?: string;
}

