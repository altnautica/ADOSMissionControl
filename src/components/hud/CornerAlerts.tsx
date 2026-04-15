"use client";

// HUD corner alerts. Derives live failsafe-ish badges from telemetry-store
// + drone-store. Phase 2 Wave C keeps the logic simple and local; deeper
// failsafe flag decoding lives in the main GCS indicators.

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

const BATTERY_WARN_PCT = 25;
const BATTERY_CRIT_PCT = 15;
const HEARTBEAT_STALE_MS = 3000;

export function CornerAlerts() {
  useTelemetryStore((s) => s._version);

  const battery = useTelemetryStore((s) => s.battery.latest());
  const fence = useTelemetryStore((s) => s.fenceStatus.latest());
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const connectionState = useDroneStore((s) => s.connectionState);

  const alerts = useMemo(() => {
    const out: string[] = [];

    if (battery && Number.isFinite(battery.remaining)) {
      if (battery.remaining <= BATTERY_CRIT_PCT) {
        out.push("BATT CRIT");
      } else if (battery.remaining <= BATTERY_WARN_PCT) {
        out.push("BATT LOW");
      }
    }

    if (fence && fence.breachStatus > 0) {
      out.push("FENCE BREACH");
    }

    // GCS-link freshness. Only flag when we've previously been connected.
    if (connectionState === "connected" && lastHeartbeat > 0) {
      const age = Date.now() - lastHeartbeat;
      if (age > HEARTBEAT_STALE_MS) {
        out.push("LINK STALE");
      }
    }

    return out;
  }, [battery, fence, lastHeartbeat, connectionState]);

  if (alerts.length === 0) return null;

  return (
    <div className="absolute top-12 left-4 flex flex-col gap-1 pointer-events-none">
      {alerts.map((a) => (
        <div
          key={a}
          className="text-xs font-mono uppercase px-2 py-1 bg-red-900/80 text-white border border-red-400"
        >
          {a}
        </div>
      ))}
    </div>
  );
}
