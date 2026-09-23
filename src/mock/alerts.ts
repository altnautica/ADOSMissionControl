import type { Alert, AlertSeverity } from "@/lib/types";
import { randomId } from "@/lib/utils";

interface AlertTemplate {
  severity: AlertSeverity;
  message: string;
}

const ALERT_TEMPLATES: AlertTemplate[] = [
  { severity: "warning", message: "Battery below 30%" },
  { severity: "warning", message: "Approaching geofence boundary" },
  { severity: "info", message: "Mission waypoint reached" },
  { severity: "info", message: "Mission completed successfully" },
  { severity: "warning", message: "GPS HDOP degraded" },
  { severity: "warning", message: "Motor current spike detected" },
  { severity: "critical", message: "Battery critical — initiating RTL" },
  { severity: "info", message: "Return to home initiated" },
  { severity: "warning", message: "Wind speed exceeding limits" },
  { severity: "info", message: "Landing sequence started" },
];

/** Generate a random alert for a drone. */
export function generateAlert(droneId: string, droneName: string): Alert {
  const template = ALERT_TEMPLATES[Math.floor(Math.random() * ALERT_TEMPLATES.length)];
  return {
    id: randomId(),
    droneId,
    droneName,
    severity: template.severity,
    message: template.message,
    timestamp: Date.now(),
    acknowledged: false,
  };
}
