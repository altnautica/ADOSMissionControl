"use client";

/**
 * @module use-claim-watch
 * @description Convex-backed `ClaimWatch` for the pairing flow: subscribes to
 * one pre-generated pairing request and reports the device id that registered
 * against it. Only mount under a Convex provider.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useConvex } from "convex/react";
import { cmdPairingApi } from "@/lib/community-api-drones";
import type { ClaimWatch } from "./use-pairing-flow";

export function useConvexClaimWatch(): ClaimWatch {
  const convex = useConvex();
  return useCallback<ClaimWatch>(
    (requestId, onClaimed) => {
      const watch = convex.watchQuery(cmdPairingApi.getPreGeneratedClaim, {
        requestId,
      });
      const check = () => {
        let claim: { deviceId: string } | null | undefined;
        try {
          claim = watch.localQueryResult();
        } catch {
          // A failed query leaves the code unclaimed; the countdown still
          // expires it, so the operator is never told a device paired.
          return;
        }
        if (claim) onClaimed(claim.deviceId);
      };
      const unsubscribe = watch.onUpdate(check);
      check();
      return unsubscribe;
    },
    [convex],
  );
}
