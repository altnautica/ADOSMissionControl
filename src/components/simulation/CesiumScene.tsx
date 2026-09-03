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
  // Self-hosted assets (workers, skybox star textures, widgets) copied into
  // public/cesium by the `copy:cesium` build step — version-aligned with the
  // installed package and available offline / air-gapped. Overridable via env.
  (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL =
    process.env.CESIUM_BASE_URL || "/cesium/";
}

import {
  Viewer,
  Ion,
  Terrain,
  ArcGISTiledElevationTerrainProvider,
  SceneMode,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Credit,
  Color,
  Cesium3DTileset,
  Cesium3DTileStyle,
  CameraEventType,
  KeyboardEventModifier,
  type Viewer as CesiumViewer,
  type TileProviderError,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

interface CesiumSceneProps {
  onReady?: (viewer: CesiumViewer) => void;
  onError?: (error: Error) => void;
  /** Cesium Ion access token. When set, enables Cesium World Terrain. Otherwise falls back to ArcGIS elevation. */
  cesiumToken?: string;
  /** Imagery mode: "dark" for CARTO dark tiles, "satellite" for Esri World Imagery. */
  imageryMode?: "dark" | "satellite";
  /** Rendering quality preset. "balanced" (default) or "high" (adds MSAA 8x,
   * sharper terrain LOD, and terrain relief lighting). */
  quality?: "balanced" | "high";
  /** Enable Cesium OSM Buildings 3D tileset (requires Ion token). */
  buildingsEnabled?: boolean;
  /** Terrain exaggeration factor. Defaults to 1 (no exaggeration). */
  terrainExaggeration?: number;
  /**
   * Reports the 3D-tileset memory footprint in bytes each time a tileset
   * loads, so the surface can show what the scene is actually holding instead
   * of leaving a 1 GiB default cache invisible.
   */
  onTilesetMemory?: (bytes: number) => void;
}

/**
 * 3D-tileset memory clamp. Cesium's defaults are 512 MiB of cache plus 512 MiB
 * of permitted overflow — up to 1 GiB per tileset — before it degrades
 * screen-space error to stay inside budget. A GCS tab lives for hours across
 * repeated route entry and exit, so the budget is set explicitly and low
 * enough that quality degrades before the tab does.
 */
const TILESET_CACHE_BYTES = 192 * 1024 * 1024;
const TILESET_CACHE_OVERFLOW_BYTES = 64 * 1024 * 1024;

// Replace Cesium's default `console.error({})` on tile failures with a readable line.
// The listener must not throw.
function attachImageryErrorListener(
  provider: UrlTemplateImageryProvider,
  label: string
) {
  provider.errorEvent.addEventListener((error: TileProviderError) => {
    try {
      console.warn("[Cesium imagery]", label, {
        message: error?.message,
        x: error?.x,
        y: error?.y,
        level: error?.level,
        timesRetried: error?.timesRetried ?? 0,
        error: error?.error,
      });
    } catch {
      /* swallow */
    }
  });
}

function attachLayerErrorListener(layer: ImageryLayer, label: string) {
  layer.errorEvent.addEventListener((error: unknown) => {
    try {
      console.warn("[Cesium imagery layer]", label, error);
    } catch {
      /* swallow */
    }
  });
}

function createDarkCartoLayer(): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    credit: "CARTO",
    minimumLevel: 0,
    maximumLevel: 18,
  });
  attachImageryErrorListener(provider, "carto-dark");
  const layer = new ImageryLayer(provider);
  attachLayerErrorListener(layer, "carto-dark");
  return layer;
}

function createEsriSatelliteLayer(): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: new Credit("Esri, Maxar, Earthstar Geographics"),
    maximumLevel: 18,
  });
  attachImageryErrorListener(provider, "esri-world-imagery");
  const layer = new ImageryLayer(provider);
  attachLayerErrorListener(layer, "esri-world-imagery");
  return layer;
}

