/**
 * @module DroneTrailEntity
 * @description Renders a fading lime trail behind the drone during simulation playback.
 * A 500 ms sampler appends positions to one array that the polyline's
 * CallbackProperty returns as-is, so a rendered frame never copies the trail.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  CallbackProperty,
  Cartesian3,
  Color,
  JulianDate,
  type Viewer as CesiumViewer,
  type Entity,
  type SampledPositionProperty,
} from "cesium";

interface DroneTrailEntityProps {
  viewer: CesiumViewer | null;
  /** Id of the viewer track this trail follows; scopes the Cesium entity id. */
  trackId: string;
  positionProperty: SampledPositionProperty | null;
}

const TRAIL_COLOR = Color.fromCssColorString("#dff140").withAlpha(0.5);
const UPDATE_INTERVAL = 500; // ms between position samples
const MAX_TRAIL_POSITIONS = 7200; // 60 min at 500ms intervals
const NO_POSITIONS: Cartesian3[] = [];

export function DroneTrailEntity({ viewer, trackId, positionProperty }: DroneTrailEntityProps) {
  const positionsRef = useRef<Cartesian3[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !positionProperty) return;
    const entityId = `sim-drone-trail-${trackId}`;

    positionsRef.current = [];

    const positionsCallback = new CallbackProperty(() => {
      return positionsRef.current.length >= 2 ? positionsRef.current : NO_POSITIONS;
    }, false);

    const entity: Entity = viewer.entities.add({
      id: entityId,
      polyline: {
        positions: positionsCallback,
        width: 2,
        material: TRAIL_COLOR,
        clampToGround: false,
      },
    });

    // Sample position at regular intervals, detect backward jumps to clear trail
    let lastSeconds = -1;
    intervalRef.current = setInterval(() => {
      if (!viewer || viewer.isDestroyed()) return;
      const seconds = JulianDate.secondsDifference(
        viewer.clock.currentTime,
        viewer.clock.startTime
      );
      // Detect backward jump (stop/reset) — clear trail
      if (seconds < lastSeconds - 1) {
        positionsRef.current = [];
        viewer.scene.requestRender();
      }
      lastSeconds = seconds;
      if (!viewer.clock.shouldAnimate) return;
      const time = viewer.clock.currentTime;
      const pos = positionProperty.getValue(time);
      if (pos) {
        positionsRef.current.push(Cartesian3.clone(pos));
        if (positionsRef.current.length > MAX_TRAIL_POSITIONS) {
          positionsRef.current = positionsRef.current.slice(
            Math.floor(MAX_TRAIL_POSITIONS * 0.1)
          );
        }
        viewer.scene.requestRender();
      }
    }, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (!viewer.isDestroyed()) viewer.entities.removeById(entityId);
      positionsRef.current = [];
    };
  }, [viewer, trackId, positionProperty]);

  return null;
}
