"use client";

/**
 * @module dashboard/FleetTelemetryCard
 * @description Per-aircraft FC readout (sats, voltage, mode, arm state).
 *
 * Lists only drones with a flight controller attached: a ground station,
 * workstation or FC-less companion has no FC readings to show. A field the FC
 * has not reported (no GPS, no battery, an unknown remaining) renders "—", and
 * mode and arm state show only once a heartbeat has been heard.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { selectFleetSummary } from "@/stores/node-registry/fleet-summary";
import { useBatteryThresholds } from "@/lib/battery-bands";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MODE_DESCRIPTIONS } from "@/components/fc/flight-modes/flight-mode-constants";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

export function FleetTelemetryCard() {
  const t = useTranslations("status");
  const drones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);
  const { telemetryRows, armedCount, gps } = selectFleetSummary(
    drones,
    useBatteryThresholds(),
  );
  const linkLost = telemetryRows.filter((r) => r.linkLost).length;

  if (telemetryRows.length === 0) {
    return (
      <Card title="Fleet Telemetry">
        <span className="text-[11px] text-text-tertiary">No connected drones</span>
      </Card>
    );
  }

  return (
    <Card title="Fleet Telemetry">
      {/* Summary row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">{t("connected")}</span>
          <span className="text-xs font-mono font-semibold text-text-primary tabular-nums">
            {telemetryRows.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">{t("armed")}</span>
          <span className="text-xs font-mono font-semibold text-status-warning tabular-nums">
            {armedCount}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">3D Fix</span>
          <span className="text-xs font-mono font-semibold text-status-success tabular-nums">
            {gps.fix3d}/{gps.reporting}
          </span>
        </div>
        {gps.lowSats > 0 && (
          <Badge variant="warning">{gps.lowSats} low sats</Badge>
        )}
        {linkLost > 0 && (
          <Badge variant="error">{linkLost} link lost</Badge>
        )}
      </div>

      {/* Per-drone rows */}
      <div className="flex flex-col gap-1">
        {telemetryRows.map((r) => (
          <div key={r.drone.id} className="flex items-center justify-between text-[10px] py-0.5">
            <span className="text-text-secondary truncate w-20">
              {profiles[r.drone.id]?.displayName ?? r.drone.name}
            </span>
            {r.linkLost ? (
              // The FC stopped talking: its last sats, voltage, mode and arm
              // state describe an aircraft the GCS can no longer hear.
              <Badge variant="error" size="sm">LINK LOST</Badge>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono tabular-nums ${
                    r.satellites !== null && r.satellites < 6 && r.fixType !== null && r.fixType > 0
                      ? "text-status-warning"
                      : "text-text-tertiary"
                  }`}
                >
                  {r.satellites !== null ? `${r.satellites}sat` : "—"}
                </span>
                <span
                  className={`font-mono tabular-nums ${
                    r.band === "critical"
                      ? "text-status-error"
                      : r.band === "warning"
                        ? "text-status-warning"
                        : "text-text-tertiary"
                  }`}
                >
                  {r.voltage !== null ? `${r.voltage.toFixed(1)}V` : "—"}
                </span>
                {r.heard ? (
                  <FleetModeLabel mode={r.drone.flightMode} />
                ) : (
                  <span className="font-mono text-text-tertiary w-14 text-right">—</span>
                )}
                <Badge variant={r.armState === "armed" ? "warning" : "neutral"} size="sm">
                  {r.armState === "armed" ? "ARM" : r.armState === "disarmed" ? "DIS" : "—"}
                </Badge>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function FleetModeLabel({ mode }: { mode: string }) {
  const [show, setShow] = useState(false);
  const desc = MODE_DESCRIPTIONS[mode as UnifiedFlightMode];

  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="font-mono text-text-tertiary w-14 text-right cursor-default">{mode}</span>
      {show && desc && (
        <div className="absolute right-0 bottom-full mb-1 z-50 bg-bg-tertiary border border-border-default px-2 py-1 text-[10px] text-text-secondary whitespace-nowrap">
          {desc}
        </div>
      )}
    </div>
  );
}
