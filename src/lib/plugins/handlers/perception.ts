/**
 * Read-only perception handlers for the plugin bridge (`ctx.perception.*`).
 *
 * `perception.read` returns the drone's resolved perception execution state —
 * where detection runs (on the drone or offloaded), the bound compute node, and
 * the accelerator inventory — off the selection-scoped capability store.
 * `perception.subscribe` streams the live detection batches for the plugin's
 * bound drone to the iframe as host events on `perception.detections`;
 * `perception.unsubscribe` (and the builder's `dispose()`) tears the store
 * subscription down. `perception.health` composes the same honest feed/session
 * health readout the cockpit surfaces already render.
 *
 * Every handler is READ-ONLY: none opens or reads the camera and none writes
 * agent state — the detections are DERIVED data. The bridge has already gated
 * the required capability before the handler runs, so these never re-check it.
 *
 * v1 semantics: detections + health key by the plugin's bound `deviceId`; the
 * `perception.read` tier fields reflect the currently-SELECTED drone
 * (`agent-capabilities` is a single selection-scoped store, not per-drone),
 * which is acceptable because a per-drone plugin renders for the selected drone.
 *
 * @module plugins/handlers/perception
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { perMount } from "./per-mount";
import {
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";
import {
  perceptionFeedState,
  perceptionSessionState,
  batchesPerSecond,
  THROUGHPUT_WINDOW_MS,
} from "@/lib/vision/perception-health";

/** One detection serialized for a plugin: a plain, structured-cloneable subset
 * of the store's VisionDetection (the same shape family as the video-overlay
 * host props), so the iframe never receives a live store reference. */
interface SerializedPerceptionDetection {
  /** The 2D box, in the frame's own pixels. Absent for a box-less percept. */
  bbox?: { x: number; y: number; width: number; height: number };
  classLabel: string;
  confidence: number;
  trackId: number | null;
  assocConfidence: number | null;
  lockState: "locked" | "uncertain" | "lost" | null;
  attributes: Record<string, unknown> | null;
}

/** A detection batch serialized for a `perception.detections` event. */
interface SerializedPerceptionBatch {
  modelId: string;
  cameraId: string;
  frameId: number;
  tsMs: number;
  frameWidth: number;
  frameHeight: number;
  receivedAt: number;
  detections: SerializedPerceptionDetection[];
}

/** Deep-copy a store batch into a plain object the iframe can never use to
 * reach a live store reference (mirrors `video-overlay-props.ts`). */
function serializeBatch(
  batch: VisionDetectionBatch,
): SerializedPerceptionBatch {
  return {
    modelId: batch.modelId,
    cameraId: batch.cameraId,
    frameId: batch.frameId,
    tsMs: batch.tsMs,
    frameWidth: batch.frameWidth,
    frameHeight: batch.frameHeight,
    receivedAt: batch.receivedAt,
    detections: batch.detections.map((d) => ({
      // Omitted for a box-less percept (a mask/pose/depth-only reading).
      ...(d.bbox
        ? {
            bbox: {
              x: d.bbox.x,
              y: d.bbox.y,
              width: d.bbox.width,
              height: d.bbox.height,
            },
          }
        : {}),
      classLabel: d.classLabel,
      confidence: d.confidence,
      trackId: d.trackId ?? null,
      assocConfidence: d.assocConfidence ?? null,
      lockState: d.lockState ?? null,
      attributes: d.attributes ? { ...d.attributes } : null,
    })),
  };
}

/**
 * Build the read-only `perception.*` handlers for one plugin bound to a device,
 * plus a `dispose()` that drops every detection subscription. Each mount
 * (iframe) holds its own subscription, so a re-subscribe replaces only that
 * mount's prior one (idempotent) and two panels of one plugin never steal each
 * other's stream.
 */
export function buildPerceptionHandlers(deviceId: string | null): {
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
} {
  const mounts = perMount<{ unsub: (() => void) | null }>(
    () => ({ unsub: null }),
    (state) => {
      state.unsub?.();
      state.unsub = null;
    },
  );

  const read: BridgeHandler = () => {
    const s = useAgentCapabilitiesStore.getState();
    return {
      tier: s.perceptionTier ?? null,
      offloadTarget: s.perceptionOffloadTarget ?? null,
      npuTops: s.npuTops ?? null,
      hasAccelerator: s.hasAccelerator ?? null,
    };
  };

  const subscribe: BridgeHandler = (_args, ctx: BridgeHandlerContext) => {
    if (!deviceId) {
      throw new Error("no scoped drone for perception subscription");
    }
    // Replace this mount's prior subscription to make a re-subscribe idempotent.
    const state = mounts.get(ctx.mount);
    state.unsub?.();
    const capability = ctx.capability ?? "";
    let last = useVisionDetectionsStore.getState().batches[deviceId];
    state.unsub = useVisionDetectionsStore.subscribe((vs) => {
      const batch = vs.batches[deviceId];
      // `setBatch` replaces the batch object each frame, so a new reference is a
      // new batch. Emit only fresh batches for this plugin's drone.
      if (batch && batch !== last) {
        last = batch;
        ctx.postEvent(
          "perception.detections",
          capability,
          serializeBatch(batch),
        );
      }
    });
    return { ok: true };
  };

  const unsubscribe: BridgeHandler = (_args, ctx: BridgeHandlerContext) => {
    const state = mounts.peek(ctx.mount);
    if (!state?.unsub) return { ok: false };
    state.unsub();
    state.unsub = null;
    return { ok: true };
  };

  const health: BridgeHandler = () => {
    const vs = useVisionDetectionsStore.getState();
    const caps = useAgentCapabilitiesStore.getState();
    const now = Date.now();
    const batch = deviceId ? vs.batches[deviceId] : undefined;
    const times = deviceId ? vs.receiptTimes(deviceId) : [];
    const feed = perceptionFeedState(batch, now);
    return {
      session: perceptionSessionState(feed, caps.perceptionTier),
      feed,
      ageMs: batch ? Math.max(0, now - batch.receivedAt) : null,
      batchesPerSecond: batchesPerSecond(times, now, THROUGHPUT_WINDOW_MS),
      boundNode: caps.perceptionOffloadTarget ?? null,
    };
  };

  return {
    handlers: {
      "perception.read": read,
      "perception.subscribe": subscribe,
      "perception.unsubscribe": unsubscribe,
      "perception.health": health,
    },
    dispose: () => mounts.disposeAll(),
  };
}
