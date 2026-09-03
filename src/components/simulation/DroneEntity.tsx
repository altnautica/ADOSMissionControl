/**
 * @module DroneEntity
 * @description Renders the animated drone arrow billboard in the 3D scene.
 * Position and heading driven entirely by CesiumJS SampledPositionProperty
 * and SampledProperty — zero per-frame React code.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  CallbackProperty,
  HeightReference,
  type Viewer as CesiumViewer,
  type Entity,
  type SampledPositionProperty,
  type SampledProperty,
} from "cesium";

interface DroneEntityProps {
  viewer: CesiumViewer | null;
  positionProperty: SampledPositionProperty | null;
  headingProperty: SampledProperty | null;
  /** When true, positions are absolute (terrain-resolved). Use HeightReference.NONE. */
  useAbsoluteAlt?: boolean;
  /** When false, hides the drone entity (prevents visual pop during terrain loading). */
  visible?: boolean;
}

const DRONE_ENTITY_ID = "sim-drone";

const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
  <polygon points="12,2 20,20 12,16 4,20" fill="#dff140" stroke="#fff" stroke-width="1" opacity="0.95"/>
</svg>`;
const ARROW_DATA_URL = `data:image/svg+xml;base64,${typeof window !== "undefined" ? btoa(ARROW_SVG) : ""}`;

export function DroneEntity({ viewer, positionProperty, headingProperty, useAbsoluteAlt = false, visible = true }: DroneEntityProps) {
  const droneRef = useRef<Entity | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !positionProperty) return;

    // Create rotation property that compensates for camera heading
    // Without alignedAxis, billboard up = screen up, so rotation = camera.heading + sampledHeading
    const rotationProperty = new CallbackProperty((time) => {
      if (!viewer || viewer.isDestroyed()) return 0;
      const hdg = headingProperty?.getValue(time);
      return typeof hdg === "number" ? viewer.camera.heading + hdg : 0;
    }, false);

    const drone = viewer.entities.add({
      id: DRONE_ENTITY_ID,
      position: positionProperty, // CesiumJS evaluates at clock.currentTime every frame
      billboard: {
        image: ARROW_DATA_URL,
        width: 36,
        height: 36,
        rotation: rotationProperty,
        heightReference: useAbsoluteAlt ? HeightReference.NONE : HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: visible,
      },
    });
    droneRef.current = drone;

    // Under `requestRenderMode` the scene only paints when something asks it
    // to. An entity mutation Cesium does not observe therefore leaves a STALE
    // frame on screen, which on a flight surface is a false display — so every
    // add and every removal explicitly requests one.
    viewer.scene.requestRender();

    return () => {
      if (viewer && !viewer.isDestroyed()) viewer.entities.removeById(DRONE_ENTITY_ID);
      droneRef.current = null;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, positionProperty, headingProperty, useAbsoluteAlt, visible]);

  return null;
}
