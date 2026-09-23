/**
 * @module PlannerLiveVehicle
 * @description The planner map's live-vehicle surfaces: the GPS status badge
 * and the heading / track / target guidance vectors. They own the telemetry
 * subscriptions, so a position tick re-renders these two small components and
 * not the whole map layer tree. A sample older than the shared staleness window
 * is not shown: the badge reads "GPS --" and the vectors disappear, instead of
 * a frozen fix and frozen lines after the link drops.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useSettingsStore } from "@/stores/settings-store";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";
import { freshOnly } from "@/lib/telemetry/freshness";
import { projectByBearing, getLineTypeDashArray, GPS_FIX_LABELS } from "@/lib/drawing/geo-utils";

const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });

type Segment = [[number, number], [number, number]];

/** A guidance vector from the vehicle along a bearing, or null without both. */
function segment(origin: [number, number] | null, bearingDeg: number | undefined, length: number): Segment | null {
  return origin && bearingDeg !== undefined
    ? [origin, projectByBearing(origin[0], origin[1], bearingDeg, length)]
    : null;
}

/** GPS fix badge over the map; "GPS --" until a fresh fix report exists. */
export function PlannerGpsBadge() {
  useClockTick();
  const now = useClockStore((s) => s.now);
  const gps = freshOnly(useTelemetryLatest("gps"), now);
  const fixType = gps?.fixType;
  const fixLabel = fixType != null ? (GPS_FIX_LABELS[fixType] ?? `FIX ${fixType}`) : "GPS --";
  const tone = fixType == null
    ? "text-text-tertiary"
    : fixType >= 3 ? "text-status-success" : fixType >= 2 ? "text-status-warning" : "text-status-error";
  return (
    <span className={`absolute top-2 left-2 z-[1000] text-[10px] font-mono bg-bg-primary/80 backdrop-blur-md rounded px-1.5 py-0.5 border border-border-strong shadow-lg ${tone}`}>
      {fixLabel} | {gps?.satellites ?? "--"} SAT
    </span>
  );
}

/** Heading, track-to-waypoint and target-heading vectors from the live vehicle. */
export function PlannerGuidanceVectors() {
  useClockTick();
  const now = useClockStore((s) => s.now);
  const pos = freshOnly(useTelemetryLatest("position"), now);
  const nav = freshOnly(useTelemetryLatest("navController"), now);

  const hdgLength = useSettingsStore((s) => s.guidanceHdgLength);
  const hdgWidth = useSettingsStore((s) => s.guidanceHdgWidth);
  const hdgLineType = useSettingsStore((s) => s.guidanceHdgLineType);
  const hdgColor = useSettingsStore((s) => s.guidanceHdgColor);
  const hdgEnabled = useSettingsStore((s) => s.guidanceHdgEnabled);
  const trackLength = useSettingsStore((s) => s.guidanceTrackWpLength);
  const trackWidth = useSettingsStore((s) => s.guidanceTrackWpWidth);
  const trackLineType = useSettingsStore((s) => s.guidanceTrackWpLineType);
  const trackColor = useSettingsStore((s) => s.guidanceTrackWpColor);
  const trackEnabled = useSettingsStore((s) => s.guidanceTrackWpEnabled);
  const tgtLength = useSettingsStore((s) => s.guidanceTgtHdgLength);
  const tgtWidth = useSettingsStore((s) => s.guidanceTgtHdgWidth);
  const tgtLineType = useSettingsStore((s) => s.guidanceTgtHdgLineType);
  const tgtColor = useSettingsStore((s) => s.guidanceTgtHdgColor);
  const tgtEnabled = useSettingsStore((s) => s.guidanceTgtHdgEnabled);

  // Primitive inputs, so a tick that does not move the vehicle keeps every
  // segment (and the polyline positions) referentially stable.
  const lat = pos?.lat;
  const lon = pos?.lon;
  const origin = useMemo<[number, number] | null>(
    () => (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0) ? [lat, lon] : null),
    [lat, lon],
  );
  const heading = pos?.heading;
  const targetBearing = nav?.targetBearing;
  const navBearing = nav?.navBearing;
  const hdgLine = useMemo(() => segment(origin, heading, hdgLength), [origin, heading, hdgLength]);
  const trackLine = useMemo(() => segment(origin, targetBearing, trackLength), [origin, targetBearing, trackLength]);
  const tgtLine = useMemo(() => segment(origin, navBearing, tgtLength), [origin, navBearing, tgtLength]);

  const hdgStyle = useMemo(
    () => ({ color: hdgColor, weight: hdgWidth, dashArray: getLineTypeDashArray(hdgLineType), opacity: 0.8 }),
    [hdgColor, hdgWidth, hdgLineType],
  );
  const trackStyle = useMemo(
    () => ({ color: trackColor, weight: trackWidth, dashArray: getLineTypeDashArray(trackLineType), opacity: 0.8 }),
    [trackColor, trackWidth, trackLineType],
  );
  const tgtStyle = useMemo(
    () => ({ color: tgtColor, weight: tgtWidth, dashArray: getLineTypeDashArray(tgtLineType), opacity: 0.8 }),
    [tgtColor, tgtWidth, tgtLineType],
  );

  return (
    <>
      {hdgEnabled && hdgLine && <Polyline positions={hdgLine} pathOptions={hdgStyle} />}
      {trackEnabled && trackLine && <Polyline positions={trackLine} pathOptions={trackStyle} />}
      {tgtEnabled && tgtLine && <Polyline positions={tgtLine} pathOptions={tgtStyle} />}
    </>
  );
}
