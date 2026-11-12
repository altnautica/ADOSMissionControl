/**
 * @module use-narrow-viewport
 * @description Whether the window is narrower than a phone-sized breakpoint,
 * tracked live through `matchMedia`. The planner turns its side panels into
 * sheets over the map and folds bar actions into the overflow menu below it.
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

/** Below this window width (px) the planner uses its narrow layout. */
export const NARROW_VIEWPORT_MAX_WIDTH = 600;

const QUERY = `(max-width: ${NARROW_VIEWPORT_MAX_WIDTH - 1}px)`;

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

/** One-shot read, for store defaults outside React. */
export function isNarrowViewport(): boolean {
  return mediaQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const mql = mediaQuery();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, isNarrowViewport, () => false);
}
