"use client";

/**
 * @module command/settings/use-node-config
 * @description Loads the focused node's agent configuration
 * (`GET /api/config`) and exposes a per-key writer (`PUT /api/config`) that
 * re-reads the config after a write so the UI confirms the round-trip — the
 * same optimistic-write + read-back posture `RegulatoryRegionPanel` uses.
 *
 * Transport comes from the shared config-access resolution: the direct
 * agent client when one is attached (local-first, zero cloud round-trip),
 * else the server-side `/api/lan-pair/config` proxy when a pairing record
 * names a LAN host (this is what makes the surface writable in cloud
 * mode), else — for a drone reached only through a ground station's WFB
 * relay — that ground station's relay-proxy over the same server-side
 * proxy. The surface degrades to read-only only when there is genuinely
 * no path to the node.
 *
 * The relay reach is a PARAMETER rather than a store read: it depends on
 * per-node fleet data (`reachedVia`, and whether the relaying ground node is
 * LAN-paired here) that this hook has no clean access to, while the caller
 * already carries it on `SurfaceContext`. It stays optional so every existing
 * no-arg call site is unchanged.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import {
  getConfigViaAccess,
  resolveConfigAccess,
  setConfigValueViaAccess,
  type ConfigAccess,
} from "@/lib/agent/config-access";
import type { RelayReach } from "@/lib/nodes/relay-reach";

/** Read a dot-separated path (e.g. `network.hotspot.enabled`) out of a nested
 * config object. Returns `undefined` when any segment is missing, so a surface
 * can render "not set" honestly rather than a fabricated default. */
export function readConfigPath(
  config: Record<string, unknown> | null,
  path: string,
): unknown {
  if (!config) return undefined;
  let cursor: unknown = config;
  for (const segment of path.split(".")) {
    if (
      cursor &&
      typeof cursor === "object" &&
      segment in (cursor as Record<string, unknown>)
    ) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** True when the loaded config carries `path` as a nested section object —
 * i.e. the node's own config surface advertises that feature block. False
 * while the config has not loaded (or the agent predates the block), so a
 * feature page gated on this renders only for a node that actually exposes
 * the feature. */
export function configAdvertises(
  config: Record<string, unknown> | null,
  path: string,
): boolean {
  const v = readConfigPath(config, path);
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export interface NodeConfig {
  /** The redacted config object from the agent, or null before it loads /
   * when no transport reaches the node. */
  config: Record<string, unknown> | null;
  loading: boolean;
  /** True only when no transport reaches the node (no direct client, no
   * proxy-reachable pairing record, AND no ground-station relay reach) —
   * controls are disabled with the no-path reason. A cloud session with a
   * stored LAN pairing stays writable through the proxy, and a relayed drone
   * stays writable through its ground station's relay-proxy. */
  readOnly: boolean;
  /** Which transport resolved: direct client, server-side LAN proxy, the
   * ground station's relay-proxy, or none. Surfaced so a page can tell the
   * operator which lane it is on rather than implying a direct LAN
   * connection. */
  accessMode: ConfigAccess["mode"];
  error: string | null;
  refresh: () => Promise<void>;
  /** Write a single dot-path key. Throws with the agent's error message when
   * the agent rejects the value (422); re-reads the config on success. */
  setValue: (key: string, value: string) => Promise<void>;
}

export function useNodeConfig(relayReach?: RelayReach | null): NodeConfig {
  const client = useAgentConnectionStore((s) => s.client);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  // Subscribed (not read imperatively) so a pair/unpair mid-session
  // re-resolves the transport without a remount.
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `resolveRelayReach` mints a fresh object on every call, so callers pass an
  // identity-unstable value. Depending on the object would make `access` — and
  // therefore `refresh` — new every render, and the `refresh` effect would
  // re-fetch the config in a loop. Re-key on the three fields instead, so the
  // caller can pass `ctx.relayReach` straight in with no memo of its own.
  const relayBaseUrl = relayReach?.baseUrl ?? null;
  const relayApiKey = relayReach?.apiKey ?? null;
  const relayPeerDeviceId = relayReach?.peerDeviceId ?? null;
  const reach = useMemo<RelayReach | null>(
    () =>
      relayBaseUrl && relayPeerDeviceId && relayApiKey !== null
        ? {
            baseUrl: relayBaseUrl,
            apiKey: relayApiKey,
            peerDeviceId: relayPeerDeviceId,
          }
        : null,
    [relayBaseUrl, relayApiKey, relayPeerDeviceId],
  );

  const access = useMemo(
    () =>
      resolveConfigAccess(
        client,
        nodeDeviceId,
        { localNodes, pairedDrones },
        reach,
      ),
    [client, nodeDeviceId, localNodes, pairedDrones, reach],
  );
  const readOnly = access.mode === "none";

  const refresh = useCallback(async () => {
    if (access.mode === "none") {
      setConfig(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cfg = await getConfigViaAccess(access);
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [access]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setValue = useCallback(
    async (key: string, value: string) => {
      const res = await setConfigValueViaAccess(access, key, value);
      if (res && typeof res.error === "string") throw new Error(res.error);
      // Re-read so the field reflects the real persisted value, not an
      // optimistic guess (the surface confirms the round-trip) — over the
      // proxy exactly as over the direct client.
      await refresh();
    },
    [access, refresh],
  );

  return {
    config,
    loading,
    readOnly,
    accessMode: access.mode,
    error,
    refresh,
    setValue,
  };
}
