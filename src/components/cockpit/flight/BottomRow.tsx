"use client";

/**
 * @module cockpit/flight/BottomRow
 * @description The bottom row (cockpit spec `layout.json` `bottom_row`):
 * D (distance to home), H (height above home), H.S (horizontal speed), V.S
 * (vertical speed) and AGL (height above the ground: the ADOS pilot's
 * rangefinder `agl_m`, else a downward range finder, else the terrain
 * report). Values come from fresh samples only, except the latched home
 * position; a value with no source shows the no-data glyph.
 *
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { useTranslations } from "next-intl";

import { bottomRowValues } from "@/lib/cockpit/bottom-row";
import { isFresh } from "@/lib/telemetry/freshness";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { PILOT_STALE_MS } from "@/stores/nav-stream-store";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

function fresh<T extends { timestamp: number }>(s: T | undefined, now: number): T | null {
  return s !== undefined && isFresh(s.timestamp, now) ? s : null;
}

function metres(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return NO_DATA_GLYPH;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} km`;
  return `${v.toFixed(Math.abs(v) < 100 ? 1 : 0)} m`;
}

function speed(v: number | null): string {
  return v === null || !Number.isFinite(v) ? NO_DATA_GLYPH : `${v.toFixed(1)} m/s`;
}

export const BottomRow = memo(function BottomRow({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.row");
  const grid = useFlightGrid();
  useThrottledTelemetryVersion();
  const { pilot, receivedAt } = usePilotState(droneId);
  const rect = grid.zones.bottom_row;
  if (!rect) return null;

  const b = useTelemetryStore.getState();
  const now = Date.now();
  const vfr = fresh(b.vfr.latest(), now);
  const pilotFresh = receivedAt !== null && now - receivedAt <= PILOT_STALE_MS;
  const v = bottomRowValues({
    position: fresh(b.position.latest(), now),
    vfr: vfr && typeof vfr.groundspeed === "number" ? { groundspeed: vfr.groundspeed, climb: vfr.climb } : null,
    // HOME_POSITION is latched: the FC sends it on connect, arm and set-home
    // only, so it stays valid until it changes or the link drops.
    home: b.homePosition.latest() ?? null,
    rangefinder: fresh(b.distanceSensor.latest(), now),
    terrain: fresh(b.terrain.latest(), now),
    pilotAglM: pilotFresh ? (pilot?.aglM ?? null) : null,
    pilotAglSource: pilotFresh ? (pilot?.aglSource ?? null) : null,
    pilotAglStale: receivedAt !== null && !pilotFresh && pilot?.aglSource === "rangefinder",
  });
  const cells: { key: string; label: string; value: string; title: string }[] = [
    { key: "d", label: "D", value: metres(v.distM), title: t("d") },
    { key: "h", label: "H", value: metres(v.heightM), title: t("h") },
    { key: "hs", label: "H.S", value: speed(v.hSpeedMps), title: t("hs") },
    { key: "vs", label: "V.S", value: speed(v.vSpeedMps), title: t("vs") },
    { key: "agl", label: "AGL", value: metres(v.aglM), title: t("agl") },
  ];
  return (
    <div className="fs-panel fs-row" data-zone="bottom_row" style={rectStyle(rect)}>
      {cells.map((c) => (
        <div key={c.key} className="fs-row-cell" data-testid={`fs-row-${c.key}`} title={c.title}>
          <span className="fs-label">{c.label}</span>
          <span className="fs-value">{c.value}</span>
        </div>
      ))}
    </div>
  );
});
