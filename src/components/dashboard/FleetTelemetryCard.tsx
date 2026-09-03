"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MODE_DESCRIPTIONS } from "@/components/fc/flight-modes/flight-mode-constants";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

export function FleetTelemetryCard() {
  const t = useTranslations("status");
  const drones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);

  const connected = drones.filter((d) => d.connectionState !== "disconnected");
  const armed = connected.filter((d) => d.armState === "armed");

  // GPS health
  const withGps = connected.filter((d) => d.gps);
  const gps3d = withGps.filter((d) => d.gps!.fixType >= 3).length;
  const lowSats = withGps.filter((d) => d.gps!.satellites < 6 && d.gps!.fixType > 0).length;

  // Per-drone telemetry rows (connected only)
  const droneRows = connected.map((d) => {
    const name = profiles[d.id]?.displayName ?? d.name;
    const sats = d.gps?.satellites ?? 0;
    const fix = d.gps?.fixType ?? 0;
    const voltage = d.battery?.voltage ?? 0;
    const pct = d.battery?.remaining ?? 0;
    return { id: d.id, name, sats, fix, voltage, pct, mode: d.flightMode, armState: d.armState };
  });

  if (connected.length === 0) {
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
            {connected.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">{t("armed")}</span>
          <span className="text-xs font-mono font-semibold text-status-warning tabular-nums">
            {armed.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">3D Fix</span>
          <span className="text-xs font-mono font-semibold text-status-success tabular-nums">
            {gps3d}/{withGps.length}
          </span>
        </div>
        {lowSats > 0 && (
          <Badge variant="warning">{lowSats} low sats</Badge>
        )}
      </div>

      {/* Per-drone rows */}
      <div className="flex flex-col gap-1">
        {droneRows.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-[10px] py-0.5">
            <span className="text-text-secondary truncate w-20">{d.name}</span>
            <div className="flex items-center gap-2">
              <span className={`font-mono tabular-nums ${d.sats < 6 && d.fix > 0 ? "text-status-warning" : "text-text-tertiary"}`}>
                {d.sats}sat
              </span>
              <span className={`font-mono tabular-nums ${d.pct < 25 ? "text-status-error" : "text-text-tertiary"}`}>
                {d.voltage.toFixed(1)}V
              </span>
              <FleetModeLabel mode={d.mode} />
              <Badge variant={d.armState === "armed" ? "warning" : "neutral"} size="sm">
                {d.armState === "armed" ? "ARM" : "DIS"}
              </Badge>
            </div>
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
