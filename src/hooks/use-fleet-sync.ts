/**
 * @module hooks/use-fleet-sync
 * @description Mirrors the Convex per-user fleet (`cmdDronesApi.listMyDrones`)
 * into the local pairing Zustand store. Dedupes by `deviceId` (keeps
 * the newest `pairedAt`) and sanitises the `profile` / `role` fields
 * against an allow-list so a malformed Convex row can't crash the UI.
 * Mounted once, from `AgentBridges`; signing out clears the mirrored fleet.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import { useAuthStore } from "@/stores/auth-store";

const VALID_PROFILES = new Set([
  "drone",
  "ground-station",
  "workstation",
]);
const VALID_ROLES = new Set(["direct", "relay", "receiver"]);

/**
 * Subscribe to the cloud-fleet list and push it into the pairing store.
 * Returns the live fleet rows for any caller that wants to render them
 * directly (the pairing store is the canonical source for the rest of
 * the UI).
 */
export function useFleetSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const myDrones = useConvexSkipQuery(cmdDronesApi.listMyDrones, {
    enabled: isAuthenticated,
  });

  // Signing out drops the previous account's fleet. Only a real sign-out
  // clears it: a session that was never signed in (demo, local-only) leaves
  // whatever else put there alone.
  const wasAuthenticated = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated) {
      usePairingStore.getState().setPairedDrones([]);
    }
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!myDrones || !Array.isArray(myDrones)) return;
    const deduped = new Map<string, typeof myDrones[number]>();
    for (const d of myDrones) {
      const existing = deduped.get(d.deviceId);
      if (!existing || (d.pairedAt || 0) > (existing.pairedAt || 0)) {
        deduped.set(d.deviceId, d);
      }
    }
    usePairingStore.getState().setPairedDrones(
      Array.from(deduped.values()).map((d) => {
        const rawProfile = (d as { profile?: unknown }).profile;
        const rawRole = (d as { role?: unknown }).role;
        const profile =
          typeof rawProfile === "string" && VALID_PROFILES.has(rawProfile)
            ? (rawProfile as PairedDrone["profile"])
            : undefined;
        const role =
          typeof rawRole === "string" && VALID_ROLES.has(rawRole)
            ? (rawRole as PairedDrone["role"])
            : rawRole === null
              ? null
              : undefined;
        return {
          _id: d._id,
          userId: d.userId,
          deviceId: d.deviceId,
          name: d.name,
          apiKey: d.apiKey,
          agentVersion: d.agentVersion,
          board: d.board,
          tier: d.tier,
          os: d.os,
          mdnsHost: d.mdnsHost,
          lastIp: d.lastIp,
          lastSeen: d.lastSeen,
          fcConnected: d.fcConnected,
          pairedAt: d.pairedAt,
          profile,
          role,
        };
      }),
    );
  }, [myDrones]);

  return myDrones;
}
