/**
 * @module NoFlyZoneOverlay
 * @description Renders the no-fly polygons for the operator's region on the
 * Leaflet map. Toggle via settings store. Red semi-transparent polygons for
 * airports, orange for military, yellow for other restricted areas.
 *
 * The layer draws only for a region this build actually carries data for.
 * With no region stated, or a region with no dataset, it draws NOTHING and
 * reports that upward through {@link onDataState} so the control can say so.
 * An empty layer and clear airspace look identical on a map, so the caller
 * owns telling the operator which one they are looking at.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { Polygon, Tooltip } from "react-leaflet";
import {
  noFlyZonesForRegion,
  type NoFlyZone,
} from "@/lib/no-fly-zones";

const TYPE_COLORS: Record<NoFlyZone["type"], { stroke: string; fill: string }> = {
  airport: { stroke: "#ef4444", fill: "#ef4444" },
  military: { stroke: "#f97316", fill: "#f97316" },
  restricted: { stroke: "#eab308", fill: "#eab308" },
};

const TYPE_LABELS: Record<NoFlyZone["type"], string> = {
  airport: "Airport NFZ",
  military: "Military NFZ",
  restricted: "Restricted",
};

/** What the layer is actually showing, for the control to render. */
export type NoFlyDataState = "drawn" | "no-region" | "no-data-for-region";

interface NoFlyZoneOverlayProps {
  visible?: boolean;
  /** ISO 3166-1 alpha-2 code, or null when the operator has not stated one. */
  region: string | null;
  /** Told what the layer resolved to, including when it drew nothing. */
  onDataState?: (state: NoFlyDataState) => void;
}

export function NoFlyZoneOverlay({
  visible = true,
  region,
  onDataState,
}: NoFlyZoneOverlayProps) {
  const zones = noFlyZonesForRegion(region);
  const state: NoFlyDataState = !region
    ? "no-region"
    : zones === null
      ? "no-data-for-region"
      : "drawn";

  useEffect(() => {
    onDataState?.(state);
  }, [state, onDataState]);

  if (!visible || zones === null) return null;

  return (
    <>
      {zones.map((zone) => {
        const colors = TYPE_COLORS[zone.type];
        return (
          <Polygon
            key={zone.name}
            positions={zone.polygon}
            pathOptions={{
              color: colors.stroke,
              weight: 1.5,
              dashArray: "6 3",
              fillColor: colors.fill,
              fillOpacity: 0.1,
            }}
          >
            <Tooltip direction="center" sticky>
              <span
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 10,
                  color: colors.stroke,
                }}
              >
                {TYPE_LABELS[zone.type]}: {zone.name}
              </span>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}
