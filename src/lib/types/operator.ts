/**
 * Operator profile + aircraft registry types.
 *
 * Pure types, no behaviour. Consumed by:
 *  - {@link useOperatorProfileStore}
 *  - {@link useAircraftRegistryStore}
 *  - flight-lifecycle (snapshot pilot/aircraft into FlightRecord on arm)
 *  - compliance/* (validators + PDF templates)
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
  /** A `JurisdictionCode`; readers validate it with `resolveJurisdiction`. */
  defaultJurisdiction?: string;
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

// ── Battery registry ─────────────────────────────────────────

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
  /**
   * Operator-entered state of health 0..100. When absent the health is
   * projected from `cycleCount` (see `batteryHealthPercent`).
   */
  healthOverridePercent?: number;
  /** ISO timestamp of last full charge (manual entry; charger integration TBD). */
  lastChargedAt?: string;

  /** ISO date the pack was retired from service. Hides from active picker. */
  retiredAt?: string;
  notes?: string;
}

// ── Equipment registry ───────────────────────────────────────

export type EquipmentType =
  | "prop_set"
  | "motor_set"
  | "esc_set"
  | "camera"
  | "gimbal"
  | "payload"
  | "frame"
  | "rc_tx";

/**
 * Generic registry entry for any swappable component on the drone:
 * propeller sets, motor sets, ESCs, cameras, gimbals, payloads, frames,
 * RC transmitters. Hours and flight counts auto-roll up on disarm via
 * the loadout linkage.
 */
export interface EquipmentItem {
  /** Stable id. UUID generated client-side. */
  id: string;
  type: EquipmentType;
  /** Friendly name (e.g. "Gemfan 5152S 5"). */
  label: string;
  /** Manufacturer or operator-assigned serial number. */
  serial?: string;
  manufacturer?: string;
  model?: string;
  /** Free-form free text describing where this item is fitted (e.g. "Alpha-1 motor 3", "Bravo backpack RC"). */
  fitment?: string;
  /** ISO date this item was installed / put into service. */
  installDate?: string;

  // Auto-rolled-up usage stats. Updated by recordFlight(). 12c wires it.
  totalFlightHours?: number;
  totalFlights?: number;

  /** Inspect every this many flight hours (see `lib/equipment-inspection`). */
  inspectionIntervalHours?: number;
  /** ISO date of last maintenance / inspection. */
  lastInspectedAt?: string;
  /** `totalFlightHours` at the last inspection; the interval counts from here. */
  hoursAtLastInspection?: number;

  /** ISO date this item was retired from service. Hides from active picker. */
  retiredAt?: string;
  notes?: string;
}


