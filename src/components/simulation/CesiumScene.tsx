/**
 * @module CesiumScene
 * @description CesiumJS Viewer wrapper with terrain, imagery, and dark theme configuration.
 * Sets CESIUM_BASE_URL before import, creates viewer with dark CARTO tiles.
 * Split into multiple effects: mount-only viewer creation, token update,
 * imagery switching, buildings toggle, terrain exaggeration.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";

// Set CESIUM_BASE_URL before cesium is imported
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).CESIUM_BASE_URL =
    process.env.CESIUM_BASE_URL ||
    "https://cesium.com/downloads/cesiumjs/releases/1.138/Build/Cesium/";
}

import {
  Viewer,
  Ion,
  Terrain,
  ArcGISTiledElevationTerrainProvider,
  SceneMode,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Color,
  Cesium3DTileset,
  Cesium3DTileStyle,
  IonImageryProvider,
  type Viewer as CesiumViewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

interface CesiumSceneProps {
  onReady?: (viewer: CesiumViewer) => void;
  onError?: (error: Error) => void;
  /** Cesium Ion access token. When set, enables Cesium World Terrain. Otherwise falls back to ArcGIS elevation. */
  cesiumToken?: string;
  /** Imagery mode: "dark" for CARTO dark tiles, "satellite" for Bing Maps Aerial (requires Ion token). */
  imageryMode?: "dark" | "satellite";
  /** Enable Cesium OSM Buildings 3D tileset (requires Ion token). */
  buildingsEnabled?: boolean;
  /** Terrain exaggeration factor. Defaults to 1 (no exaggeration). */
  terrainExaggeration?: number;
}

/** Create dark CARTO imagery layer */
function createDarkCartoLayer(): ImageryLayer {
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      credit: "CARTO",
      minimumLevel: 0,
      maximumLevel: 18,
    })
  );
}

export default function CesiumScene({
  onReady,
  onError,
  cesiumToken,
  imageryMode = "dark",
  buildingsEnabled = false,
  terrainExaggeration = 1,
}: CesiumSceneProps) {
  // Fall back to env var if Convex hasn't returned a token yet
  const effectiveToken = cesiumToken ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);

  // Stable refs for callbacks so mount effect doesn't re-run
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Effect 1: Mount-only — create viewer with basic config
  useEffect(() => {
    if (!containerRef.current) return;

    let viewer: InstanceType<typeof Viewer> | null = null;

    try {
      viewer = new Viewer(containerRef.current, {
        sceneMode: SceneMode.SCENE3D,
        scene3DOnly: true,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        vrButton: false,
        orderIndependentTranslucency: false,
        requestRenderMode: true,
        maximumRenderTimeChange: 0,
      });

      // Dark sky
      viewer.scene.backgroundColor = Color.fromCssColorString("#0a0a0f");
      viewer.scene.globe.baseColor = Color.fromCssColorString("#0a0a0f");
      viewer.scene.globe.showGroundAtmosphere = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 2.0e-4;

      // Dark CARTO tiles as default imagery
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.add(createDarkCartoLayer());

      // ArcGIS terrain as initial fallback (upgraded to Cesium World Terrain when token arrives)
      viewer.scene.setTerrain(
        new Terrain(
          ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
          )
        )
      );

      // Terrain rendering settings
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.globe.enableLighting = false;

      // Prevent camera from clipping through terrain at deep zoom
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 15;

      // Hide Cesium credits
      const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
      if (creditContainer) creditContainer.style.display = "none";

      viewerRef.current = viewer;
      onReadyRef.current?.(viewer);
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      tilesetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: Token update — upgrade terrain to Cesium World Terrain without recreating viewer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !effectiveToken) return;

    Ion.defaultAccessToken = effectiveToken;
    viewer.scene.setTerrain(
      Terrain.fromWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true,
      })
    );
    viewer.scene.requestRender();
  }, [effectiveToken]);

  // Effect 3: Imagery switching with cross-fade
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let cancelled = false;
    let rafId: number | undefined;
    let layerRef: ImageryLayer | null = null;

    function crossFade(newLayer: ImageryLayer) {
      if (cancelled || !viewer || viewer.isDestroyed()) return;
      layerRef = newLayer;
      newLayer.alpha = 0;
      viewer.imageryLayers.add(newLayer);

      const startTime = performance.now();
      const duration = 300;

      function animate(now: number) {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const progress = Math.min((now - startTime) / duration, 1);
        newLayer.alpha = progress;
        viewer.scene.requestRender();

        if (progress < 1) {
          rafId = requestAnimationFrame(animate);
        } else {
          // Remove all old layers (everything except the new one)
          while (viewer.imageryLayers.length > 1) {
            viewer.imageryLayers.remove(viewer.imageryLayers.get(0));
          }
        }
      }

      rafId = requestAnimationFrame(animate);
    }

    if (imageryMode === "satellite" && effectiveToken) {
      // Ensure Ion token is set before requesting satellite imagery
      Ion.defaultAccessToken = effectiveToken;
      // Satellite provider is async — await before cross-fading
      (async () => {
        try {
          const provider = await IonImageryProvider.fromAssetId(2);
          if (cancelled) return;
          const layer = new ImageryLayer(provider);
          if (cancelled) return;
          crossFade(layer);
        } catch {
          // Ion token missing or network error — fall back to dark
          if (!cancelled) crossFade(createDarkCartoLayer());
        }
      })();
    } else {
      crossFade(createDarkCartoLayer());
    }

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (viewer && !viewer.isDestroyed() && layerRef) {
        try { viewer.imageryLayers.remove(layerRef); } catch { /* already removed */ }
      }
    };
  }, [imageryMode, effectiveToken]);

  // Effect 4: Buildings toggle (imagery-mode-aware styling)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let cancelled = false;

    // Remove existing tileset before adding new one (handles imagery mode change)
    if (tilesetRef.current) {
      viewer.scene.primitives.remove(tilesetRef.current);
      tilesetRef.current = null;
    }

    if (buildingsEnabled && effectiveToken) {
      Ion.defaultAccessToken = effectiveToken;
      const buildingColor =
        imageryMode === "satellite"
          ? "color('rgba(200, 210, 230, 0.85)')"
          : "color('rgba(30, 42, 71, 1.0)')";

      Cesium3DTileset.fromIonAssetId(96188).then((tileset) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        tileset.style = new Cesium3DTileStyle({
          color: buildingColor,
        });
        viewer.scene.primitives.add(tileset);
        tilesetRef.current = tileset;
        viewer.scene.requestRender();
      }).catch(() => {
        // Silently ignore — buildings are a non-critical enhancement
      });
    } else {
      viewer.scene.requestRender();
    }

    return () => {
      cancelled = true;
      if (tilesetRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
    };
  }, [buildingsEnabled, imageryMode, effectiveToken]);

  // Effect 5: Terrain exaggeration
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.verticalExaggeration = terrainExaggeration ?? 1;
    viewer.scene.requestRender();
  }, [terrainExaggeration]);

  return <div ref={containerRef} className="w-full h-full absolute inset-0" />;
}
