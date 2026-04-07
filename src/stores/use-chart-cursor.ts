/**
 * Shared time-cursor store for the History detail Charts tab.
 *
 * One global cursor in milliseconds-since-flight-start. Set it from any
 * chart's mouse-move; every chart subscribes and renders a `ReferenceLine`
 * at the same offset.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

interface ChartCursorState {
  cursorMs: number | null;
  setCursor: (ms: number | null) => void;
}

export const useChartCursor = create<ChartCursorState>((set) => ({
  cursorMs: null,
  setCursor: (cursorMs) => set({ cursorMs }),
}));
