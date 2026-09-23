/**
 * @module lib/fleet-alerts
 * @description Raises fleet alerts from a drone's live telemetry.
 *
 * The fleet alert list (Dashboard alert counts and feed) is fed from what each
 * connected flight controller actually reports:
 *  - STATUSTEXT at CRITICAL severity or worse (EMERGENCY, ALERT, CRITICAL), and
 *    any failsafe announcement, as critical;
 *  - the battery crossing into the operator's warning or critical band;
 *  - the FC link going silent.
 *
 * Each condition raises once when it starts, not once per frame: a battery
 * sitting in the critical band is one alert, and it is raised again only after
 * the reading has left that band and come back.
 *
 * @license GPL-3.0-only
 */

import type { AlertSeverity } from "@/lib/types";
import { batteryBand, type BatteryBand } from "@/lib/battery-bands";
import { isFailsafeAnnouncement } from "@/lib/telemetry/failsafe-text";
import { useFleetStore } from "@/stores/fleet-store";
import { useSettingsStore } from "@/stores/settings-store";

/** MAV_SEVERITY_CRITICAL; lower values are more severe. */
const MAV_SEVERITY_CRITICAL = 2;

export interface FleetAlertProducer {
  statusText: (severity: number, text: string) => void;
  /** Battery percentage as the FC reports it; negative means not reported. */
  batteryRemaining: (remaining: number) => void;
  linkLost: () => void;
  linkRestored: () => void;
}

/** One producer per connected drone; it holds that drone's raised conditions. */
export function createFleetAlertProducer(
  droneId: string,
  droneName: string,
): FleetAlertProducer {
  let lastBand: BatteryBand | undefined;
  let linkLost = false;

  const raise = (severity: AlertSeverity, message: string) => {
    const now = Date.now();
    useFleetStore.getState().addAlert({
      id: `${droneId}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      droneId,
      droneName,
      severity,
      message,
      timestamp: now,
      acknowledged: false,
    });
  };

  return {
    statusText(severity, text) {
      if (
        severity <= MAV_SEVERITY_CRITICAL ||
        isFailsafeAnnouncement(severity, text)
      ) {
        raise("critical", text);
      }
    },

    batteryRemaining(remaining) {
      if (!Number.isFinite(remaining) || remaining < 0) return;
      const { batteryWarningPct, batteryCriticalPct } =
        useSettingsStore.getState();
      const band = batteryBand(remaining, {
        warningPct: batteryWarningPct,
        criticalPct: batteryCriticalPct,
      });
      const worsened =
        (band === "critical" && lastBand !== "critical") ||
        (band === "warning" && lastBand !== "warning" && lastBand !== "critical");
      lastBand = band;
      if (!worsened) return;
      raise(
        band === "critical" ? "critical" : "warning",
        `Battery at ${Math.round(remaining)}%`,
      );
    },

    linkLost() {
      if (linkLost) return;
      linkLost = true;
      raise("critical", "Flight controller link lost");
    },

    linkRestored() {
      linkLost = false;
    },
  };
}
