"use client";

/**
 * @module cockpit/flight/FlightFrame
 * @description The flight screen's frame: the cockpit root element, fixed
 * over the whole viewport (the fleet list, the app header and the drone
 * page's tabs stay mounted underneath, made `inert` while it is up), with the grid measured from the
 * container's own size and published to every zone. The grid lives here, not
 * in the cockpit root, so a follow-state tick re-renders only the frame and
 * the zones that read it, never the video.
 *
 * Also applies the class's default data-layer level (`layout.json`
 * `classes[*].default_layer_level`), the chrome tokens as CSS variables and
 * the main picture's placement per view: Map puts the video in the
 * bottom-left card, Split divides the picture slot at a draggable divider
 * (`views.json` split `divider`), kept per vehicle while the screen is up.
 *
 * @license GPL-3.0-only
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useFollowingMode } from "@/hooks/use-following-mode";
import type { CockpitLayoutSize } from "@/hooks/use-cockpit-width-class";
import type { CockpitViewId } from "@/lib/cockpit/views";
import { useCockpitLayersStore, type LayerLevel } from "@/stores/cockpit-layers-store";
import { FlightGridContext, chromeVars, useFlightGrid } from "./flight-context";
import { specString } from "@/lib/cockpit/spec-strings";
import {
  PLACEHOLDER_DROP_PX,
  SPLIT_DIVIDER,
  clampSplit,
  flightGrid,
  rectStyle,
  splitDividerRect,
  splitFromPointer,
  splitMapRect,
  videoRect,
  type FlightGrid,
} from "./flight-grid";
import { useViewZoomStore } from "./view-zoom-store";
import { inertShellAround } from "./inert-shell";
import { toastAnchor } from "./flight-sheet";

/** The Split divider's ratio for the flight screen's vehicle and its setter. */
interface SplitState {
  ratio: number;
  setRatio: (ratio: number) => void;
}

export const SplitContext = createContext<SplitState>({ ratio: SPLIT_DIVIDER.default, setRatio: () => {} });

/** The Split view's divider ratio and its setter (clamped to the limits). */
export function useSplitRatio(): SplitState {
  return useContext(SplitContext);
}

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
  // The Split divider per vehicle, for as long as the flight screen is up.
  const [splitByDrone, setSplitByDrone] = useState<Record<string, number>>({});
  const splitRatio = clampSplit(splitByDrone[droneId]);
  const setRatio = useCallback(
    (ratio: number) => setSplitByDrone((m) => ({ ...m, [droneId]: clampSplit(ratio) })),
    [droneId],
  );
  const split = useMemo(() => ({ ratio: splitRatio, setRatio }), [splitRatio, setRatio]);
  const grid = useMemo(
    () =>
      flightGrid({
        width: size.width,
        height: size.height,
        widthClass: size.widthClass,
        following,
        sidePanelWidth: panelW,
        splitRatio,
      }),
    [size.width, size.height, size.widthClass, following, panelW, splitRatio],
  );

  // Each class opens at its own default level; an operator's choice for a
  // vehicle still wins.
  const setClassDefault = useCockpitLayersStore((s) => s.setClassDefault);
  useEffect(() => {
    setClassDefault(layoutSpec.classes[grid.cls].default_layer_level as LayerLevel);
  }, [grid.cls, setClassDefault]);

  // The page underneath leaves the tab order and the accessibility tree.
  useEffect(() => {
    const frame = containerRef.current;
    return frame ? inertShellAround(frame) : undefined;
  }, [containerRef]);

  // Toasts on the flight screen sit above the bottom row, clear of the
  // card, the skills chip and STOP (the toast host reads these).
  useEffect(() => {
    const html = document.documentElement;
    const a = toastAnchor(grid);
    html.dataset.flightScreen = "";
    html.style.setProperty("--fs-toast-bottom", `${a.bottom}px`);
    html.style.setProperty("--fs-toast-left", `${a.left}px`);
    html.style.setProperty("--fs-toast-w", `${a.width}px`);
    return () => {
      delete html.dataset.flightScreen;
      html.style.removeProperty("--fs-toast-bottom");
      html.style.removeProperty("--fs-toast-left");
      html.style.removeProperty("--fs-toast-w");
    };
  }, [grid]);

  const centre = grid.zones.center;
  const bar = grid.zones.top_bar;
  const style = {
    ...chromeVars(grid.scale),
    "--fs-top-y": `${centre?.y ?? 60}px`,
    // The top bar's bottom edge: sheets and scrims start here, so STOP is
    // never covered.
    "--fs-bar-b": `${bar ? bar.y + bar.h : 0}px`,
    "--fs-cx": `${centre?.x ?? 0}px`,
    "--fs-cy": `${centre?.y ?? 0}px`,
    "--fs-cw": `${centre?.w ?? size.width}px`,
    "--fs-ch": `${centre?.h ?? size.height}px`,
  } as CSSProperties;

  return (
    <FlightGridContext.Provider value={grid}>
      <SplitContext.Provider value={split}>
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
      </SplitContext.Provider>
    </FlightGridContext.Provider>
  );
}

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

/** The placeholder's height: the 64 px icon box, its gap and one text line. */
const PLACEHOLDER_H_PX = 96;

/** The no-video placeholder's top inside a picture `h` tall: below the
 * centre marks, but never so low that its icon and text leave the picture
 * (a short portrait strip). */
export function placeholderTop(h: number): number {
  return Math.round(Math.max(0, Math.min(h / 2 + PLACEHOLDER_DROP_PX, h - PLACEHOLDER_H_PX)));
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

/** Arrow-key step of the divider (share of the slot); Shift moves further. */
const DIVIDER_STEP = 0.05;

/**
 * The Split view's divider: drag it (or use the arrow keys, Home and End) to
 * share the picture slot between the video and the map, inside the spec's
 * limits.
 */
export function SplitDivider() {
  const grid = useFlightGrid();
  const { ratio, setRatio } = useSplitRatio();
  const dragging = useRef(false);
  const rect = splitDividerRect(grid);

  const pointerX = (e: ReactPointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.offsetParent as HTMLElement | null;
    return e.clientX - (parent?.getBoundingClientRect().left ?? 0);
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setRatio(splitFromPointer(pointerX(e), grid));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setRatio(splitFromPointer(pointerX(e), grid));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? DIVIDER_STEP * 2 : DIVIDER_STEP;
    const next =
      e.key === "ArrowLeft"
        ? ratio - step
        : e.key === "ArrowRight"
          ? ratio + step
          : e.key === "Home"
            ? SPLIT_DIVIDER.min
            : e.key === "End"
              ? SPLIT_DIVIDER.max
              : null;
    if (next === null) return;
    e.preventDefault();
    setRatio(clampSplit(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={specString("cockpit.divider")}
      aria-valuemin={Math.round(SPLIT_DIVIDER.min * 100)}
      aria-valuemax={Math.round(SPLIT_DIVIDER.max * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className="fs-divider"
      data-testid="split-divider"
      data-ratio={ratio}
      style={rectStyle(rect)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
    />
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
