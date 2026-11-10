"use client";

/**
 * @module cockpit/flight/FlightVideoFrame
 * @description The flight screen's picture frames: the main picture placed
 * per view (Map puts the video in the bottom-left card, Split gives it the
 * share left of the divider) and the map pane beside it, carrying the
 * {@link SplitDivider} in the Split view.
 *
 * @license GPL-3.0-only
 */

import type { CSSProperties, ReactNode } from "react";

import type { CockpitViewId } from "@/lib/cockpit/views";
import { useFlightGrid } from "./flight-context";
import { PLACEHOLDER_DROP_PX, rectStyle, splitMapRect, videoRect, type FlightGrid } from "./flight-grid";
import { SplitDivider } from "./SplitDivider";
import { useViewZoomStore } from "./view-zoom-store";

/** Where the main picture sits for a view at this grid. */
export function videoPlacement(view: CockpitViewId, grid: FlightGrid): CSSProperties {
  if (view === "map") {
    const card = grid.zones.bottom_left_card;
    return card ? { ...rectStyle(card), zIndex: 26 } : { inset: 0 };
  }
  return rectStyle(videoRect(view, grid));
}

/** Where the map pane sits: the whole screen (the video zone in portrait)
 * when it is the main picture, else the Split view's share right of the
 * divider, inside the video zone in portrait. */
export function mapPlacement(main: boolean, grid: FlightGrid): CSSProperties {
  const video = grid.zones.video;
  if (main) return grid.cls === "portrait" && video ? rectStyle(video) : { inset: 0 };
  return rectStyle(splitMapRect(grid));
}

/** The placeholder's height: the 64 px icon box, its gap and one text line. */
const PLACEHOLDER_H_PX = 96;

/** The no-video placeholder's top inside a picture `h` tall: below the
 * centre marks, but never so low that its icon and text leave the picture
 * (a short portrait strip). */
export function placeholderTop(h: number): number {
  return Math.round(Math.max(0, Math.min(h / 2 + PLACEHOLDER_DROP_PX, h - PLACEHOLDER_H_PX)));
}

/**
 * The main picture's frame: placed per view, clipped, and scaled by the
 * digital zoom. The video, its overlays and the data layers are all inside,
 * so they scale together and boxes stay on their targets. A no-video
 * placeholder starts below the centre marks (`--fs-ph-top`), so the horizon
 * never crosses its text; in the card (Map view) there are no marks.
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
  const pic = videoRect(view, grid);
  const style = {
    ...videoPlacement(view, grid),
    ...(map ? {} : { "--fs-ph-top": `${placeholderTop(pic.h)}px` }),
  } as CSSProperties;
  return (
    <div
      className={`fs-video absolute overflow-hidden${map ? " fs-video-pip" : ""}`}
      data-zone={map ? "bottom_left_card" : "video"}
      data-zoom={zoom}
      style={style}
    >
      <div className="absolute inset-0" style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}>
        {children}
      </div>
    </div>
  );
}

/** The map pane, placed for the view; beside the video (Split) it carries
 * the divider. */
export function FlightMapFrame({ main, children }: { main: boolean; children: ReactNode }) {
  const grid = useFlightGrid();
  return (
    <>
      <div
        className="fs-map-pane absolute z-0 overflow-hidden"
        data-split={main ? undefined : "map"}
        style={mapPlacement(main, grid)}
      >
        {children}
      </div>
      {!main && <SplitDivider />}
    </>
  );
}
