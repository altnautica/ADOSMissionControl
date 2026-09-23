/**
 * @module MissionAdvisories
 * @description Advisory checks that sit alongside hard mission validation:
 * airport-proximity rings, soft geofence-buffer approach, and FC mission
 * item-count headroom. Advisories never block an upload — they inform the
 * operator before a hard limit is reached. Each row that maps to a waypoint is
 * clickable to select it, matching the ValidationPanel issue rows.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, XCircle, Info } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import type { FirmwareType } from "@/lib/protocol/types/enums";
import type { DroneProtocol } from "@/lib/protocol/types";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useDroneManager } from "@/stores/drone-manager";
import { checkAirportProximity } from "@/lib/airspace/airspace-check";
import {
  checkSoftBuffer,
  DEFAULT_SOFT_BUFFER_M,
  type SoftGeofence,
} from "@/lib/validation/soft-geofence";
import {
  checkItemCount,
  fcFamilyFromFirmware,
} from "@/lib/validation/fc-item-count";
import { checkRtlTerrainClearance } from "@/lib/terrain/rtl-advisory";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { getElevation } from "@/lib/terrain/terrain-provider";
import { useTelemetryStore } from "@/stores/telemetry-store";

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

/**
 * Return altitude (metres above home) assumed for the RTL return-leg terrain
 * check when no configured RTL altitude is available synchronously in the
 * planner. A neutral fallback only — the advisory copy never presents it as the
 * operator's own configured value.
 */
const DEFAULT_RTL_RETURN_ALT_M = 30;

