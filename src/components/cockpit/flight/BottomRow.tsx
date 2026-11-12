"use client";

/**
 * @module cockpit/flight/BottomRow
 * @description The bottom row (cockpit spec `layout.json` `bottom_row`):
 * D (distance to home), H (height above home), H.S (horizontal speed), V.S
 * (vertical speed) and AGL (height above the ground: the ADOS pilot's
 * rangefinder `agl_m`, else a downward range finder, else the terrain
 * report). Values come from fresh samples only, except the latched home
 * position; a value with no source shows the no-data glyph. While the pilot
 * state is stale (`pilotFresh`) AGL reads no data, dimmed, whatever its
 * source. Where the row is too narrow for all five without them touching
 * (`bottomRowLabels`, from the row's own width) it shows D and H only.
 *
 * D is the shared distance format (`fmtDistance`); heights keep one decimal
 * below 100 m and V.S is signed (`fmtSigned1`, never "-0.0").
 *
 * @license GPL-3.0-only
 */

import { memo, useEffect, useState } from "react";

import { bottomRowValues } from "@/lib/cockpit/bottom-row";
import { specString } from "@/lib/cockpit/spec-strings";
import { isFresh } from "@/lib/telemetry/freshness";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { fmtDistance, fmtSigned1 } from "@/lib/hud/format";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useFlightGrid } from "./flight-context";
import { bottomRowLabels, rectStyle } from "./flight-grid";

function fresh<T extends { timestamp: number }>(s: T | undefined, now: number): T | null {
  return s !== undefined && isFresh(s.timestamp, now) ? s : null;
}

/** Re-check of the pilot state's age while no telemetry re-renders the row. */
const PILOT_TICK_MS = 500;

/** A height: one decimal below 100 m (never "-0.0"), else as a distance. */
function height(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return NO_DATA_GLYPH;
  return Math.abs(v) < 100 ? `${fmtSigned1(v)} m` : fmtDistance(v);
}

function speed(v: number | null, signed = false): string {
  if (v === null || !Number.isFinite(v)) return NO_DATA_GLYPH;
  return `${signed ? fmtSigned1(v) : v.toFixed(1)} m/s`;
}

export const BottomRow = memo(function BottomRow({ droneId }: { droneId: string }) {
  const grid = useFlightGrid();
  useThrottledTelemetryVersion();
  const { pilot, receivedAt } = usePilotState(droneId);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), PILOT_TICK_MS);
    return () => clearInterval(t);
  }, []);
  const rect = grid.zones.bottom_row;
  if (!rect) return null;

  const b = useTelemetryStore.getState();
  const now = Date.now();
  const vfr = fresh(b.vfr.latest(), now);
  const live = pilotFresh(receivedAt, now);
  // A pilot state that stopped arriving no longer vouches for any AGL.
  const pilotStale = receivedAt !== null && !live;
  const v = bottomRowValues({
    position: fresh(b.position.latest(), now),
    vfr: vfr && typeof vfr.groundspeed === "number" ? { groundspeed: vfr.groundspeed, climb: vfr.climb } : null,
    // HOME_POSITION is latched: the FC sends it on connect, arm and set-home
    // only, so it stays valid until it changes or the link drops.
    home: b.homePosition.latest() ?? null,
    rangefinder: fresh(b.distanceSensor.latest(), now),
    terrain: fresh(b.terrain.latest(), now),
    pilotAglM: live ? (pilot?.aglM ?? null) : null,
    pilotAglSource: live ? (pilot?.aglSource ?? null) : null,
    pilotAglStale: pilotStale,
  });
  const labels = bottomRowLabels(grid);
  const cells: { key: string; label: string; value: string; title: string; stale?: boolean }[] = [
    { key: "d", label: specString("cockpit.readout.distance"), value: fmtDistance(v.distM), title: specString("cockpit.readout.distance_title") },
    { key: "h", label: specString("cockpit.readout.height"), value: height(v.heightM), title: specString("cockpit.readout.height_title") },
  ];
  if (labels === "full") {
    cells.push(
      { key: "hs", label: specString("cockpit.readout.hspeed"), value: speed(v.hSpeedMps), title: specString("cockpit.readout.hspeed_title") },
      { key: "vs", label: specString("cockpit.readout.vspeed"), value: speed(v.vSpeedMps, true), title: specString("cockpit.readout.vspeed_title") },
      { key: "agl", label: specString("cockpit.readout.agl"), value: height(v.aglM), title: specString("cockpit.readout.agl_title"), stale: pilotStale },
    );
  }
  return (
    <div className="fs-panel fs-row" data-zone="bottom_row" data-labels={labels} style={rectStyle(rect)}>
      {cells.map((c) => (
        <div
          key={c.key}
          className="fs-row-cell"
          data-testid={`fs-row-${c.key}`}
          data-stale={c.stale ? "true" : undefined}
          title={c.title}
        >
          <span className="fs-label">{c.label}</span>
          <span className="fs-value" style={c.stale ? { color: "var(--fs-text-dim)" } : undefined}>
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
});
