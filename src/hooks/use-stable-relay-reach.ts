"use client";

/**
 * @module hooks/use-stable-relay-reach
 * @description Identity-stable `RelayReach` for a value re-minted every render.
 *
 * `resolveRelayReach` builds a fresh object on every call, so
 * `SurfaceContext.relayReach` is a new reference each render. Depending on that
 * object in a `useMemo` / `useCallback` / `useEffect` chain makes every
 * downstream value new each render — which, on the config surface, turns the
 * load effect into a re-fetch loop. Re-keying on the three primitive fields is
 * the fix, and it belongs in one place rather than re-derived per consumer.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import type { RelayReach } from "@/lib/nodes/relay-reach";

/** The same reach, but with a reference that changes only when one of its
 * fields does. Null in, null out. */
export function useStableRelayReach(
  reach: RelayReach | null | undefined,
): RelayReach | null {
  const baseUrl = reach?.baseUrl ?? null;
  const apiKey = reach?.apiKey ?? null;
  const peerDeviceId = reach?.peerDeviceId ?? null;
  return useMemo(
    () =>
      baseUrl && peerDeviceId && apiKey !== null
        ? { baseUrl, apiKey, peerDeviceId }
        : null,
    [baseUrl, apiKey, peerDeviceId],
  );
}
