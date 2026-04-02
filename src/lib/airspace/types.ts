/**
 * @module airspace/types
 * @description Type definitions for the Air Traffic tab: airspace zones,
 * flyability assessment, NOTAMs, and TFRs.
 * @license GPL-3.0-only
 */

import type { Jurisdiction } from "@/lib/jurisdiction";

// ── Airspace Zone Types ────────────────────────────────────────────

export type AirspaceZoneType =
  | "classB"
  | "classC"
  | "classD"
  | "classE"
  | "restricted"
  | "prohibited"
  | "moa"
  | "tfr"
  | "dgcaGreen"
  | "dgcaYellow"
  | "dgcaRed"
  | "casaRestricted"
  | "casaCaution"
  | "ctr"
  | "tma"
  | "danger"
  | "alert"
  | "warning";

export interface AirspaceZone {
  id: string;
  name: string;
  type: AirspaceZoneType;
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon;
  floorAltitude: number;
  ceilingAltitude: number;
  authority: string;
  jurisdiction?: Jurisdiction;
  validFrom?: string;
  validTo?: string;
  laancCeiling?: number;
  /** Original circle parameters for geodetically correct rendering. */
  circle?: { lat: number; lon: number; radiusM: number };
  metadata: Record<string, string>;
}

/** Minimal GeoJSON polygon (avoids full GeoJSON dependency). */
export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJSONMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

// ── NOTAM / TFR ────────────────────────────────────────────────────

export interface Notam {
  id: string;
  title: string;
  text: string;
  issuer: string;
  effectiveFrom: string;
  effectiveTo: string;
  lat?: number;
  lon?: number;
  radius?: number;
  floorAltitude?: number;
  ceilingAltitude?: number;
}

export interface TemporaryRestriction {
  id: string;
  name: string;
  type: "tfr" | "temporary";
  geometry: GeoJSONPolygon;
  floorAltitude: number;
  ceilingAltitude: number;
  validFrom: string;
  validTo: string;
  authority: string;
  description: string;
}

// ── Flyability Assessment ──────────────────────────────────────────

export type FlyabilityVerdict = "clear" | "advisory" | "restricted";

export interface NearestAirport {
  name: string;
  icao: string;
  distanceKm: number;
  bearing: number;
}

export interface Flyability {
  verdict: FlyabilityVerdict;
  maxAltitudeAgl: number;
  zones: AirspaceZone[];
  nearestAirport: NearestAirport | null;
  activeNotams: Notam[];
  activeTfrs: TemporaryRestriction[];
  guidance: string;
  ctaLinks: CtaLink[];
}

export interface CtaLink {
  label: string;
  url: string;
}

// ── Bounding Box ───────────────────────────────────────────────────

export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

// ── Layer Visibility ───────────────────────────────────────────────

export interface AirTrafficLayers {
  airspace: boolean;
  restrictions: boolean;
  advisory: boolean;
  ownDrone: boolean;
  terrain: boolean;
  heatmap: boolean;
}

export const DEFAULT_LAYERS: AirTrafficLayers = {
  airspace: true,
  restrictions: true,
  advisory: false,
  ownDrone: true,
  terrain: true,
  heatmap: false,
};

// ── Zone Color Config ──────────────────────────────────────────────

export interface ZoneColorConfig {
  fill: string;
  fillOpacity: number;
  border: string;
  borderOpacity: number;
}

export const ZONE_COLORS: Record<AirspaceZoneType, ZoneColorConfig> = {
  classB:         { fill: "#3A82FF", fillOpacity: 0.20, border: "#3A82FF", borderOpacity: 0.8 },
  classC:         { fill: "#C850C0", fillOpacity: 0.20, border: "#C850C0", borderOpacity: 0.8 },
  classD:         { fill: "#3A82FF", fillOpacity: 0.15, border: "#3A82FF", borderOpacity: 0.7 },
  classE:         { fill: "#C850C0", fillOpacity: 0.10, border: "#C850C0", borderOpacity: 0.5 },
  restricted:     { fill: "#FF4444", fillOpacity: 0.18, border: "#FF4444", borderOpacity: 0.8 },
  prohibited:     { fill: "#FF4444", fillOpacity: 0.25, border: "#FF4444", borderOpacity: 0.9 },
  moa:            { fill: "#FF8C00", fillOpacity: 0.12, border: "#FF8C00", borderOpacity: 0.6 },
  tfr:            { fill: "#FF4444", fillOpacity: 0.30, border: "#FF4444", borderOpacity: 0.9 },
  dgcaGreen:      { fill: "#44FF44", fillOpacity: 0.12, border: "#44FF44", borderOpacity: 0.6 },
  dgcaYellow:     { fill: "#FFDD44", fillOpacity: 0.20, border: "#FFDD44", borderOpacity: 0.8 },
  dgcaRed:        { fill: "#FF4444", fillOpacity: 0.25, border: "#FF4444", borderOpacity: 0.9 },
  casaRestricted: { fill: "#FF4444", fillOpacity: 0.20, border: "#FF4444", borderOpacity: 0.8 },
  casaCaution:    { fill: "#FF8C00", fillOpacity: 0.18, border: "#FF8C00", borderOpacity: 0.7 },
  ctr:            { fill: "#3A82FF", fillOpacity: 0.15, border: "#3A82FF", borderOpacity: 0.7 },
  tma:            { fill: "#C850C0", fillOpacity: 0.18, border: "#C850C0", borderOpacity: 0.7 },
  danger:         { fill: "#FF8C00", fillOpacity: 0.20, border: "#FF8C00", borderOpacity: 0.7 },
  alert:          { fill: "#FF8C00", fillOpacity: 0.15, border: "#FF8C00", borderOpacity: 0.6 },
  warning:        { fill: "#FF8C00", fillOpacity: 0.18, border: "#FF8C00", borderOpacity: 0.6 },
};

// ── Provider result types ──────────────────────────────────────────

export interface AirspaceFetchResult {
  zones: AirspaceZone[];
  jurisdiction: Jurisdiction;
  timestamp: number;
}
