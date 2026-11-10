"use client";

/**
 * @module cockpit/flight/flight-sheet
 * @description The flight screen's sheet rules, shared by every sheet, menu
 * and confirm dialog on it:
 *
 * - One at a time: opening a sheet closes whichever one was open.
 * - Escape and a press outside the open sheet close it (its trigger is not
 *   "outside", so the trigger still toggles).
 * - Sheets render at the flight screen's root (a portal), never inside a
 *   zone, and start below the top bar: the top bar, with STOP, is never
 *   covered, so STOP takes the first press with any sheet open. A scrim, when
 *   a sheet has one, is translucent and also starts below the top bar.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import type { FlightGrid } from "./flight-grid";

/**
 * Where flight-screen toasts stack (bottom edge offset from the screen's
 * bottom, left edge, width): above the bottom row, between the card and the skills chip; in portrait, at the
 * bottom of the video, above the left column's row.
 */
export function toastAnchor(grid: FlightGrid): { bottom: number; left: number; width: number } {
  const gap = 8;
  if (grid.cls === "portrait") {
    const video = grid.zones.video ?? grid.zones.center;
    const top = video ? video.y + video.h : grid.height;
    return { bottom: grid.height - top + gap, left: gap, width: grid.width - 2 * gap };
  }
  const row = grid.zones.bottom_row;
  const topY = row?.y ?? grid.height;
  return {
    bottom: grid.height - topY + gap,
    left: row?.x ?? gap,
    width: row?.w ?? grid.width - 2 * gap,
  };
}

interface SheetState {
  /** The open sheet's id, or null. */
  open: string | null;
  set: (open: string | null) => void;
}

export const useFlightSheetStore = create<SheetState>()((set) => ({
  open: null,
  set: (open) => set({ open }),
}));

/** Close whichever flight-screen sheet is open. */
export function closeFlightSheets(): void {
  useFlightSheetStore.getState().set(null);
}

/**
 * Open a sheet from a component that does not render it (the Menu opening
 * the Mode sheet). Closes whichever sheet was open.
 */
export function openFlightSheet(id: string): void {
  useFlightSheetStore.getState().set(id);
}

/**
 * A sheet's open state, one sheet at a time. Same shape as `useState`, so
 * `setOpen((o) => !o)` toggles. Only the component that renders the sheet
 * uses it: it closes the sheet when that component unmounts. Others open it
 * with {@link openFlightSheet}.
 */
export function useFlightSheet(
  id: string,
): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const open = useFlightSheetStore((s) => s.open === id);
  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      const store = useFlightSheetStore.getState();
      const was = store.open === id;
      const want = typeof next === "function" ? next(was) : next;
      if (want) store.set(id);
      else if (was) store.set(null);
    },
    [id],
  );
  // A sheet whose owner unmounts does not stay "open" in the store.
  useEffect(
    () => () => {
      if (useFlightSheetStore.getState().open === id) useFlightSheetStore.getState().set(null);
    },
    [id],
  );
  return [open, setOpen];
}

/**
 * Escape and a press outside `ref` call `onClose` while `active`. `keep`
 * matches elements that are not "outside" (the sheet's trigger), so the
 * trigger can toggle.
 */
export function useSheetDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  keep?: string,
  active = true,
): void {
  // Focus moves into the sheet on open and back to where it was on close.
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }
    return () => {
      if (previous && previous.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target)) return;
      if (keep && target.closest(keep)) return;
      // A confirm dialog above the sheet is not "outside" the flow.
      if (target.closest("[data-flight-confirm]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [ref, onClose, keep, active]);
}

/**
 * The mounted flight screen's root element, for portals, or null off the
 * flight screen. Sheets open after the screen has mounted, so a lookup at
 * render time finds it.
 */
export function useFlightRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-testid='flight-screen']");
}

/** Style that places a box in the area below the top bar. */
export const BELOW_TOP_BAR: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  top: "var(--fs-bar-b, 0px)",
};

/**
 * Where a sheet sits: beside a side column (never over it) and below the top
 * bar; in portrait, full width below the left column's row.
 */
export function sheetPlacement(grid: FlightGrid, side: "left" | "right"): CSSProperties {
  const top = "calc(var(--fs-bar-b, 0px) + 8px)";
  if (grid.cls === "portrait") {
    const row = grid.zones.left_column;
    return { left: 8, right: 8, top: row ? row.y + row.h + 8 : top };
  }
  if (side === "left") {
    const col = grid.zones.left_column;
    return { left: col ? col.x + col.w + 8 : 8, top };
  }
  const col = grid.zones.right_column;
  return { right: col ? grid.width - col.x + 8 : 8, top };
}

/**
 * Render `children` at the flight screen's root. Off the flight screen it
 * renders in place.
 */
export function FlightSheetPortal({ children }: { children: ReactNode }) {
  const root = useFlightRoot();
  return root ? createPortal(children, root) : <>{children}</>;
}
