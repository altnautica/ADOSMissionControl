"use client";

/**
 * @module hooks/use-video-frame-age
 * @description Reactive read of how old the frame on screen is, from the two
 * estimators in `lib/video/frame-age`.
 *
 * Both sources have to be subscribed, because either can be the live one: the
 * SEI figure lands in the video store, the frame-metadata figure lives in the
 * `latency-budget` module's own preallocated lanes (deliberately outside
 * React, so a 60 Hz frame callback does not re-render anything). This hook is
 * the one place that joins them, so every surface that needs the age — the
 * cockpit chip, the instrument HUD's frame alignment, the plugin overlay
 * payload — reads the same number from the same instant.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

import { useVideoStore } from "@/stores/video-store";
import {
  frameMetadataEndToEndMs,
  resolveFrameAge,
  type FrameAge,
} from "@/lib/video/frame-age";
import { subscribeLatencyBudget } from "@/lib/video/latency-budget";

/**
 * Server snapshot for `useSyncExternalStore`. Neither estimator exists during
 * SSR. Declared at module scope because the hook needs a stable callback
 * identity across renders, not because the body earns a name.
 */
function noFrameAgeOnServer(): number | null {
  return null;
}

/**
 * The age of the frame currently presented, or `null` when neither estimator
 * has a usable figure.
 *
 * `null` is a real answer and every consumer must render it as one. It means
 * "this surface does not know how stale the picture is", which is a different
 * statement from "the picture is current" — and substituting the latter is
 * precisely the fabrication this hook exists to stop.
 *
 * `frameMetadataEndToEndMs` is passed as the snapshot directly: the budget
 * module already rate-limits its notifications and only publishes on a real
 * change, and the snapshot is a scalar, so there is no fresh-object
 * re-render trap.
 */
export function useVideoFrameAge(): FrameAge | null {
  const trueG2GMs = useVideoStore((s) => s.latency.trueG2GMs);
  const endToEndP50Ms = useSyncExternalStore(
    subscribeLatencyBudget,
    frameMetadataEndToEndMs,
    noFrameAgeOnServer,
  );
  return resolveFrameAge(trueG2GMs, endToEndP50Ms);
}
