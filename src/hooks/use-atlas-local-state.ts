"use client";

/**
 * @module use-atlas-local-state
 * @description Local-first source for a drone's Atlas world-model state. When
 * the operator is NOT signed in to the cloud (local-first), a
 * LAN-paired drone is not beaconing to Convex, so the cloud heartbeat path
 * (`CloudStatusBridge` -> `buildAtlasPatch`) never sees it. This hook stands in:
 * it resolves the LAN-paired agent for `droneId` (host + apiKey from
 * `local-nodes-store`) and polls the world-model capture service's state sidecar
 * at `GET /api/plugins/atlas/state` directly, mapping each slice into the same
 * `useAtlasStore` the cloud path feeds.
 *
 * The two writers are kept strictly disjoint: this hook stands down for any
 * drone that is the active cloud-relay device (`cloudDeviceId`), which
 * `CloudStatusBridge` drives — so they never both write the single-slice atlas
 * store for the same drone (an explicit gate, not an incidental one). This hook
 * also clears the store on drone switch, since the bridge's clear-on-switch runs
 * only in cloud mode. Inert unless local-first, a real drone is selected, a LAN
 * key is held, and the Atlas flag is on. Polls only while mounted (the Live
 * World tab is open) and stops on unmount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { mapAtlasSlice } from "@/components/command/bridges/status-mapper/atlas";
import { isDemoMode } from "@/lib/utils";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAtlasStore } from "@/stores/atlas-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/** The Atlas service's state sidecar id (`/api/plugins/atlas/state`). */
const ATLAS_PLUGIN_ID = "atlas";

/** How often to poll the local agent's Atlas state, in ms. Faster than the
 * cloud heartbeat so the Live World view is fresh local-first. */
export const ATLAS_POLL_INTERVAL_MS = 750;

/**
 * Poll the selected drone's local agent for its Atlas world-model state and
 * feed it into `useAtlasStore`. No-op when not local-first for the drone
 * (signed in, demo, no LAN key), when the Atlas flag is off, or when no drone
 * is selected.
 *
 * @param droneId The selected drone's device id, or null/undefined.
 */
export function useAtlasLocalState(droneId: string | null | undefined): void {
  // The active cloud-relay device (CloudStatusBridge owns its atlas writes).
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  // The selection id is the canonical `node:<deviceId>`, but local-nodes-store
  // and cloudDeviceId are keyed by the bare deviceId — resolve it before lookup.
  const deviceId = droneId ? (deviceIdFromNodeId(droneId) ?? droneId) : null;
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );

  const host = node?.hostname ?? "";
  const apiKey = node?.apiKey ?? "";
  const active =
    !isDemoMode() &&
    Boolean(deviceId) &&
    Boolean(host) &&
    Boolean(apiKey) &&
    // Never double-write: if this drone is the active cloud-relay device
    // (e.g. anon cloud relay while signed out), CloudStatusBridge owns the
    // atlas store for it. Strictly disjoint sources (local-first
    // otherwise).
    cloudDeviceId !== deviceId;

  // Hold the live key without re-arming the interval when only its identity
  // changes; the host change re-arms the loop. Synced in an effect (not during
  // render). The poll reads it per-tick so a re-paired key (same host, new key)
  // takes effect on the next poll without a re-arm.
  const apiKeyRef = useRef(apiKey);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  });

  // The atlas store holds a SINGLE focused-drone slice. Clear it on drone switch
  // so a non-capturing drone B never renders drone A's session (its poll 404s and
  // skips the write) — UNLESS this drone is the cloud-relay device, which
  // CloudStatusBridge owns and clears.
  useEffect(() => {
    if (!isDemoMode() && cloudDeviceId !== deviceId) {
      useAtlasStore.getState().clear();
    }
  }, [deviceId, cloudDeviceId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const pollOnce = async () => {
      // Build the client per poll so it reads the latest committed key (the
      // client freezes the key at construction).
      const client = new PluginAgentClient(host, apiKeyRef.current);
      const slice = await client.getRawState(ATLAS_PLUGIN_ID);
      if (cancelled || !slice) return;
      const patch = mapAtlasSlice(
        slice,
        { live: useAtlasStore.getState().live },
        Date.now(),
      );
      if (patch) useAtlasStore.getState().setLive(patch.live);
    };

    void pollOnce();
    const handle = setInterval(() => void pollOnce(), ATLAS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // Re-arm on drone switch (host) or activation change; apiKey via ref.
  }, [active, host]);
}
