"use client";

/**
 * @module cockpit/flight/FlightFrame
 * @description The flight screen's frame: the cockpit root element. It sits
 * embedded in the drone's Flight tab by default; in full screen (the top
 * bar's Full screen button, `immersiveMode`) it is fixed over the whole
 * viewport and the fleet list, the app header and the drone page's tabs,
 * still mounted underneath, are made `inert`. The grid is measured from the
 * container's own size and published to every zone. The grid lives here, not
 * in the cockpit root, so a follow-state tick re-renders only the frame and
 * the zones that read it, never the video.
 *
 * Also applies the class's default data-layer level (`layout.json`
 * `classes[*].default_layer_level`) and the chrome tokens as CSS variables,
 * and holds the Split divider's ratio (`views.json` split `divider`), kept
 * per vehicle in the view store, so it survives the flight screen closing
 * and reopening. The picture frames are in `FlightVideoFrame`, the divider
 * in `SplitDivider`.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useFollowingMode } from "@/hooks/use-following-mode";
import type { CockpitLayoutSize } from "@/hooks/use-cockpit-width-class";
import { clampSplit, useCockpitViewStore, useSplitRatio as useStoredSplitRatio, type CockpitViewId } from "@/lib/cockpit/views";
import { useCockpitLayersStore, type LayerLevel } from "@/stores/cockpit-layers-store";
import { FlightGridContext, chromeVars, useFlightGrid } from "./flight-context";
import { flightGrid, rectStyle } from "./flight-grid";
import { inertShellAround } from "./inert-shell";
import { toastAnchor } from "./flight-sheet";
import { SplitContext } from "./SplitDivider";
import { useUiStore } from "@/stores/ui-store";

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
  const immersive = useUiStore((s) => s.immersiveMode);
  // The Vision view's side panel: 340 px, at most 40 % of the width.
  const panelW = sidePanel ? Math.round(Math.min(340, size.width * 0.4)) : 0;
  // The Split divider per vehicle, kept in the view store; a drag previews
  // locally and is stored when it ends. A preview belongs to the vehicle it
  // was dragged on, so another vehicle never shows it.
  const stored = useStoredSplitRatio(droneId);
  const [drag, setDrag] = useState<{ droneId: string; ratio: number } | null>(null);
  const splitRatio = clampSplit(drag?.droneId === droneId ? drag.ratio : stored);
  const setRatio = useCallback(
    (ratio: number) => {
      setDrag(null);
      useCockpitViewStore.getState().setSplit(droneId, ratio);
    },
    [droneId],
  );
  const preview = useCallback(
    (ratio: number | null) => setDrag(ratio === null ? null : { droneId, ratio: clampSplit(ratio) }),
    [droneId],
  );
  const split = useMemo(() => ({ ratio: splitRatio, setRatio, preview }), [splitRatio, setRatio, preview]);
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

  // In full screen the page underneath leaves the tab order and the
  // accessibility tree; embedded, the shell stays usable beside the tab.
  useEffect(() => {
    const frame = containerRef.current;
    return frame && immersive ? inertShellAround(frame) : undefined;
  }, [containerRef, immersive]);

  // Toasts on the flight screen sit above the bottom row, clear of the
  // card, the skills chip and STOP (the toast host reads these). The anchor
  // is in viewport terms, so the embedded frame's own offset is added.
  useEffect(() => {
    const html = document.documentElement;
    const place = () => {
      const a = toastAnchor(grid);
      const rect = containerRef.current?.getBoundingClientRect();
      const left = (rect?.left ?? 0) + a.left;
      const bottom = (rect ? window.innerHeight - rect.bottom : 0) + a.bottom;
      html.style.setProperty("--fs-toast-bottom", `${bottom}px`);
      html.style.setProperty("--fs-toast-left", `${left}px`);
      html.style.setProperty("--fs-toast-w", `${a.width}px`);
    };
    html.dataset.flightScreen = "";
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      delete html.dataset.flightScreen;
      html.style.removeProperty("--fs-toast-bottom");
      html.style.removeProperty("--fs-toast-left");
      html.style.removeProperty("--fs-toast-w");
    };
  }, [grid, containerRef, immersive]);

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
          data-immersive={immersive || undefined}
          style={style}
          className={`ados-cockpit flight-screen overflow-hidden bg-media outline-none ${
            immersive ? "fixed inset-0 z-40" : "relative h-full w-full"
          }`}
        >
          {children}
        </div>
      </SplitContext.Provider>
    </FlightGridContext.Provider>
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
