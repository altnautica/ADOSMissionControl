/**
 * @module GeofenceOverlay
 * @description Leaflet overlay for geofence visualization — circle fence,
 * polygon fence, inclusion/exclusion zones, and altitude bands.
 * Reads FENCE_* params from the drone's parameter set and renders
 * corresponding map elements.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { Circle, Polygon, Tooltip } from "react-leaflet";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useGeofenceStore, type FenceZone } from "@/stores/geofence-store";

// ── Types ────────────────────────────────────────────────────

interface FenceConfig {
  enabled: boolean;
  /** Bitmask: bit 0 = alt max, bit 1 = circle, bit 2 = polygon */
  type: number;
  altMax: number;
  altMin: number;
  radius: number;
  margin: number;
  /** 0=Report, 1=RTL/Land, 2=Land, 3=Brake, 4=SmartRTL/RTL, 5=SmartRTL/Land */
  action: number;
  totalPoints: number;
}

interface GeofenceOverlayProps {
  /** Optional polygon points [[lat, lon], ...]. If provided, renders polygon fence. */
  polygonPoints?: [number, number][];
  /** Whether fence is currently breached. */
  breached?: boolean;
  /** Fence configuration — pass from GeofencePanel or parent store. */
  fenceConfig?: Partial<FenceConfig>;
}

// ── Helpers ──────────────────────────────────────────────────

const FENCE_TYPE_ALT_MAX = 1 << 0;
const FENCE_TYPE_CIRCLE = 1 << 1;
const FENCE_TYPE_POLYGON = 1 << 2;

const ACTION_LABELS: Record<number, string> = {
  0: "Report Only",
  1: "RTL or Land",
  2: "Always Land",
  3: "Brake",
  4: "SmartRTL/RTL",
  5: "SmartRTL/Land",
};

/** Colors for inclusion (green) and exclusion (red) zones */
const ZONE_COLORS = {
  inclusion: { stroke: "#22c55e", fill: "#22c55e" },
  exclusion: { stroke: "#ef4444", fill: "#ef4444" },
} as const;

/** Accept fence config as optional props — the GeofencePanel or parent should provide these. */
function useFenceConfig(overrides?: Partial<FenceConfig>): FenceConfig | null {
  return useMemo(() => {
    if (!overrides || !overrides.enabled) return null;
    return {
      enabled: overrides.enabled ?? false,
      type: overrides.type ?? 0,
      altMax: overrides.altMax ?? 0,
      altMin: overrides.altMin ?? 0,
      radius: overrides.radius ?? 0,
      margin: overrides.margin ?? 0,
      action: overrides.action ?? 0,
      totalPoints: overrides.totalPoints ?? 0,
    };
  }, [overrides]);
}

// ── Zone Overlay ─────────────────────────────────────────────

function ZoneOverlay({ zone }: { zone: FenceZone }) {
  const colors = ZONE_COLORS[zone.role];

  if (zone.type === "polygon" && zone.polygonPoints.length >= 3) {
    return (
      <Polygon
        positions={zone.polygonPoints}
        pathOptions={{
          color: colors.stroke,
          weight: 2,
          dashArray: zone.role === "exclusion" ? "4 4" : "8 4",
          fillColor: colors.fill,
          fillOpacity: zone.role === "exclusion" ? 0.12 : 0.06,
        }}
      >
        <Tooltip direction="center" sticky>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
            {zone.role === "inclusion" ? "Inclusion" : "Exclusion"} Zone ({zone.polygonPoints.length} pts)
          </span>
        </Tooltip>
      </Polygon>
    );
  }

  if (zone.type === "circle" && zone.circleCenter && zone.circleRadius > 0) {
    return (
      <Circle
        center={zone.circleCenter}
        radius={zone.circleRadius}
        pathOptions={{
          color: colors.stroke,
          weight: 2,
          dashArray: zone.role === "exclusion" ? "4 4" : "8 4",
          fillColor: colors.fill,
          fillOpacity: zone.role === "exclusion" ? 0.12 : 0.06,
        }}
      >
        <Tooltip direction="top" sticky>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
            {zone.role === "inclusion" ? "Inclusion" : "Exclusion"} Zone {zone.circleRadius}m
          </span>
        </Tooltip>
      </Circle>
    );
  }

  return null;
}

// ── Component ────────────────────────────────────────────────

export function GeofenceOverlay({ polygonPoints, breached = false, fenceConfig }: GeofenceOverlayProps) {
  const config = useFenceConfig(fenceConfig);
  const pos = useTelemetryLatest("position");
  const zones = useGeofenceStore((s) => s.zones);

  // Use home position as fence center (first trail point or current position)
  const homePos: [number, number] | null = useMemo(() => {
    if (pos && pos.lat !== 0 && pos.lon !== 0) return [pos.lat, pos.lon];
    return null;
  }, [pos]);

  if (!config || !homePos) return null;

  const hasCircle = (config.type & FENCE_TYPE_CIRCLE) !== 0;
  const hasPolygon = (config.type & FENCE_TYPE_POLYGON) !== 0;
  const hasAltMax = (config.type & FENCE_TYPE_ALT_MAX) !== 0;

  const fenceColor = breached ? "#ef4444" : "#f59e0b";
  const marginColor = breached ? "#ef4444" : "#f97316";

  return (
    <>
      {/* Circle fence */}
      {hasCircle && config.radius > 0 && (
        <>
          {/* Main fence boundary */}
          <Circle
            center={homePos}
            radius={config.radius}
            pathOptions={{
              color: fenceColor,
              weight: 2,
              dashArray: "8 4",
              fillColor: fenceColor,
              fillOpacity: 0.04,
            }}
          >
            <Tooltip direction="top" sticky>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
                Fence {config.radius}m | {ACTION_LABELS[config.action] ?? "Unknown"}
                {hasAltMax ? ` | Alt ≤${config.altMax}m` : ""}
              </span>
            </Tooltip>
          </Circle>

          {/* Margin warning ring */}
          {config.margin > 0 && (
            <Circle
              center={homePos}
              radius={config.radius - config.margin}
              pathOptions={{
                color: marginColor,
                weight: 1,
                dashArray: "4 8",
                fillOpacity: 0,
              }}
            />
          )}
        </>
      )}

      {/* Polygon fence */}
      {hasPolygon && polygonPoints && polygonPoints.length >= 3 && (
        <Polygon
          positions={polygonPoints}
          pathOptions={{
            color: fenceColor,
            weight: 2,
            dashArray: "8 4",
            fillColor: fenceColor,
            fillOpacity: 0.06,
          }}
        >
          <Tooltip direction="center" sticky>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
              Polygon Fence ({polygonPoints.length} pts) | {ACTION_LABELS[config.action] ?? "Unknown"}
            </span>
          </Tooltip>
        </Polygon>
      )}

      {/* Inclusion/exclusion zones */}
      {zones.map((zone) => (
        <ZoneOverlay key={zone.id} zone={zone} />
      ))}

      {/* Breach indicator — pulsing red circle at drone position */}
      {breached && pos && (
        <Circle
          center={[pos.lat, pos.lon]}
          radius={15}
          pathOptions={{
            color: "#ef4444",
            weight: 2,
            fillColor: "#ef4444",
            fillOpacity: 0.3,
          }}
        />
      )}
    </>
  );
}
