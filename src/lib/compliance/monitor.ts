/**
 * Continuous compliance monitor — checks 8 categories of expiry and
 * threshold conditions from the operator profile, aircraft registry,
 * battery registry, and equipment registry.
 *
 * Pure function — reads store snapshots, returns alerts. No side effects.
 *
 * @module compliance/monitor
 * @license GPL-3.0-only
 */

import type { OperatorProfile, AircraftRecord, BatteryPack, EquipmentItem } from "../types/operator";
import { batteryHealthPercent } from "../battery-pack-health";
import { hoursSinceInspection, isInspectionDue } from "../equipment-inspection";

export type AlertSeverity = "info" | "warning" | "error";
export type AlertCategory =
  | "pilot_license"
  | "operator_cert"
  | "insurance"
  | "airworthiness"
  | "battery_cycles"
  | "equipment_hours"
  | "battery_health"
  | "maintenance_due";

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

/** Local midnight at the start of the calendar day holding `ms`. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days from today until an expiry date, in local time. A
 * document is valid through its whole expiry day, so that day is 0 and the
 * day after is -1. A date-only string (`2026-09-23`) names a local calendar
 * day; `new Date()` would read it as UTC midnight and shift it a day early
 * west of UTC.
 */
function daysUntilExpiry(expiry: string, now: number): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  const expiryDay = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
    : startOfLocalDay(new Date(expiry).getTime());
  // Round, not floor: a DST change makes one calendar day 23 or 25 hours.
  return Math.round((expiryDay - startOfLocalDay(now)) / DAYS_MS);
}

/** "today", "in 1 day", "in 5 days". */
function expiresIn(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  return `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

/** "1 day ago", "5 days ago", for a negative `daysLeft`. */
function expiredAgo(daysLeft: number): string {
  const days = -daysLeft;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

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
    const daysLeft = daysUntilExpiry(operator.pilotLicenseExpiry, now);
    if (daysLeft < 0) {
      alerts.push({
        id: "pilot-license-expired",
        category: "pilot_license",
        severity: "error",
        title: "Pilot license expired",
        message: `License expired ${expiredAgo(daysLeft)} (${operator.pilotLicenseExpiry}).`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "pilot-license-expiring",
        category: "pilot_license",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Pilot license expiring soon",
        message: `License expires ${expiresIn(daysLeft)} (${operator.pilotLicenseExpiry}).`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 2. Operator cert expiry
  if (operator.operatorCertExpiry) {
    const daysLeft = daysUntilExpiry(operator.operatorCertExpiry, now);
    if (daysLeft < 0) {
      alerts.push({
        id: "operator-cert-expired",
        category: "operator_cert",
        severity: "error",
        title: "Operator certificate expired",
        message: `Certificate expired ${expiredAgo(daysLeft)}.`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "operator-cert-expiring",
        category: "operator_cert",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Operator certificate expiring",
        message: `Expires ${expiresIn(daysLeft)}.`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 3. Insurance expiry
  if (operator.insuranceExpiry) {
    const daysLeft = daysUntilExpiry(operator.insuranceExpiry, now);
    if (daysLeft < 0) {
      alerts.push({
        id: "insurance-expired",
        category: "insurance",
        severity: "error",
        title: "Insurance expired",
        message: `Insurance expired ${expiredAgo(daysLeft)}.`,
        fixAction: { section: "operator" },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: "insurance-expiring",
        category: "insurance",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: "Insurance expiring",
        message: `Expires ${expiresIn(daysLeft)}.`,
        fixAction: { section: "operator" },
      });
    }
  }

  // 4. Aircraft airworthiness expiry
  for (const ac of Object.values(aircraft)) {
    if (!ac.airworthinessExpiry) continue;
    const daysLeft = daysUntilExpiry(ac.airworthinessExpiry, now);
    if (daysLeft < 0) {
      alerts.push({
        id: `airworthiness-expired-${ac.id}`,
        category: "airworthiness",
        severity: "error",
        title: `${ac.name} airworthiness expired`,
        message: `Certificate expired ${expiredAgo(daysLeft)}.`,
        fixAction: { section: "aircraft", id: ac.id },
      });
    } else if (daysLeft <= WARNING_DAYS) {
      alerts.push({
        id: `airworthiness-expiring-${ac.id}`,
        category: "airworthiness",
        severity: daysLeft <= ERROR_DAYS ? "error" : "warning",
        title: `${ac.name} airworthiness expiring`,
        message: `Expires ${expiresIn(daysLeft)}.`,
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
    const health = Math.round(batteryHealthPercent(bat) * 10) / 10;
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
    if (eq.retiredAt || !eq.inspectionIntervalHours) continue;
    const hours = hoursSinceInspection(eq);
    if (isInspectionDue(eq)) {
      alerts.push({
        id: `equipment-inspection-${eq.id}`,
        category: "equipment_hours",
        severity: "error",
        title: `${eq.label} — inspection overdue`,
        message: `${hours.toFixed(1)}h flown since last inspection, interval ${eq.inspectionIntervalHours}h.`,
        fixAction: { section: "equipment", id: eq.id },
      });
    } else if (hours >= eq.inspectionIntervalHours * 0.9) {
      alerts.push({
        id: `equipment-inspection-${eq.id}`,
        category: "equipment_hours",
        severity: "warning",
        title: `${eq.label} — inspection approaching`,
        message: `${hours.toFixed(1)}h flown since last inspection, interval ${eq.inspectionIntervalHours}h.`,
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
