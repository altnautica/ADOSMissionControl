"use client";

/**
 * @module stores/cockpit-marks-store
 * @description The shared seam for cockpit overlay MARKS. Any source — a
 * built-in feature, or a host adapter for a plugin that streams marks over the
 * bridge instead of drawing its own iframe — pushes its current marks keyed by
 * a stable source id; the cockpit layer stack composites every source's marks into
 * one letterbox-correct overlay. Ephemeral (not persisted): marks are the live
 * frame's annotations.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { CockpitMark } from "@/lib/cockpit/marks";

interface CockpitMarksState {
  /** Current marks per source id. */
  bySource: Map<string, CockpitMark[]>;
  /** Replace one source's marks (empty array clears it but keeps the key). */
  setMarks: (sourceId: string, marks: CockpitMark[]) => void;
  /** Drop a source entirely (on unmount / disable). */
  clearSource: (sourceId: string) => void;
  /** All marks across every source, flattened, in source-registration order. */
  all: () => CockpitMark[];
}

export const useCockpitMarksStore = create<CockpitMarksState>((set, get) => ({
  bySource: new Map(),

  setMarks: (sourceId, marks) =>
    set((s) => {
      const bySource = new Map(s.bySource);
      bySource.set(sourceId, marks);
      return { bySource };
    }),

  clearSource: (sourceId) =>
    set((s) => {
      if (!s.bySource.has(sourceId)) return s;
      const bySource = new Map(s.bySource);
      bySource.delete(sourceId);
      return { bySource };
    }),

  all: () => {
    const out: CockpitMark[] = [];
    for (const marks of get().bySource.values()) out.push(...marks);
    return out;
  },
}));
