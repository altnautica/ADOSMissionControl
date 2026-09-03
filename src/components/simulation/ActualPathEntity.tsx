/**
 * @module ActualPathEntity
 * @description Overlays the ACTUAL flown path (loaded from a recorded flight log
 * via the sim-replay store) as a 3D polyline on the planned mission, so
 * planned-vs-actual is visible side by side. Draws the flown track in amber to
 * stand clearly apart from the blue planned path, a dashed ground shadow for
 * readability, and start / end markers. Renders nothing when no track is loaded.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  PolylineDashMaterialProperty,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  DistanceDisplayCondition,
  NearFarScalar,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import { useSimReplayStore } from "@/stores/sim-replay-store";
import { MAP_COLORS } from "@/lib/map-constants";
import { loadGeoidGrid, mslToEllipsoidal } from "@/lib/terrain/geoid";

interface ActualPathEntityProps {
  viewer: CesiumViewer | null;
}

// Amber — deliberately distinct from the blue planned path (MAP_COLORS.accentPrimary
// "#3a82ff"), the red fence, and the orange rally point, so the flown track reads
// as a separate layer at a glance. Cesium needs a raw CSS color string here, so
// this is an intentional literal, not a design-token utility class.
const ACTUAL_PATH_COLOR = "#fbbf24";

export function ActualPathEntity({ viewer }: ActualPathEntityProps) {
  const track = useSimReplayStore((s) => s.track);

  // Warm the bundled geoid grid once; flip on load so the track re-renders with
  // the AMSL correction applied (absent asset -> honest passthrough).
  const [geoidReady, setGeoidReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGeoidGrid().then(() => {
      if (alive) setGeoidReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !track || track.renderPositions.length < 2) return;

    const entities: Entity[] = [];
    const amber = Color.fromCssColorString(ACTUAL_PATH_COLOR);
    const mutedColor = Color.fromCssColorString(MAP_COLORS.muted);
    const foreground = Color.fromCssColorString(MAP_COLORS.foreground);
    const background = Color.fromCssColorString(MAP_COLORS.background);

    // AMSL-logged points carry an MSL altitude that must be geoid-corrected to
    // ellipsoidal height so the flown track does not float off the planned path
    // by the geoid undulation; relativeAlt-fallback points pass through. Place
    // the polyline at that height above the ellipsoid rather than clamping.
    //
    // Drawn from the DECIMATED track: a raw log is tens of thousands of
    // sub-metre-apart vertices, and submitting all of them to one polyline
    // every frame costs real time while showing nothing extra. The
    // full-resolution array stays on the track for analysis.
    const positions = track.renderPositions.map((p) =>
      Cartesian3.fromDegrees(
        p.lon,
        p.lat,
        p.amsl ? mslToEllipsoidal(p.alt, p.lat, p.lon) : p.alt,
      ),
    );

    // ── Flown 3D path ────────────────────────────────────────
    const pathEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: amber.withAlpha(0.95),
        clampToGround: false,
      },
    });
    entities.push(pathEntity);

    // ── Ground track (dashed shadow) for readability ─────────
    const groundTrack = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: amber.withAlpha(0.35),
          dashLength: 12,
        }),
        clampToGround: true,
      },
    });
    entities.push(groundTrack);

    // ── Start / end markers ──────────────────────────────────
    const markers: Array<{ pos: Cartesian3; text: string }> = [
      { pos: positions[0], text: "FLOWN START" },
      { pos: positions[positions.length - 1], text: "FLOWN END" },
    ];

    for (const marker of markers) {
      const dot = viewer.entities.add({
        position: marker.pos,
        point: {
          pixelSize: 8,
          color: amber.withAlpha(0.95),
          outlineColor: background.withAlpha(0.8),
          outlineWidth: 1,
          scaleByDistance: new NearFarScalar(500, 1.2, 20000, 0.5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: marker.text,
          font: "11px monospace",
          fillColor: foreground.withAlpha(0.9),
          outlineColor: background.withAlpha(0.6),
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.LEFT,
          pixelOffset: new Cartesian2(8, -4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 20000),
        },
      });
      entities.push(dot);
    }

    // Entities added outside Cesium's own change tracking do not schedule a
    // frame under `requestRenderMode`, so the track would not appear until some
    // other interaction happened to redraw. A missed request shows a stale
    // frame, which on a piloting surface is a false display.
    viewer.scene.requestRender();

    return () => {
      for (const entity of entities) {
        if (!viewer.isDestroyed()) viewer.entities.remove(entity);
      }
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, track, geoidReady]);

  return null;
}
