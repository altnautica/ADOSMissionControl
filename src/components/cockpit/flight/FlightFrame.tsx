"use client";

/**
 * @module cockpit/flight/FlightFrame
 * @description The flight screen's frame: the cockpit root element, fixed
 * over the whole viewport (the fleet list, the app header and the drone
 * page's tabs stay mounted underneath), with the grid measured from the
 * container's own size and published to every zone. The grid lives here, not
 * in the cockpit root, so a follow-state tick re-renders only the frame and
 * the zones that read it, never the video.
 *
 * Also applies the class's default data-layer level (`layout.json`
 * `classes[*].default_layer_level`), the chrome tokens as CSS variables and
 * the main picture's placement per view.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, type CSSProperties, type ReactNode, type RefObject } from "react";

import layoutSpec from "@/lib/cockpit/spec/layout.json";
import { useFollowingMode } from "@/hooks/use-following-mode";
import type { CockpitLayoutSize } from "@/hooks/use-cockpit-width-class";
import type { CockpitViewId } from "@/lib/cockpit/views";
import { useCockpitLayersStore, type LayerLevel } from "@/stores/cockpit-layers-store";
import { FlightGridContext, chromeVars, useFlightGrid } from "./flight-context";
import { flightGrid, rectStyle, type FlightGrid } from "./flight-grid";
import { useViewZoomStore } from "./view-zoom-store";

export function FlightFrame({
  droneId,
  containerRef,
  size,
  view,
  sidePanel,
  density,
  children,
}: {
  droneId: string;
  containerRef: RefObject<HTMLDivElement | null>;
  size: CockpitLayoutSize;
  view: CockpitViewId;
  sidePanel: boolean;
  density: string;
  children: ReactNode;
}) {
  const { following } = useFollowingMode(droneId);
  // The Vision view's side panel: 340 px, at most 40 % of the width.
  const panelW = sidePanel ? Math.round(Math.min(340, size.width * 0.4)) : 0;
  const grid = useMemo(
    () =>
      flightGrid({
        width: size.width,
        height: size.height,
        widthClass: size.widthClass,
        following,
        sidePanelWidth: panelW,
      }),
    [size.width, size.height, size.widthClass, following, panelW],
  );

  // Each class opens at its own default level; an operator's choice for a
  // vehicle still wins.
  const setClassDefault = useCockpitLayersStore((s) => s.setClassDefault);
  useEffect(() => {
    setClassDefault(layoutSpec.classes[grid.cls].default_layer_level as LayerLevel);
  }, [grid.cls, setClassDefault]);

  const centre = grid.zones.center;
  const style = {
    ...chromeVars(grid.scale),
    "--fs-top-y": `${centre?.y ?? 60}px`,
    "--fs-cx": `${centre?.x ?? 0}px`,
    "--fs-cy": `${centre?.y ?? 0}px`,
    "--fs-cw": `${centre?.w ?? size.width}px`,
    "--fs-ch": `${centre?.h ?? size.height}px`,
  } as CSSProperties;

  return (
    <FlightGridContext.Provider value={grid}>
      <div
        ref={containerRef}
        tabIndex={0}
        data-density={density}
        data-width-class={size.widthClass}
        data-grid={grid.cls}
        data-view={view}
        data-testid="flight-screen"
        style={style}
        className="ados-cockpit flight-screen fixed inset-0 z-40 overflow-hidden bg-media outline-none"
      >
        {children}
      </div>
    </FlightGridContext.Provider>
  );
}

/** Where the main picture sits for a view at this grid. */
export function videoPlacement(view: CockpitViewId, grid: FlightGrid): CSSProperties {
  const portrait = grid.cls === "portrait";
  const video = grid.zones.video;
  if (view === "map") {
    const card = grid.zones.bottom_left_card;
    return card ? { ...rectStyle(card), zIndex: 26 } : { inset: 0 };
  }
  if (portrait && video) return rectStyle(video);
  if (view === "split") return { left: 0, top: 0, bottom: 0, width: "50%" };
  if (view === "vision" && grid.zones.side_panel) {
    return { left: 0, top: 0, bottom: 0, right: grid.width - grid.zones.side_panel.x };
  }
  return { inset: 0 };
}

/** Where the map pane sits when a view shows it (main or beside the video). */
export function mapPlacement(main: boolean, grid: FlightGrid): CSSProperties {
  const video = grid.zones.video;
  if (main) return grid.cls === "portrait" && video ? rectStyle(video) : { inset: 0 };
  return { right: 0, top: 0, bottom: 0, width: "50%" };
}

/**
 * The main picture's frame: placed per view, clipped, and scaled by the
 * digital zoom. The video, its overlays and the data layers are all inside,
 * so they scale together and boxes stay on their targets.
 */
export function FlightVideoFrame({
  droneId,
  view,
  children,
}: {
  droneId: string;
  view: CockpitViewId;
  children: ReactNode;
}) {
  const grid = useFlightGrid();
  const zoom = useViewZoomStore((s) => s.byDrone[droneId] ?? 1);
  const map = view === "map";
  return (
    <div
      className={`fs-video absolute overflow-hidden${map ? " fs-video-pip" : ""}`}
      data-zone={map ? "bottom_left_card" : "video"}
      data-zoom={zoom}
      style={videoPlacement(view, grid)}
    >
      <div className="absolute inset-0" style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}>
        {children}
      </div>
    </div>
  );
}

/** The map pane, placed for the view. */
export function FlightMapFrame({ main, children }: { main: boolean; children: ReactNode }) {
  const grid = useFlightGrid();
  return (
    <div className={`absolute z-0${main ? "" : " border-l-2 border-white/30"}`} style={mapPlacement(main, grid)}>
      {children}
    </div>
  );
}

/** A zone's absolutely placed container, or nothing when the zone is absent. */
export function ZoneBox({
  zone,
  className,
  children,
}: {
  zone: "bottom_right" | "side_panel";
  className?: string;
  children: ReactNode;
}) {
  const grid = useFlightGrid();
  const rect = grid.zones[zone];
  if (!rect) return null;
  return (
    <div className={`absolute ${className ?? ""}`} data-zone={zone} style={rectStyle(rect)}>
      {children}
    </div>
  );
}
