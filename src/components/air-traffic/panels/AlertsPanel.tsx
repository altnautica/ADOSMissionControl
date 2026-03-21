/**
 * @module AlertsPanel
 * @description Bottom-right toast area for TCAS-style proximity alerts.
 * Shows aircraft entering proximity radius with threat-level coloring.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { useTrafficStore } from "@/stores/traffic-store";
import { THREAT_COLORS, THREAT_LABELS, type TrafficAlert } from "@/lib/airspace/types";

export function AlertsPanel() {
  const alerts = useTrafficStore((s) => s.alerts);
  const dismissAlert = useTrafficStore((s) => s.dismissAlert);

  const visible = alerts.filter((a) => !a.dismissed).slice(0, 5);

  if (visible.length === 0) return null;

  return (
    <div className="absolute bottom-16 right-4 z-30 flex flex-col gap-2 w-72">
      {visible.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />
      ))}
    </div>
  );
}

function AlertCard({ alert, onDismiss }: { alert: TrafficAlert; onDismiss: () => void }) {
  const t = useTranslations("airTraffic");
  const color = THREAT_COLORS[alert.level];
  const label = THREAT_LABELS[alert.level];
  const callsign = alert.callsign?.trim() || alert.icao24.toUpperCase();
  const age = Math.round((Date.now() - alert.timestamp) / 1000);

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-lg border backdrop-blur-md"
      style={{
        backgroundColor: `${color}10`,
        borderColor: `${color}40`,
      }}
    >
      <AlertTriangle size={14} style={{ color }} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold" style={{ color }}>
            {label}
          </span>
          <span className="text-[9px] font-mono text-text-tertiary">{t("agoSeconds", { seconds: age })}</span>
        </div>
        <p className="text-[10px] font-mono text-text-secondary mt-0.5">
          {callsign} at {alert.distanceKm.toFixed(1)}km,{" "}
          {alert.altitudeDelta > 0 ? "+" : ""}{Math.round(alert.altitudeDelta)}m
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer shrink-0"
      >
        <X size={10} />
      </button>
    </div>
  );
}
