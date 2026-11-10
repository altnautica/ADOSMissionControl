"use client";

/**
 * @module cockpit/flight/SplitDivider
 * @description The Split view's divider between the video and the map, and
 * the context carrying its ratio for the flight screen's vehicle
 * (`views.json` split `divider`). A drag previews the ratio live and stores
 * it once, at the drag's end; a cancelled drag, a lost pointer capture, the
 * divider leaving the screen or another vehicle drops the preview.
 *
 * @license GPL-3.0-only
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { SPLIT_DIVIDER, clampSplit } from "@/lib/cockpit/views";
import { specString } from "@/lib/cockpit/spec-strings";
import { useFlightGrid } from "./flight-context";
import { rectStyle, splitDividerRect, splitFromPointer } from "./flight-grid";

/** The Split divider's ratio for the flight screen's vehicle: `preview`
 * moves it live during a drag (null ends the preview), `setRatio` keeps it
 * for the vehicle. */
export interface SplitState {
  ratio: number;
  setRatio: (ratio: number) => void;
  preview: (ratio: number | null) => void;
}

export const SplitContext = createContext<SplitState>({
  ratio: SPLIT_DIVIDER.default,
  setRatio: () => {},
  preview: () => {},
});

/** The Split view's divider ratio and its setters (clamped to the limits). */
export function useSplitRatio(): SplitState {
  return useContext(SplitContext);
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
  const { ratio, setRatio, preview } = useSplitRatio();
  const dragging = useRef(false);
  const rect = splitDividerRect(grid);

  // A drag in progress when the divider leaves the screen (a view change) or
  // the vehicle changes (a new `preview`) ends without a trace.
  useEffect(
    () => () => {
      if (!dragging.current) return;
      dragging.current = false;
      preview(null);
    },
    [preview],
  );

  const pointerX = (e: ReactPointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.offsetParent as HTMLElement | null;
    return e.clientX - (parent?.getBoundingClientRect().left ?? 0);
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  // The drag moves the divider live; the vehicle's ratio is stored once, at
  // the drag's end.
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) preview(splitFromPointer(pointerX(e), grid));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setRatio(splitFromPointer(pointerX(e), grid));
  };
  // A lost capture (the browser took the pointer) ends the drag unstored.
  const onLost = () => {
    if (!dragging.current) return;
    dragging.current = false;
    preview(null);
  };
  const onCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onLost();
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
      aria-label={specString("cockpit.split_divider")}
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
      onPointerCancel={onCancel}
      onLostPointerCapture={onLost}
      onKeyDown={onKey}
    />
  );
}