export default function CesiumScene({
  onReady,
  onError,
  cesiumToken,
  imageryMode = "dark",
  quality = "balanced",
  buildingsEnabled = false,
  terrainExaggeration = 1,
  onTilesetMemory,
}: CesiumSceneProps) {
  // SimulationViewer already resolves Convex token → env-var fallback before passing in.
  const effectiveToken = cesiumToken;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);

  // Stable refs for callbacks so mount effect doesn't re-run
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onTilesetMemoryRef = useRef(onTilesetMemory);

  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onTilesetMemoryRef.current = onTilesetMemory;
  }, [onReady, onError, onTilesetMemory]);

  // Effect 1: Mount-only — create viewer with basic config
  useEffect(() => {
    if (!containerRef.current) return;

    let viewer: InstanceType<typeof Viewer> | null = null;

    try {
      viewer = new Viewer(containerRef.current, {
        sceneMode: SceneMode.SCENE3D,
        scene3DOnly: true,
        baseLayer: false,
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
        // Idle CPU reclamation: with `requestRenderMode` the scene only paints
        // when something asks it to. `maximumRenderTimeChange: 0` deliberately
        // keeps clock-driven repaints — the sim drone rides a
        // `SampledPositionProperty` off `viewer.clock`, and the commonly-quoted
        // `Infinity` would stop it moving during playback. A paused clock does
        // not advance simulation time, so idle already costs nothing.
        requestRenderMode: true,
        maximumRenderTimeChange: 0,
      });

      // Globe base color shown while imagery streams in. Sky, atmosphere, sun,
      // moon, and fog are owned by the mode-aware sky effect (Effect 6) so they
      // can differ between satellite (day) and dark (night) map modes.
      viewer.scene.globe.baseColor = Color.fromCssColorString("#0a0a0f");
      viewer.scene.fog.enabled = true;

      // Imagery layers are owned by Effect 3 (imagery switching). Don't add one here.

      // ArcGIS terrain as initial fallback (upgraded to Cesium World Terrain when token arrives).
      // Attach a .catch on the provider promise so a rejection surfaces as a readable warning
      // instead of an unhandled promise rejection that Cesium's error path prints as `{}`.
      const arcgisTerrainPromise = ArcGISTiledElevationTerrainProvider.fromUrl(
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
      );
      arcgisTerrainPromise.catch((err: unknown) => {
        console.warn("[Cesium terrain] ArcGIS fallback failed", err);
      });
      viewer.scene.setTerrain(new Terrain(arcgisTerrainPromise));

      // Terrain rendering settings
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.globe.enableLighting = false;

      // ── Intuitive, trackpad-friendly camera gestures ──
      // Left-drag orbits (grab-the-ground rotate), wheel/pinch zoom, right-drag
      // tilts (so changing the viewing angle never needs a middle mouse button),
      // Ctrl+left = tilt (alt), Shift+left = free look. This drops right-drag
      // from zoom (redundant with the wheel) and drops the middle-button
      // requirement for tilt — the stock Cesium scheme laptop users can't reach.
      const camCtrl = viewer.scene.screenSpaceCameraController;

      // Prevent camera from clipping through terrain at deep zoom.
      camCtrl.minimumZoomDistance = 15;

      // Ctrl+left-drag = tilt (alt), Shift+left-drag = look. Named consts so the
      // {eventType, modifier} shape isn't an inline literal against Cesium's
      // loose `CameraEventType | any[]` typing (excess-property check).
      const ctrlLeftDrag = {
        eventType: CameraEventType.LEFT_DRAG,
        modifier: KeyboardEventModifier.CTRL,
      };
      const shiftLeftDrag = {
        eventType: CameraEventType.LEFT_DRAG,
        modifier: KeyboardEventModifier.SHIFT,
      };
      camCtrl.rotateEventTypes = CameraEventType.LEFT_DRAG;
      camCtrl.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
      camCtrl.tiltEventTypes = [
        CameraEventType.RIGHT_DRAG,
        CameraEventType.MIDDLE_DRAG,
        ctrlLeftDrag,
      ];
      camCtrl.lookEventTypes = [shiftLeftDrag];

      // Tighter, less floaty stop than Cesium's 0.9/0.8 inertia defaults.
      camCtrl.inertiaSpin = 0.7;
      camCtrl.inertiaTranslate = 0.7;
      camCtrl.inertiaZoom = 0.7;

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
  }, []);

  // Effect 2: Token update — upgrade terrain to Cesium World Terrain without recreating viewer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !effectiveToken) return;

    Ion.defaultAccessToken = effectiveToken;
    const worldTerrain = Terrain.fromWorldTerrain({
      requestVertexNormals: true,
      requestWaterMask: true,
    });
    worldTerrain.errorEvent.addEventListener((err: unknown) => {
      console.warn("[Cesium terrain] Cesium World Terrain failed", err);
    });
    viewer.scene.setTerrain(worldTerrain);
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

      const hadExistingLayer = viewer.imageryLayers.length > 0;
      newLayer.alpha = hadExistingLayer ? 0 : 1;
      viewer.imageryLayers.add(newLayer);
      viewer.scene.requestRender();

      if (!hadExistingLayer) return; // no fade on first paint — nothing to fade from

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

    if (imageryMode === "satellite") {
      // Esri World Imagery. Free, no token needed, same provider as Leaflet maps.
      crossFade(createEsriSatelliteLayer());
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
  }, [imageryMode]);

  // Effect 4: Buildings toggle (imagery-mode-aware styling)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let cancelled = false;
    let localTileset: Cesium3DTileset | null = null;

    // Remove any tileset from a previous effect run (handles imagery mode + buildings toggle)
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
        // Clamp GPU/CPU tile memory. Cesium defaults to 512 MiB of cache plus
        // another 512 MiB of permitted overflow before it starts degrading
        // screen-space error — up to 1 GiB per tileset, which is how a
        // long-running control-room tab OOMs after repeated route entry/exit.
        tileset.cacheBytes = TILESET_CACHE_BYTES;
        tileset.maximumCacheOverflowBytes = TILESET_CACHE_OVERFLOW_BYTES;
        viewer.scene.primitives.add(tileset);
        localTileset = tileset;
        tilesetRef.current = tileset;
        onTilesetMemoryRef.current?.(tileset.totalMemoryUsageInBytes);
        viewer.scene.requestRender();
      }).catch(() => {
        // Silently ignore — buildings are a non-critical enhancement
      });
    } else {
      viewer.scene.requestRender();
    }

    return () => {
      cancelled = true;
      // Remove the tileset THIS effect run installed, not whatever is currently in the ref
      if (localTileset && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(localTileset);
        if (tilesetRef.current === localTileset) tilesetRef.current = null;
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

  // Effect 6: Mode-aware sky treatment.
  // Satellite = realistic daytime sky (stars + blue atmospheric horizon + sun
  // glow + ground haze). Dark = subtle night (dim stars over black + near-black
  // limb, no bright blue) so the tactical dark theme stays cohesive.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;

    if (imageryMode === "satellite") {
      scene.backgroundColor = Color.fromCssColorString("#05060a");
      if (scene.skyBox) scene.skyBox.show = true;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.show = true;
        scene.skyAtmosphere.brightnessShift = 0;
        scene.skyAtmosphere.saturationShift = 0;
      }
      if (scene.sun) scene.sun.show = true;
      if (scene.moon) scene.moon.show = true;
      scene.globe.showGroundAtmosphere = true;
      scene.fog.density = 1.8e-4;
    } else {
      scene.backgroundColor = Color.fromCssColorString("#0a0a0f");
      if (scene.skyBox) scene.skyBox.show = true;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.show = true;
        // Darken the limb toward black so no bright-blue horizon shows over the
        // stylized dark basemap.
        scene.skyAtmosphere.brightnessShift = -0.7;
        scene.skyAtmosphere.saturationShift = -0.3;
      }
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.globe.showGroundAtmosphere = false;
      scene.fog.density = 2.0e-4;
    }
    scene.fog.enabled = true;
    scene.requestRender();
  }, [imageryMode]);

  // Effect 7: Graphics quality preset.
  // Baseline (both presets): render at the device pixel ratio (sharper on
  // retina), clamped to 2x to bound GPU cost, plus a larger terrain tile cache.
  // High adds 8x MSAA, sharper terrain LOD, and terrain relief lighting.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;

    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      2
    );
    scene.globe.tileCacheSize = 1000;

    if (quality === "high") {
      if (scene.msaaSupported) scene.msaaSamples = 8;
      scene.globe.maximumScreenSpaceError = 1.5;
      // Vertex normals are already requested for the terrain (Effect 2), so
      // hillshade relief is available at no extra fetch cost.
      scene.globe.enableLighting = true;
      scene.globe.dynamicAtmosphereLighting = true;
      if (scene.skyAtmosphere) scene.skyAtmosphere.perFragmentAtmosphere = true;
    } else {
      // Balanced: restore Cesium's defaults for the expensive knobs.
      if (scene.msaaSupported) scene.msaaSamples = 4;
      scene.globe.maximumScreenSpaceError = 2;
      scene.globe.enableLighting = false;
      if (scene.skyAtmosphere) scene.skyAtmosphere.perFragmentAtmosphere = false;
    }
    scene.requestRender();
  }, [quality]);

  return <div ref={containerRef} className="w-full h-full absolute inset-0" />;
}
