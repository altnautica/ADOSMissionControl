"use client";

/**
 * @module use-video-latency-budget
 * @description Subscribes a component to the per-hop receive latency
 * measured in `@/lib/video/latency-budget`, plus the jitter-buffer depth the
 * control loop currently asks the receiver for.
 *
 * `useSyncExternalStore` over the module's own subscription rather than a
 * Zustand slice: the samples arrive per rendered frame, and the budget module
 * already rate-limits its notifications and caches its snapshot, which is
 * exactly the `getSnapshot` contract React needs. Routing the same data
 * through a store would add a second copy of it and a second thing to keep
 * consistent.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

import {
  getLatencyBudget,
  subscribeLatencyBudget,
  type LatencyBudget,
} from "@/lib/video/latency-budget";
import { currentJitterTargetMs } from "@/lib/video/webrtc/stats-tracker";

export interface VideoLatencyBudget {
  budget: LatencyBudget;
  /**
   * Buffer depth the loop last got a receiver to accept, in ms.
   *
   * `0` means either "the loop has found no reason to add buffer" or "this
   * browser implements neither receiver knob", which are different facts. The
   * distinguishing evidence is `budget.samples`: with samples arriving and a
   * measured `bufferAndComposite` well above zero, the depth is the browser's
   * own and nothing here set it.
   */
  jitterTargetMs: number;
}

/** Server render has no frames and no receiver: report nothing measured. */
function serverSnapshot(): LatencyBudget {
  return getLatencyBudget();
}

export function useVideoLatencyBudget(): VideoLatencyBudget {
  const budget = useSyncExternalStore(
    subscribeLatencyBudget,
    getLatencyBudget,
    serverSnapshot,
  );
  // Read through, not subscribed: the target changes at most once every 2 s
  // by construction, and every change is accompanied by frame samples that
  // have already triggered a render.
  return { budget, jitterTargetMs: currentJitterTargetMs() };
}
