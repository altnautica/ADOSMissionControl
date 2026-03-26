/**
 * @module use-sim-clock
 * @description CesiumJS Clock lifecycle hook — configures clock timing,
 * binds/unbinds to simulation store, syncs elapsed on every tick,
 * and handles follow-camera per-frame tracking.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import {
  JulianDate,
  ClockRange,
  Transforms,
  HeadingPitchRange,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  type Viewer as CesiumViewer,
  type Clock,
} from "cesium";
import {
  useSimulationStore,
  bindSimViewer,
  unbindSimViewer,
  type SimViewerBridge,
} from "@/stores/simulation-store";
import type { SampledProperties } from "@/lib/build-sampled-properties";
import type { FlightPlan } from "@/lib/simulation-utils";

/** Distance threshold for terrain cache invalidation (~10m in radians). */
const CACHE_THRESHOLD_RAD = 10 / 6_371_000;

/**
 * Manage CesiumJS Clock lifecycle: configure start/stop times,
 * bind to store, sync elapsed per tick, drive follow camera.
 */
export function useSimClock(
  viewer: CesiumViewer | null,
  sampled: SampledProperties | null,
  totalDuration: number,
  /** When true, sampled positions are absolute — skip terrain adjustment in follow cam. */
  useAbsolutePositions = false,
  /** Flight plan for speed/waypoint-index derivation in synced position. */
  flightPlan?: FlightPlan
): void {
  // Refs for onTick callback (avoids stale closures)
  const sampledRef = useRef(sampled);
  sampledRef.current = sampled;
  const absoluteRef = useRef(useAbsolutePositions);
  absoluteRef.current = useAbsolutePositions;
  const flightPlanRef = useRef(flightPlan);
  flightPlanRef.current = flightPlan;

  // Terrain height cache — avoids per-frame globe.getHeight() calls
  const terrainCache = useRef({ lon: 0, lat: 0, height: 0 });

  // Effect 1: Configure Clock + bind to store
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !sampled) return;
    const { startJulian } = sampled;
    const store = useSimulationStore.getState();

    viewer.clock.startTime = JulianDate.clone(startJulian);
    viewer.clock.stopTime = JulianDate.addSeconds(
      startJulian,
      totalDuration,
      new JulianDate()
    );
    viewer.clock.currentTime = JulianDate.clone(startJulian);
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.shouldAnimate = false;
    viewer.clock.multiplier = store.playbackSpeed;

    // Build a bridge that encapsulates all CesiumJS clock operations,
    // so the simulation store never imports cesium at runtime.
    const scratchJulian = new JulianDate();
    const bridge: SimViewerBridge = {
      seekClock: (seconds: number) => {
        if (viewer.isDestroyed()) return;
        JulianDate.addSeconds(startJulian, seconds, scratchJulian);
        viewer.clock.currentTime = JulianDate.clone(scratchJulian);
        viewer.scene.requestRender();
      },
      requestRender: () => {
        if (!viewer.isDestroyed()) viewer.scene.requestRender();
      },
      setAnimate: (animate: boolean) => {
        if (!viewer.isDestroyed()) viewer.clock.shouldAnimate = animate;
      },
      setMultiplier: (multiplier: number) => {
        if (!viewer.isDestroyed()) viewer.clock.multiplier = multiplier;
      },
      setStopTime: (duration: number) => {
        if (!viewer.isDestroyed()) {
          const stopTime = new JulianDate();
          JulianDate.addSeconds(startJulian, duration, stopTime);
          viewer.clock.stopTime = stopTime;
        }
      },
      getElapsed: () => {
        return JulianDate.secondsDifference(viewer.clock.currentTime, startJulian);
      },
      getShouldAnimate: () => viewer.clock.shouldAnimate,
      isAlive: () => !viewer.isDestroyed(),
    };

    bindSimViewer(viewer, bridge);

    return () => unbindSimViewer(viewer);
  }, [viewer, sampled, totalDuration]);

  // Effect 2: onTick — sync elapsed + follow camera
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const onTick = (clock: Clock) => {
      // 1. Sync elapsed to store (drives HUD, scrubber, all consumers)
      useSimulationStore.getState().syncFromClock();

      const s = sampledRef.current;

      // 2. Sync geodetic position from CesiumJS entity to store (authoritative for HUD)
      if (s?.sampledPosition && s?.sampledHeading) {
        const pos = s.sampledPosition.getValue(clock.currentTime);
        const hdg = s.sampledHeading.getValue(clock.currentTime);
        if (pos) {
          const carto = Cartographic.fromCartesian(pos);
          const lat = CesiumMath.toDegrees(carto.latitude);
          const lon = CesiumMath.toDegrees(carto.longitude);
          const headingDeg = typeof hdg === "number"
            ? (((-CesiumMath.toDegrees(hdg)) % 360) + 360) % 360
            : 0;

          // Get terrain height for AGL computation
          const cache = terrainCache.current;
          const dLon = Math.abs(carto.longitude - cache.lon);
          const dLat = Math.abs(carto.latitude - cache.lat);
          if (dLon > CACHE_THRESHOLD_RAD || dLat > CACHE_THRESHOLD_RAD) {
            const h = viewer.scene.globe.getHeight(carto);
            if (h !== undefined) {
              cache.lon = carto.longitude;
              cache.lat = carto.latitude;
              cache.height = h;
            }
          }

          const altAgl = absoluteRef.current
            ? carto.height - cache.height
            : carto.height; // AGL mode: position height IS the AGL value

          // Derive speed + waypoint index from flight plan segments
          const fp = flightPlanRef.current;
          const elapsed = useSimulationStore.getState().elapsed;
          let speed = 0;
          let waypointIndex = 0;
          if (fp && fp.segments.length > 0) {
            const segsDuration = fp.segments[fp.segments.length - 1].cumulativeDuration;
            if (elapsed >= segsDuration) {
              speed = 0;
              waypointIndex = fp.segments[fp.segments.length - 1].toIndex;
            } else {
              for (let i = 0; i < fp.segments.length; i++) {
                const seg = fp.segments[i];
                if (elapsed <= seg.cumulativeDuration) {
                  const segStart = i > 0 ? fp.segments[i - 1].cumulativeDuration : 0;
                  const timeInSeg = elapsed - segStart;
                  const t = seg.duration > 0 ? Math.min(timeInSeg / seg.duration, 1) : 1;
                  speed = seg.speed;
                  waypointIndex = t > 0.5 ? seg.toIndex : seg.fromIndex;
                  break;
                }
              }
            }
          }

          useSimulationStore.getState().syncPosition({
            lat, lon, altAgl, heading: headingDeg, speed, waypointIndex,
          });
        }
      }

      // 3. Follow camera (reads entity position directly — already interpolated by CesiumJS)
      const { cameraMode, followHeadingLocked } = useSimulationStore.getState();
      if (cameraMode === "follow" && s?.sampledPosition && s?.sampledHeading) {
        const pos = s.sampledPosition.getValue(clock.currentTime);
        const hdg = s.sampledHeading.getValue(clock.currentTime);
        if (pos) {
          let adjustedPos: Cartesian3;

          if (absoluteRef.current) {
            // Positions are already absolute — no terrain adjustment needed
            adjustedPos = pos;
          } else {
            // AGL mode: offset by terrain height with caching (cache already updated above)
            const carto = Cartographic.fromCartesian(pos);
            adjustedPos = Cartesian3.fromRadians(
              carto.longitude,
              carto.latitude,
              carto.height + terrainCache.current.height
            );
          }

          const transform = Transforms.eastNorthUpToFixedFrame(adjustedPos);
          const rawRange = Cartesian3.magnitude(viewer.camera.position);
          const range = Math.max(20, Math.min(10000, rawRange > 0 ? rawRange : 200));

          const cameraHeading = followHeadingLocked
            ? (typeof hdg === "number" ? -hdg : 0)
            : viewer.camera.heading;

          viewer.camera.lookAtTransform(
            transform,
            new HeadingPitchRange(
              cameraHeading,
              viewer.camera.pitch,
              range
            )
          );
        }
      }

      // 4. Request render for requestRenderMode support
      viewer.scene.requestRender();
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => {
      if (!viewer.isDestroyed()) viewer.clock.onTick.removeEventListener(onTick);
    };
  }, [viewer]);
}
