"use client";

// HUD corner alerts. Derives live failsafe-ish badges from telemetry-store +
// drone-store. Logic stays simple and local; deeper failsafe flag decoding
// lives in the main GCS indicators.
//
// Two things here are easy to get backwards, and were:
//
// The battery and fence badges are claims about the aircraft right now, so
// they are drawn only from a fresh sample. An ungated read kept "FENCE BREACH"
// or "BATT CRIT" on screen for as long as the tab stayed open after a link
// loss, describing a vehicle state nobody had heard about in hours.
//
// The stale badge is the alert that must fire when telemetry stops, and it was
// the one that could not: its age check ran inside a memo with no time-passing
// dependency, so after the link died nothing re-rendered and the badge never
// appeared. It needs the clock tick more than any other badge on the screen.

import { useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly, TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

const BATTERY_WARN_PCT = 25;
const BATTERY_CRIT_PCT = 15;

type AlertKey = "battCrit" | "battLow" | "fenceBreach" | "linkStale";

export function CornerAlerts() {
  const t = useTranslations("cockpit.alerts");
  useTelemetryStore((s) => s._version);
  useClockTick();

  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const connectionState = useDroneStore((s) => s.connectionState);

  const buffers = useTelemetryStore.getState();
  const now = Date.now();
  const battery = freshOnly(buffers.battery.latest(), now);
  const fence = freshOnly(buffers.fenceStatus.latest(), now);

  const alerts: AlertKey[] = [];

  if (battery && Number.isFinite(battery.remaining)) {
    if (battery.remaining <= BATTERY_CRIT_PCT) {
      alerts.push("battCrit");
    } else if (battery.remaining <= BATTERY_WARN_PCT) {
      alerts.push("battLow");
    }
  }

  if (fence && fence.breachStatus > 0) {
    alerts.push("fenceBreach");
  }

  // Only meaningful once a link has existed: a GCS that never connected is
  // not a GCS whose link went stale.
  if (connectionState === "connected" && lastHeartbeat > 0) {
    if (now - lastHeartbeat > TELEMETRY_STALE_MS) {
      alerts.push("linkStale");
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="absolute top-12 left-4 flex flex-col gap-1 pointer-events-none">
      {alerts.map((key) => (
        <div
          key={key}
          data-testid={`hud-alert-${key}`}
          className="text-xs font-mono uppercase px-2 py-1 bg-status-error/70 text-white border border-status-error"
        >
          {t(key)}
        </div>
      ))}
    </div>
  );
}
