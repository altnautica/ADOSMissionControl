/**
 * @module GcsEntity
 * @description CesiumJS GCS position entity — green crosshair billboard + accuracy ellipse.
 * Follows the same renderless pattern as DroneEntity and WaypointEntities.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  HeightReference,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { useSettingsStore } from "@/stores/settings-store";

const GCS_ENTITY_ID = "gcs-position";
const GCS_ELLIPSE_ID = "gcs-accuracy";

const GCS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="12" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-opacity="0.4"/>
  <line x1="14" y1="4" x2="14" y2="11" stroke="#22c55e" stroke-width="1.5"/>
  <line x1="14" y1="17" x2="14" y2="24" stroke="#22c55e" stroke-width="1.5"/>
  <line x1="4" y1="14" x2="11" y2="14" stroke="#22c55e" stroke-width="1.5"/>
  <line x1="17" y1="14" x2="24" y2="14" stroke="#22c55e" stroke-width="1.5"/>
  <circle cx="14" cy="14" r="3" fill="#22c55e" fill-opacity="0.8"/>
</svg>`;
const GCS_DATA_URL = `data:image/svg+xml;base64,${typeof window !== "undefined" ? btoa(GCS_SVG) : ""}`;

interface GcsEntityProps {
  viewer: CesiumViewer | null;
}

export function GcsEntity({ viewer }: GcsEntityProps) {
  const locationEnabled = useSettingsStore((s) => s.locationEnabled);
  const position = useGcsLocationStore((s) => s.position);
  const billboardRef = useRef<Entity | null>(null);
  const ellipseRef = useRef<Entity | null>(null);

  // Create entities
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !locationEnabled || !position) return;

    const cartesian = Cartesian3.fromDegrees(position.lon, position.lat, 0);

    const billboard = viewer.entities.add({
      id: GCS_ENTITY_ID,
      position: cartesian,
      billboard: {
        image: GCS_DATA_URL,
        width: 28,
        height: 28,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "GCS",
        font: "10px JetBrains Mono, monospace",
        fillColor: Color.fromCssColorString("#22c55e"),
        pixelOffset: { x: 0, y: -20 } as any,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    billboardRef.current = billboard;

    const ellipse = viewer.entities.add({
      id: GCS_ELLIPSE_ID,
      position: cartesian,
      ellipse: {
        semiMajorAxis: Math.max(position.accuracy, 5),
        semiMinorAxis: Math.max(position.accuracy, 5),
        material: Color.fromCssColorString("#22c55e").withAlpha(0.08),
        outline: true,
        outlineColor: Color.fromCssColorString("#22c55e").withAlpha(0.3),
        height: 0,
      },
    });
    ellipseRef.current = ellipse;

    // Under `requestRenderMode` the scene only paints when something asks it
    // to. An entity mutation Cesium does not observe therefore leaves a STALE
    // frame on screen, which on a flight surface is a false display — so every
    // add and every removal explicitly requests one.
    viewer.scene.requestRender();

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.entities.removeById(GCS_ENTITY_ID);
        viewer.entities.removeById(GCS_ELLIPSE_ID);
      }
      billboardRef.current = null;
      ellipseRef.current = null;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, locationEnabled, !!position]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update position without recreating entities
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !position) return;

    const cartesian = Cartesian3.fromDegrees(position.lon, position.lat, 0);

    if (billboardRef.current) {
      billboardRef.current.position = new ConstantPositionProperty(cartesian);
    }
    if (ellipseRef.current) {
      ellipseRef.current.position = new ConstantPositionProperty(cartesian);
      if (ellipseRef.current.ellipse) {
        (ellipseRef.current.ellipse as any).semiMajorAxis = Math.max(position.accuracy, 5);
        (ellipseRef.current.ellipse as any).semiMinorAxis = Math.max(position.accuracy, 5);
      }
    }
  }, [viewer, position]);

  return null;
}
