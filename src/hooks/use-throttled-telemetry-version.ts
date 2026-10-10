"use client";

/**
 * @module use-throttled-telemetry-version
 * @description The telemetry store's `_version` counter, published at most once
 * per `intervalMs`. Shell-wide consumers that only need to re-evaluate when new
 * telemetry arrives (checklist auto-checks, failsafe banner) use this instead of
 * subscribing to `_version` directly, which bumps once per animation frame.
 *
 * The first change after a quiet period publishes immediately; changes inside
 * the window coalesce into one trailing update at the window's end, so the last
 * value is never lost.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";

export function useThrottledTelemetryVersion(intervalMs = 250): number {
  const [version, setVersion] = useState(() => useTelemetryStore.getState()._version);

  useEffect(() => {
    let lastPublish = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      timer = null;
      lastPublish = Date.now();
      setVersion(useTelemetryStore.getState()._version);
    };

    // Catch any change between the initial render and subscribing.
    publish();

    const unsubscribe = useTelemetryStore.subscribe((state, prev) => {
      if (state._version === prev._version || timer !== null) return;
      const wait = intervalMs - (Date.now() - lastPublish);
      if (wait <= 0) publish();
      else timer = setTimeout(publish, wait);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer ?? undefined);
    };
  }, [intervalMs]);

  return version;
}
