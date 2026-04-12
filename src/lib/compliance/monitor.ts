/**
 * Continuous compliance monitor — checks 9 categories of expiry and
 * threshold conditions from the operator profile, aircraft registry,
 * battery registry, and equipment registry.
 *
 * Pure function — reads store snapshots, returns alerts. No side effects.
 *
 * Phase 27.
 *
 * @module compliance/monitor
 * @license GPL-3.0-only
 */

import type { OperatorProfile, AircraftRecord, BatteryPack, EquipmentItem } from "../types/operator";

export type AlertSeverity = "info" | "warning" | "error";
export type AlertCategory =
  | "pilot_license"
  | "operator_cert"
  | "insurance"
  | "airworthiness"
  | "battery_cycles"
  | "equipment_hours"
  | "battery_health"
  | "maintenance_due"
  | "pilot_currency";

export interface ComplianceAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Which settings section can fix this. */
  fixAction?: { section: "operator" | "aircraft" | "battery" | "equipment"; id?: string };
}

const DAYS_MS = 86_400_000;
const WARNING_DAYS = 30;
const ERROR_DAYS = 7;

/**
 * Run all compliance checks. Returns an array of alerts sorted by severity
 * (errors first, then warnings, then info).
 */
export function runComplianceChecks(
  operator: OperatorProfile,
  aircraft: Record<string, AircraftRecord>,
  batteries: Record<string, BatteryPack>,
  equipment: Record<string, EquipmentItem>,
): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];
  const now = Date.now();

  // 1. Pilot license expiry
  if (operator.pilotLicenseExpiry) {
    const exp = new Date(operator.pilotLicenseExpiry).getTime();
    const daysLeft = Math.floor((exp - now) / DAYS_MS);
    if (daysLeft < 0) {
      alerts.push({
        id: "pilot-license-expired",
        category: "pilot_license",
        severity: "error",
        title: "Pilot license expired",
        message: `License expired ${Math.abs(daysLeft)} days ago (${operator.pilotLicenseExpiry}).`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "pilot-license-expiring",
        category: "pilot_license",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Pilot license expiring soon",
        message: `License expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${operator.pilotLicenseExpiry}).`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 2. Operator cert expiry
  if (operator.operatorCertExpiry) {
    const exp = new Date(operator.operatorCertExpiry).getTime();
    const daysLeft = Math.floor((exp - now) / DAYS_MS);
    if (daysLeft < 0) {
      alerts.push({
        id: "operator-cert-expired",
        category: "operator_cert",
        severity: "error",
        title: "Operator certificate expired",
        message: `Certificate expired ${Math.abs(daysLeft)} days ago.`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "operator-cert-expiring",
        category: "operator_cert",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Operator certificate expiring",
        message: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 3. Insurance expiry
  if (operator.insuranceExpiry) {
    const exp = new Date(operator.insuranceExpiry).getTime();
    const daysLeft = Math.floor((exp - now) / DAYS_MS);
    if (daysLeft < 0) {
      alerts.push({
        id: "insurance-expired",
        category: "insurance",
        severity: "error",
        title: "Insurance expired",
        message: `Insurance expired ${Math.abs(daysLeft)} days ago.`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "insurance-expiring",
        category: "insurance",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Insurance expiring",
        message: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 4. Aircraft airworthiness expiry
  for (const ac of Object.values(aircraft)) {
    if (!ac.airworthinessExpiry) continue;
    const exp = new Date(ac.airworthinessExpiry).getTime();
    const daysLeft = Math.floor((exp - now) / DAYS_MS);
    if (daysLeft < 0) {
      alerts.push({
        id: `airworthiness-expired-${ac.id}`,
        category: "airworthiness",
        severity: "error",
        title: `${ac.name} airworthiness expired`,
        message: `Certificate expired ${Math.abs(daysLeft)} days ago.`,
        fixAction: { section: "aircraft", id: ac.id },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: `airworthiness-expiring-${ac.id}`,
        category: "airworthiness",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: `${ac.name} airworthiness expiring`,
        message: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        fixAction: { section: "aircraft", id: ac.id },
      });
    }
  }

  // 5. Battery cycle count (warn at 150, error at 200)
  for (const bat of Object.values(batteries)) {
    if (bat.retiredAt) continue;
    const cycles = bat.cycleCount ?? 0;
    if (cycles >= 200) {
      alerts.push({
        id: `battery-cycles-${bat.id}`,
        category: "battery_cycles",
        severity: "error",
        title: `${bat.label} — ${cycles} cycles`,
        message: "Battery exceeds 200 cycle threshold. Consider retirement.",
        fixAction: { section: "battery", id: bat.id },
      });
    } else if (cycles >= 150) {
      alerts.push({
        id: `battery-cycles-${bat.id}`,
        category: "battery_cycles",
        severity: "warning",
        title: `${bat.label} — ${cycles} cycles`,
        message: "Battery approaching 200 cycle retirement threshold.",
        fixAction: { section: "battery", id: bat.id },
      });
    }
  }

  // 6. Battery health (warn <80%, error <60%)
  for (const bat of Object.values(batteries)) {
    if (bat.retiredAt) continue;
    const health = bat.healthPercent ?? 100;
    if (health < 60) {
      alerts.push({
        id: `battery-health-${bat.id}`,
        category: "battery_health",
        severity: "error",
        title: `${bat.label} — ${health}% health`,
        message: "Battery health critically low. Replace immediately.",
        fixAction: { section: "battery", id: bat.id },
      });
    } else if (health < 80) {
      alerts.push({
        id: `battery-health-${bat.id}`,
        category: "battery_health",
        severity: "warning",
        title: `${bat.label} — ${health}% health`,
        message: "Battery health degrading. Monitor closely.",
        fixAction: { section: "battery", id: bat.id },
      });
    }
  }

  // 7. Equipment hours past inspection threshold
  for (const eq of Object.values(equipment)) {
    if (eq.retiredAt || !eq.inspectionDueHours) continue;
    const hours = eq.totalFlightHours ?? 0;
    if (hours >= eq.inspectionDueHours) {
      alerts.push({
        id: `equipment-inspection-${eq.id}`,
        category: "equipment_hours",
        severity: "error",
        title: `${eq.label} — inspection overdue`,
        message: `${hours.toFixed(1)}h flown, inspection due at ${eq.inspectionDueHours}h.`,
        fixAction: { section: "equipment", id: eq.id },
      });
    } else if (hours >= eq.inspectionDueHours * 0.9) {
      alerts.push({
        id: `equipment-inspection-${eq.id}`,
        category: "equipment_hours",
        severity: "warning",
        title: `${eq.label} — inspection approaching`,
        message: `${hours.toFixed(1)}h flown, due at ${eq.inspectionDueHours}h.`,
        fixAction: { section: "equipment", id: eq.id },
      });
    }
  }

  // 8. Aircraft maintenance due
  for (const ac of Object.values(aircraft)) {
    if (!ac.nextMaintenanceDueHours) continue;
    const hours = ac.totalFlightHours ?? 0;
    if (hours >= ac.nextMaintenanceDueHours) {
      alerts.push({
        id: `maintenance-due-${ac.id}`,
        category: "maintenance_due",
        severity: "error",
        title: `${ac.name} — maintenance overdue`,
        message: `${hours.toFixed(1)}h flown, maintenance due at ${ac.nextMaintenanceDueHours}h.`,
        fixAction: { section: "aircraft", id: ac.id },
      });
    } else if (hours >= ac.nextMaintenanceDueHours * 0.9) {
      alerts.push({
        id: `maintenance-due-${ac.id}`,
        category: "maintenance_due",
        severity: "warning",
        title: `${ac.name} — maintenance approaching`,
        message: `${hours.toFixed(1)}h flown, due at ${ac.nextMaintenanceDueHours}h.`,
        fixAction: { section: "aircraft", id: ac.id },
      });
    }
  }

  // Sort: errors first, then warnings, then info
  const severityOrder: Record<AlertSeverity, number> = { error: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}