/** Human-readable firmware family label for the item-count advisory copy. */
const FIRMWARE_LABEL: Record<string, string> = {
  ardupilot: "ArduPilot",
  px4: "PX4",
  betaflight: "Betaflight",
  inav: "iNav",
};

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

  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const firmware: FirmwareType | undefined = getProtocol()?.getVehicleInfo()
    ?.firmwareType;

  // The latest telemetry home sample (a RingBuffer whose reference is stable, so
  // it is re-read when the panel renders rather than on every home push).
  const homePosition = useTelemetryStore((s) => s.homePosition);
  const homeSample = homePosition.toArray().at(-1);
  const homeLat = homeSample?.lat;
  const homeLon = homeSample?.lon;

  // Terrain under the telemetry home, sampled for that exact point. The RTL
  // datum is home's own ground, so the telemetry home is used only once it has
  // a sample of its own; WP1's terrain belongs to WP1.
  const [homeTerrain, setHomeTerrain] = useState<{ lat: number; lon: number; elevation: number } | null>(null);
  useEffect(() => {
    if (homeLat === undefined || homeLon === undefined) return;
    const controller = new AbortController();
    void getElevation(homeLat, homeLon, controller.signal).then((elevation) => {
      if (!controller.signal.aborted && elevation !== null) {
        setHomeTerrain({ lat: homeLat, lon: homeLon, elevation });
      }
    });
    return () => controller.abort();
  }, [homeLat, homeLon]);

  // ArduPlane refuses to arm when the mission holds a DO_LAND_START while
  // RTL_AUTOLAND is 0, so the connected plane's value is read whenever the
  // plan has one. The reading is kept with the link it came from.
  const landStartIndex = waypoints.findIndex((w) => w.command === "DO_LAND_START");
  const [rtlAutoland, setRtlAutoland] = useState<{ protocol: DroneProtocol; value: number } | null>(null);
  const needsAutoland = landStartIndex >= 0 && firmware === "ardupilot-plane";
  useEffect(() => {
    if (!needsAutoland) return;
    const protocol = getProtocol();
    if (!protocol) return;
    let live = true;
    protocol.getParameter("RTL_AUTOLAND").then(
      (param) => { if (live) setRtlAutoland({ protocol, value: param.value }); },
      () => {},
    );
    return () => { live = false; };
  }, [needsAutoland, getProtocol]);

  // Pure module checks only — the translation function is intentionally kept
  // out of the memo so its render-to-render identity never re-runs the checks.
  const { airport, soft, itemCount, rtl } = useMemo(() => {
    const fence: SoftGeofence = {};
    if (enabled) {
      if (fenceType === "polygon" && polygonPoints.length >= 3) {
        fence.polygonPoints = polygonPoints;
      } else if (fenceType === "circle" && circleCenter) {
        fence.circleCenter = circleCenter;
        fence.circleRadius = circleRadius;
      }
    }

    // RTL / failsafe return-leg terrain clearance. Home is the telemetry home
    // with the terrain sampled beneath it; without that sample both the
    // coordinates and the elevation come from the first waypoint, never a mix.
    // With no terrain at all the pure module returns [] and no RTL rows render.
    const first = waypoints[0];
    const telemetryHome = homeTerrain && homeTerrain.lat === homeLat && homeTerrain.lon === homeLon
      ? { lat: homeTerrain.lat, lon: homeTerrain.lon, groundElevation: homeTerrain.elevation }
      : null;
    const home = telemetryHome
      ?? (first && first.groundElevation !== undefined
        ? { lat: first.lat, lon: first.lon, groundElevation: first.groundElevation }
        : null);
    const rtl = home
      ? checkRtlTerrainClearance(
          waypoints,
          home,
          DEFAULT_RTL_RETURN_ALT_M,
          DEFAULT_MIN_TERRAIN_CLEARANCE,
        )
      : [];

    return {
      airport: checkAirportProximity(waypoints, {}),
      soft: checkSoftBuffer(waypoints, fence, DEFAULT_SOFT_BUFFER_M),
      itemCount: checkItemCount(waypoints, firmware ? { firmware } : {}),
      rtl,
    };
  }, [
    waypoints,
    enabled,
    fenceType,
    polygonPoints,
    circleCenter,
    circleRadius,
    firmware,
    homeLat,
    homeLon,
    homeTerrain,
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
      message: warning.message,
      waypointIndex: warning.waypointIndex,
    });
  }

  // Item-count headroom is always informative: it reports the plan size against
  // the FC storage ceiling even when comfortably under it.
  let itemCountMessage: string;
  if (itemCount.level === "warn") {
    const family = firmware ? fcFamilyFromFirmware(firmware) : null;
    const label = (family && FIRMWARE_LABEL[family]) || "FC";
    itemCountMessage =
      itemCount.count >= itemCount.limit
        ? t("itemCount.warnOverLimit", {
            firmware: label,
            count: itemCount.count,
            limit: itemCount.limit,
          })
        : t("itemCount.warnNearLimit", {
            firmware: label,
            count: itemCount.count,
            limit: itemCount.limit,
          });
  } else {
    itemCountMessage = t("itemCount.advisory", {
      count: itemCount.count,
      limit: itemCount.limit,
    });
  }
  rows.push({
    key: "item-count",
    level: itemCount.level === "warn" ? "warn" : "info",
    message: itemCountMessage,
  });

  if (needsAutoland && rtlAutoland?.protocol === getProtocol() && rtlAutoland.value === 0) {
    rows.push({
      key: "rtl-autoland",
      level: "warn",
      message: t("rtl.landStartNeedsAutoland"),
      waypointIndex: landStartIndex,
    });
  }

  // RTL / failsafe return-leg terrain advisories. These use an assumed return
  // altitude (no configured RTL altitude is available synchronously here), so a
  // neutral context note precedes them — the derived numbers in the pure-module
  // messages are never claimed as the operator's configured value.
  if (rtl.length > 0) {
    rows.push({
      key: "rtl-note",
      level: "info",
      message: t("rtl.assumedReturnAltitude", { alt: DEFAULT_RTL_RETURN_ALT_M }),
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
      <span className="px-1.5 text-[9px] font-mono uppercase tracking-wide text-text-tertiary">
        {t("validation.advisories")}
      </span>
      <div className="flex flex-col gap-0.5 max-h-[120px] overflow-y-auto">
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
      <span className={`text-[10px] font-mono ${textColor}`}>{row.message}</span>
    </button>
  );
}
