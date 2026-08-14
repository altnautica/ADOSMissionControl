"use client";

/**
 * @module MqttControlGrantBridge
 * @description Connects the broker write-grant lifecycle to Convex. Renders
 * nothing.
 *
 * The lifecycle itself lives in `mqtt-control-grant-store`, which is deliberately
 * framework-free: the renewal timer has to fire while nothing is rendering, and
 * the transports read the credential synchronously at dial time. This component
 * is the only place that knows the lifecycle is backed by Convex, and it supplies
 * three things the store cannot obtain on its own — the mint/revoke/confirm
 * calls, the server's view of the operator's current grant, and the fact that
 * there is a signed-in operator at all.
 *
 * Mounted once in `AgentBridges`, which is itself mounted once per session and
 * renders nothing in demo mode, so no grant is minted for a mock fleet.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { useAction, useMutation } from "convex/react";
import { useAuthStore } from "@/stores/auth-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { cmdMqttControlGrantsApi } from "@/lib/community-api-drones";
import {
  attachGrantBackend,
  ensureGrant,
  syncServerGrant,
  type GrantBackend,
} from "@/stores/mqtt-control-grant-store";

export function MqttControlGrantBridge() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const convexAvailable = useConvexAvailable();
  // A grant is an operator's credential, so there is nothing to mint without a
  // session. `useConvexSkipQuery` already skips in demo mode and when no backend
  // is configured; the mint action needs the same gate stated explicitly.
  const enabled = isAuthenticated && convexAvailable;

  const mint = useAction(cmdMqttControlGrantsApi.mint);
  const revoke = useMutation(cmdMqttControlGrantsApi.revoke);
  const confirmWrite = useMutation(cmdMqttControlGrantsApi.confirmWrite);
  const current = useConvexSkipQuery(cmdMqttControlGrantsApi.myCurrent, {
    enabled,
  });

  const backend = useMemo<GrantBackend>(
    () => ({
      mint: () => mint({}),
      revoke: () => revoke({}),
      confirmWrite: (principal: string) => confirmWrite({ principal }),
    }),
    [mint, revoke, confirmWrite],
  );

  useEffect(() => {
    if (!enabled) {
      attachGrantBackend(null);
      return;
    }
    attachGrantBackend(backend);
    // Detach rather than release on unmount: this bridge is remounted by route
    // transitions, and dropping the credential there would tear down a live
    // command link. The grant is released at sign-out, where the session that
    // authorises the revoke still exists.
    return () => attachGrantBackend(null);
  }, [enabled, backend]);

  useEffect(() => {
    if (!enabled) return;
    // `undefined` is "not answered yet", distinct from `null` ("no live grant").
    // Acting on the first is what would mint a second grant on every page load.
    if (current === undefined) return;
    syncServerGrant(current);
    void ensureGrant();
  }, [enabled, current]);

  return null;
}
