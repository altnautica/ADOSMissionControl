"use client";

/**
 * @module OverviewUplinkWidget
 * @description Phase 3 compact uplink summary widget for the Hardware Overview
 * page. Shows active interface, health dot, and the most recent failover line.
 * Subscribes to the ground-station-store uplink slice populated by the WS.
 * @license GPL-3.0-only
 */

import { Radio, Wifi, Cable, Signal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGroundStationStore } from "@/stores/ground-station-store";

function ifaceLabel(iface: string | null): string {
  if (!iface) return "None";
  switch (iface) {
    case "ethernet":
      return "Ethernet";
    case "wifi_client":
      return "WiFi Client";
    case "modem_4g":
      return "4G Modem";
    case "ap":
      return "Access Point";
    default:
      return iface;
  }
}

function ifaceIcon(iface: string | null) {
  if (iface === "ethernet") return <Cable size={14} />;
  if (iface === "wifi_client") return <Wifi size={14} />;
  if (iface === "modem_4g") return <Signal size={14} />;
  return <Radio size={14} />;
}

function healthColor(health: "ok" | "degraded" | "down"): string {
  if (health === "down") return "bg-status-error";
  if (health === "degraded") return "bg-status-warning";
  return "bg-status-success";
}

function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "Never";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return secs + "s ago";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

export function OverviewUplinkWidget() {
  const uplink = useGroundStationStore((s) => s.uplink);
  const lastFailover = uplink.failover_log[0] ?? null;

  return (
    <section className="mb-5 rounded-lg border border-border-primary bg-surface-secondary p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">Uplink</h2>
        <div className="flex items-center gap-2">
          <span
            className={cn("h-2 w-2 rounded-full", healthColor(uplink.health))}
            aria-hidden="true"
          />
          <span className="text-xs text-text-secondary capitalize">
            {uplink.health}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-text-primary">
          <span className="text-text-secondary">{ifaceIcon(uplink.active)}</span>
          <span className="text-sm">Active:</span>
          <span className="font-mono text-sm">{ifaceLabel(uplink.active)}</span>
        </div>
        <div className="text-xs text-text-tertiary">
          Last failover: {lastFailover ? formatRelative(lastFailover.timestamp) : "Never"}
        </div>
      </div>

      {uplink.data_cap && uplink.data_cap.cap_mb > 0 ? (
        <div className="mt-3 text-xs text-text-secondary">
          Data cap: {uplink.data_cap.percent.toFixed(0)}% used ({uplink.data_cap.state})
        </div>
      ) : null}
    </section>
  );
}
