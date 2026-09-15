"use client";

/**
 * @module use-capability-token
 * @description Per-(plugin, drone) capability-token hook.
 *
 * Mints and refreshes a capability token bound to one plugin install on
 * one drone, choosing the issuer based on the active transport:
 *
 *   * `transport = "lan"`   - mint via `POST /api/plugins/capability-token`
 *                              on the agent (`X-ADOS-Key` auth). Token
 *                              `iss = "agent:<deviceId>"`, signed with
 *                              the per-pairing HKDF-derived HMAC secret.
 *   * `transport = "cloud"` - mint via Convex action
 *                              `cmdPluginCapabilityTokens.mintToken`.
 *                              Token `iss = "cloud:<userId>"`, signed
 *                              with the operator HMAC secret.
 *
 * The token auto-refreshes 60s before its `expiresAt` claim. Multiple
 * iframes for the same `(pluginInstallId, deviceId)` pair share one
 * inflight promise via a module-level cache, so a freshly-mounted slot
 * does not duplicate-mint while a sibling slot already has one in flight.
 *
 * Mint helpers + the dedupe cache live at `./capability-token-mint.ts`.
 *
 * @license GPL-3.0-only
 */

import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePairingStore } from "@/stores/pairing-store";
import { type TokenClaims } from "@/lib/plugins/capability-token-claims";
import { api as convexApi } from "../../convex/_generated/api";
import {
  REFRESH_LEAD_MS,
  mintCloud,
  mintLan,
  readCache,
  readInflight,
  writeInflight,
  type CloudMint,
  type CloudMintResult,
  type MintedToken,
} from "./capability-token-mint";

export { __resetCapabilityTokenCacheForTests } from "./capability-token-mint";

export type CapabilityTokenTransport = "lan" | "cloud";

export interface UseCapabilityTokenResult {
  /** Base64-encoded JSON-claim token. `null` while loading or after an error. */
  token: string | null;
  /** Decoded claims. `null` while loading or after an error. */
  claims: TokenClaims | null;
  /** Force a fresh mint, bypassing the cache. */
  refresh: () => Promise<void>;
  /** True while the first mint is in flight or a refresh is running. */
  loading: boolean;
  /** Last error from a mint attempt; cleared on a successful mint. */
  error: Error | null;
}

export function useCapabilityToken(
  pluginInstallId: string,
  deviceId: string,
  transport: CapabilityTokenTransport,
): UseCapabilityTokenResult {
  const cloudMint = useAction(convexApi.cmdPluginCapabilityTokens.mintToken);
  const lanUrl = usePairingStore((s) => {
    const paired = s.pairedDrones.find((d) => d.deviceId === deviceId);
    if (!paired) return null;
    const host = paired.mdnsHost ?? paired.lastIp ?? null;
    return host ? `http://${host}:8080` : null;
  });
  // LAN mint key. Read from the mirrored fleet row, which is where a
  // cloud-paired node's key lives (it was never paired on this network, so
  // `local-nodes-store` has no record of it). The mint fires from an effect
  // keyed on the cache key, so the key has to be present on the first render
  // of this hook — an async per-device read would mint with no key and never
  // retry. `cmdDrones.getAgentKey` is the right read for a caller that can
  // await, such as the bridge's per-envelope secret resolver.
  const lanKey = usePairingStore(
    (s) => s.pairedDrones.find((d) => d.deviceId === deviceId)?.apiKey ?? null,
  );

  const [state, setState] = useState<{
    token: string | null;
    claims: TokenClaims | null;
    error: Error | null;
    loading: boolean;
  }>({ token: null, claims: null, error: null, loading: true });

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aborted = useRef(false);
  // Mint inputs change identity across renders (`useAction` returns a
  // fresh callback, store selectors recompute). Stashing them in a ref
  // keeps the effect keyed only on `cacheKey`; otherwise the effect
  // re-fires every render and floods the mint endpoint.
  const inputsRef = useRef({
    cloudMint,
    lanUrl,
    lanKey,
    pluginInstallId,
    deviceId,
    transport,
  });
  inputsRef.current = {
    cloudMint,
    lanUrl,
    lanKey,
    pluginInstallId,
    deviceId,
    transport,
  };

  const cacheKey = useMemo(
    () => `${transport}|${pluginInstallId}|${deviceId}`,
    [transport, pluginInstallId, deviceId],
  );

  const doMint = useCallback(
    async (force: boolean): Promise<MintedToken> => {
      const cached = !force ? readCache(cacheKey) : null;
      if (cached) return cached;
      const inflight = readInflight(cacheKey);
      if (inflight && !force) return inflight;

      const inputs = inputsRef.current;
      const promise =
        inputs.transport === "cloud"
          ? mintCloud(
              (args) =>
                (inputs.cloudMint as CloudMint)(args) as Promise<CloudMintResult>,
              inputs.pluginInstallId,
              inputs.deviceId,
            )
          : mintLan(inputs.lanUrl, inputs.lanKey, inputs.pluginInstallId);
      writeInflight(cacheKey, promise);
      return promise;
    },
    [cacheKey],
  );

  const runRef = useRef<(force: boolean) => Promise<void>>(async () => {});
  const scheduleRefresh = useCallback((claims: TokenClaims) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = Math.max(claims.expiresAt - Date.now() - REFRESH_LEAD_MS, 0);
    refreshTimer.current = setTimeout(() => {
      if (!aborted.current) void runRef.current(true);
    }, delay);
  }, []);

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const minted = await doMint(force);
        if (aborted.current) return;
        setState({
          token: minted.token,
          claims: minted.claims,
          error: null,
          loading: false,
        });
        scheduleRefresh(minted.claims);
      } catch (err) {
        if (aborted.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    },
    [doMint, scheduleRefresh],
  );
  runRef.current = run;

  useEffect(() => {
    aborted.current = false;
    void runRef.current(false);
    return () => {
      aborted.current = true;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
    // Key only on the dedupe identity. Mint inputs are read through
    // `inputsRef`; refreshes go through `runRef`.
  }, [cacheKey]);

  const refresh = useCallback(() => runRef.current(true), []);

  return {
    token: state.token,
    claims: state.claims,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}
