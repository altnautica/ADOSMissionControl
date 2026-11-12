/**
 * @module MissionAdvisories
 * @description Advisory checks that sit alongside hard mission validation:
 * airport-proximity rings, soft geofence-buffer approach, and the RTL return
 * leg's terrain clearance. Advisories never block an upload — they inform the
 * operator before a hard limit is reached (blocking autopilot rules, the
 * mission item count among them, live in the validator). Each row that maps
 * to a waypoint is clickable to select it, matching the ValidationPanel issue rows.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, XCircle, Info } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { useGeofenceStore } from "@/stores/geofence-store";
import { checkAirportProximity } from "@/lib/airspace/airspace-check";
import {
  checkSoftBuffer,
  DEFAULT_SOFT_BUFFER_M,
  type SoftGeofence,
} from "@/lib/validation/soft-geofence";
import { checkRtlTerrainClearance, effectiveReturnAltitude } from "@/lib/terrain/rtl-advisory";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { getElevations } from "@/lib/terrain/terrain-provider";
import { useRtlReturnContext } from "@/hooks/use-rtl-return-context";

interface MissionAdvisoriesProps {
  waypoints: Waypoint[];
  onSelectWaypoint: (id: string) => void;
}

type AdvisoryLevel = "error" | "warn" | "info";

interface AdvisoryRowData {
  key: string;
  level: AdvisoryLevel;
  message: string;
  /** Index into `waypoints` when the advisory points at a specific waypoint. */
  waypointIndex?: number;
}

/** Ground elevation (metres MSL) under each rally point, kept with the points it was sampled for. */
function useRallyGround(rally: ReadonlyArray<{ lat: number; lon: number }>): Array<number | undefined> {
  const [sampled, setSampled] = useState<{ rally: typeof rally; ground: Array<number | undefined> } | null>(null);
  useEffect(() => {
    if (rally.length === 0) return;
    const controller = new AbortController();
    void getElevations(rally.map((p) => ({ lat: p.lat, lon: p.lon })), controller.signal).then((ground) => {
      if (!controller.signal.aborted) setSampled({ rally, ground: ground.map((g) => g ?? undefined) });
    });
    return () => controller.abort();
  }, [rally]);
  return sampled && sampled.rally === rally ? sampled.ground : [];
}

export function MissionAdvisories({
  waypoints,
  onSelectWaypoint,
}: MissionAdvisoriesProps) {
  const t = useTranslations("planner");

  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);

  // The RTL return leg: the planned home (else the launch point) with the
  // terrain under it, the vehicle's configured return altitude capped by an
  // altitude fence, and the rally points the autopilot may return to. The
  // return altitude is never assumed.
  const { home, rtlAltitude, returnCeilingM, rally, rules } = useRtlReturnContext(waypoints);
  const rallyGround = useRallyGround(rally);

  // Pure module checks only — the translation function is intentionally kept
  // out of the memo so its render-to-render identity never re-runs the checks.
  const { airport, soft, rtl, rtlUnchecked } = useMemo(() => {
    const fence: SoftGeofence = {};
    if (enabled) {
      if (fenceType === "polygon" && polygonPoints.length >= 3) {
        fence.polygonPoints = polygonPoints;
      } else if (fenceType === "circle" && circleCenter) {
        fence.circleCenter = circleCenter;
        fence.circleRadius = circleRadius;
      }
    }

    // With no ground under home the pure module returns [] and no RTL rows
    // render. Without the vehicle's own return altitude the check does not run.
    const rtl = home && rtlAltitude !== undefined
      ? checkRtlTerrainClearance(waypoints, home, rtlAltitude, DEFAULT_MIN_TERRAIN_CLEARANCE, {
          rally: rally.map((p, i) => ({ lat: p.lat, lon: p.lon, groundElevation: rallyGround[i] })),
          rules,
          ceilingM: returnCeilingM,
        })
      : [];

    return {
      airport: checkAirportProximity(waypoints, {}),
      soft: checkSoftBuffer(waypoints, fence, DEFAULT_SOFT_BUFFER_M),
      rtl,
      rtlUnchecked: home !== undefined && rtlAltitude === undefined,
    };
  }, [
    waypoints,
    enabled,
    fenceType,
    polygonPoints,
    circleCenter,
    circleRadius,
    home,
    rtlAltitude,
    returnCeilingM,
    rally,
    rallyGround,
    rules,
  ]);

  const rows: AdvisoryRowData[] = [];

  for (const issue of airport) {
    rows.push({
      key: `air-${issue.airport.icao}-${issue.waypointIndex}`,
      level: issue.level,
      message: issue.message,
      waypointIndex: issue.waypointIndex,
    });
  }

  for (const warning of soft) {
    rows.push({
      key: `soft-${warning.waypointIndex}`,
      level: "warn",
      message: t(`issue.${warning.text.key}`, warning.text.params),
      waypointIndex: warning.waypointIndex,
    });
  }

  // RTL / failsafe return-leg terrain advisories, against the vehicle's own
  // configured return altitude. Without that value the check is reported as
  // not run, never filled in with a guess.
  if (rtlUnchecked) {
    rows.push({ key: "rtl-note", level: "info", message: t("rtl.returnAltitudeUnknown") });
  } else if (rtl.length > 0 && rtlAltitude !== undefined) {
    const flown = effectiveReturnAltitude(rtlAltitude, returnCeilingM);
    rows.push({
      key: "rtl-note",
      level: "info",
      message: flown < rtlAltitude
        ? t("rtl.returnAltitudeCappedByFence", { alt: Math.round(flown), configured: Math.round(rtlAltitude) })
        : t("rtl.returnAltitudeFromVehicle", { alt: Math.round(rtlAltitude) }),
    });
    for (const issue of rtl) {
      rows.push({
        key: `rtl-${issue.waypointIndex}`,
        level: issue.level,
        message: issue.message,
        waypointIndex: issue.waypointIndex,
      });
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 border-t border-border-default pt-1.5 mt-0.5">
      <span className="px-1.5 font-body text-[11px] font-semibold text-text-tertiary">
        {t("validation.advisories")}
      </span>
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <AdvisoryRow
            key={row.key}
            row={row}
            onSelect={() => {
              if (row.waypointIndex === undefined) return;
              const id = waypoints[row.waypointIndex]?.id;
              if (id) onSelectWaypoint(id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single advisory row ─────────────────────────────────────

function AdvisoryRow({
  row,
  onSelect,
}: {
  row: AdvisoryRowData;
  onSelect: () => void;
}) {
  const clickable = row.waypointIndex !== undefined;
  const textColor =
    row.level === "error"
      ? "text-status-error"
      : row.level === "warn"
        ? "text-status-warning"
        : "text-text-tertiary";

  return (
    <button
      onClick={onSelect}
      className={`flex items-start gap-1.5 px-1.5 py-1 text-left transition-colors hover:bg-bg-tertiary ${
        clickable ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {row.level === "error" ? (
        <XCircle size={10} className="text-status-error shrink-0 mt-0.5" />
      ) : row.level === "warn" ? (
        <AlertTriangle size={10} className="text-status-warning shrink-0 mt-0.5" />
      ) : (
        <Info size={10} className="text-text-tertiary shrink-0 mt-0.5" />
      )}
      <span className={`text-[11px] ${textColor}`}>{row.message}</span>
    </button>
  );
}
