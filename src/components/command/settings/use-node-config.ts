"use client";

/**
 * @module command/settings/use-node-config
 * @description Loads ONE node's agent configuration (`GET /api/config`) and
 * exposes a per-key writer (`PUT /api/config`) that re-reads the config after a
 * write so the UI confirms the round-trip.
 *
 * The node is a PARAMETER, never ambient state. `agent-connection-store` holds
 * a single client for the focused node, and focus lags the rendered surface (it
 * is applied asynchronously after render, a failed connect leaves the previous
 * node's client attached, and a node with no LAN credentials never replaces
 * it) — so resolving the transport from the store would let a settings page
 * render node A's document under node B's name and write node B's toggle to
 * node A. The caller passes the node's device id; the attached client is used
 * only when it serves exactly that node (`directClientForNode`), and the
 * loaded document is dropped the moment the identity changes.
 *
 * Transport comes from the shared config-access resolution: the direct agent
 * client when one is attached for THIS node (local-first, zero cloud
 * round-trip), else the server-side `/api/lan-pair/config` proxy when a pairing
 * record names a LAN host (this is what makes the surface writable in cloud
 * mode), else — for a drone reached only through a ground station's WFB relay —
 * that ground station's relay-proxy over the same server-side proxy. The
 * surface degrades to read-only only when there is genuinely no path.
 *
 * The relay reach is likewise a parameter: it depends on per-node fleet data
 * (`reachedVia`, and whether the relaying ground node is LAN-paired here) that
 * this hook has no clean access to, while the caller already carries it on
 * `SurfaceContext`.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { isDemoMode } from "@/lib/utils";
import {
  directClientForNode,
  getConfigViaAccess,
  resolveConfigAccess,
  setConfigValueViaAccess,
  type ConfigAccess,
} from "@/lib/agent/config-access";
import { configWriteFailure } from "@/lib/agent/config-write";
import type { RelayReach } from "@/lib/nodes/relay-reach";
import { useStableRelayReach } from "@/hooks/use-stable-relay-reach";

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
   * the agent rejects the value (422), and when the agent accepted the value
   * in memory but could not write it to disk (`persisted: false`) — a change
   * that dies at the next restart is not a saved change. Re-reads the config
   * on success. */
  setValue: (key: string, value: string) => Promise<void>;
}

/**
 * @param nodeDeviceId The device id of the node this surface is rendered for
 *   (`ctx.agentDeviceId ?? ctx.relayReach?.peerDeviceId ?? null`). Required,
 *   not optional: a node-less call would resolve the ambient transport, which
 *   is the defect this parameter exists to close.
 * @param relayReach The ground station's relay-proxy reach for a WFB-relayed
 *   drone, when it has one.
 */
export function useNodeConfig(
  nodeDeviceId: string | null,
  relayReach?: RelayReach | null,
): NodeConfig {
  const storeClient = useAgentConnectionStore((s) => s.client);
  const attachedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
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
  // re-fetch the config in a loop. The shared hook re-keys it on its three
  // fields, so the caller can pass `ctx.relayReach` straight in with no memo.
  const reach = useStableRelayReach(relayReach);

  // The attached client serves the focused node only, so it carries this
  // surface's write ONLY when the focused node IS this node.
  //
  // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected): the demo
  // attaches one MockAgentClient over a shared mock config document and never
  // sets a focused device id, so the identity gate would drop every simulated
  // node to the (unreachable) proxy lane.
  const client = isDemoMode()
    ? storeClient
    : directClientForNode(storeClient, attachedDeviceId, nodeDeviceId);

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

  // Reads race: a relayed node's GET can take seconds while the next node's
  // LAN GET lands first. Every read takes a sequence number, and only the
  // newest read for the transport this surface currently uses may touch the
  // document, the error or the loading flag. `accessRef` is declared before
  // the refresh effect so it already names the new transport when that effect
  // starts the new read.
  const accessRef = useRef(access);
  const readSeq = useRef(0);
  useEffect(() => {
    accessRef.current = access;
  }, [access]);

  // A document belongs to the node it was read from. Drop it the instant the
  // identity changes so a stale config can never render — or be written back —
  // under a new node's name. The refresh effect below re-reads immediately;
  // this only guarantees nothing of node A survives the gap.
  useEffect(() => {
    setConfig(null);
    setError(null);
  }, [nodeDeviceId]);

  const refresh = useCallback(async () => {
    // A read for a transport this surface no longer uses (a write's read-back
    // finishing after the node changed) must neither run nor supersede the
    // current node's read.
    if (accessRef.current !== access) return;
    const seq = ++readSeq.current;
    const isCurrent = () =>
      seq === readSeq.current && accessRef.current === access;
    if (access.mode === "none") {
      setConfig(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cfg = await getConfigViaAccess(access);
      if (isCurrent()) setConfig(cfg);
    } catch (err) {
      if (isCurrent()) {
        setError(err instanceof Error ? err.message : "Failed to load config");
        setConfig(null);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [access]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setValue = useCallback(
    async (key: string, value: string) => {
      const res = await setConfigValueViaAccess(access, key, value);
      // Covers both halves of the agent's 200-means-nothing contract: a
      // rejected value (`{error}`) and a value accepted in RAM but never
      // written to disk (`persisted: false`). Throwing routes into the same
      // error toast + optimistic-rollback path every field primitive already
      // has, so no caller reports "Saved" for a write that did not land.
      const failure = configWriteFailure(res);
      if (failure) throw new Error(failure);
      // Re-read so the field reflects the real persisted value, not an
      // optimistic guess (the surface confirms the round-trip) — over the
      // proxy exactly as over the direct client. `refresh` skips the read-back
      // when the surface has moved to another node while the write was in
      // flight, so this node's answer can never land on the next node's page.
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
