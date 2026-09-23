/**
 * Composited cockpit draw-layer handlers: `cockpit.marks` (replace the calling
 * iframe's marks) and `cockpit.marks.clear` (drop them).
 *
 * A plugin that draws over the video posts vector MARKS instead of stacking its
 * own overlay iframe; the host validates them (untrusted iframe input) and
 * writes them into the shared `cockpit-marks-store` under a per-iframe source
 * id, and `CockpitMarkLayer` composites every source's marks into ONE
 * letterbox-correct overlay. An iframe's marks clear when it unmounts, and
 * `dispose()` clears every iframe's on drone switch, so a dead panel never
 * leaves stale annotations on the video.
 *
 * The bridge gates `ui.slot.video-overlay` before `cockpit.marks` runs;
 * `cockpit.marks.clear` is always-allowed (clearing needs no grant), mirroring
 * the unsubscribe methods.
 *
 * @module plugins/handlers/marks
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import { parseCockpitMarks, type CockpitMark } from "@/lib/cockpit/marks";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";
import { perMount } from "./per-mount";

/**
 * Shortest gap between two applications of one plugin's marks. Posts that
 * arrive faster are coalesced: the latest set is applied when the gap has
 * passed, so a plugin posting every frame cannot make the layer rebuild at
 * its rate.
 */
export const MARKS_MIN_INTERVAL_MS = 50;

/** The composited-marks source id for one plugin iframe. */
export function pluginMarkSourceId(pluginId: string, mountId: string): string {
  return `plugin:${pluginId}:${mountId}`;
}

/** One iframe's marks: its source id and coalescing state. */
interface MountMarks {
  sourceId: string;
  lastAppliedAt: number;
  pending: CockpitMark[] | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function cancelPending(state: MountMarks): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  state.pending = null;
}

/**
 * Build the mark handlers for one plugin, plus a `dispose()` that drops its
 * marks. Each iframe of the plugin posts under its own source id, so two
 * panels never replace each other's marks and an unmounting panel clears only
 * its own; ids are namespaced by the source id so two sources that pick the
 * same local mark id never collide in the composited layer.
 */
export function buildMarksHandlers(pluginId: string): {
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
} {
  const mounts = perMount<MountMarks>(
    (mount) => ({
      sourceId: pluginMarkSourceId(pluginId, mount.id),
      lastAppliedAt: Number.NEGATIVE_INFINITY,
      pending: null,
      timer: null,
    }),
    (state) => {
      cancelPending(state);
      useCockpitMarksStore.getState().clearSource(state.sourceId);
    },
  );

  const apply = (state: MountMarks, marks: CockpitMark[]) => {
    state.lastAppliedAt = Date.now();
    useCockpitMarksStore.getState().setMarks(state.sourceId, marks);
  };

  const setMarks: BridgeHandler = (args, ctx: BridgeHandlerContext) => {
    const state = mounts.get(ctx.mount);
    const marks = parseCockpitMarks((args as { marks?: unknown })?.marks);
    // Namespace ids to keep them unique across sources in the flattened layer.
    const namespaced = marks.map((m) => ({ ...m, id: `${state.sourceId}::${m.id}` }));
    const wait = state.lastAppliedAt + MARKS_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0 && state.timer === null) {
      apply(state, namespaced);
    } else {
      state.pending = namespaced;
      state.timer ??= setTimeout(() => {
        state.timer = null;
        const next = state.pending;
        state.pending = null;
        if (next) apply(state, next);
      }, Math.max(0, wait));
    }
    return { ok: true, count: namespaced.length };
  };

  const clearMarks: BridgeHandler = (_args, ctx: BridgeHandlerContext) => {
    const state = mounts.peek(ctx.mount);
    if (state) {
      cancelPending(state);
      useCockpitMarksStore.getState().clearSource(state.sourceId);
    }
    return { ok: true };
  };

  return {
    handlers: {
      "cockpit.marks": setMarks,
      "cockpit.marks.clear": clearMarks,
    },
    dispose: () => mounts.disposeAll(),
  };
}
