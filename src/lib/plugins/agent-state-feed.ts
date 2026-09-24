"use client";

/**
 * @module plugins/agent-state-feed
 * @description Feeds one plugin's agent-published state on one node into the
 * GCS plugin event bus, under the plugin's agent-state origin for that node,
 * while any mount wants it. The agent's plugin host writes the latest event
 * per topic (including `telemetry.extend` channels as `telemetry.<channel>`)
 * into the plugin's state sidecar; this reads it from:
 *
 *   1. signed in: the node's heartbeat `pluginState[pluginId]` slice (the same
 *      sidecar, ferried verbatim), when a fresh one is held; else
 *   2. the node itself: `GET /api/plugins/{id}/state`, reached the way every
 *      inline call reaches a node (LAN direct, the ground station's relay, or
 *      the same-origin proxy on an HTTPS page).
 *
 * It works for any node profile. One poll runs per (node, plugin), however
 * many mounts hold it, and stops when the last lets go. A topic is published
 * only when its `ts_ms` moves, so a steady sidecar does not replay.
 *
 * @license GPL-3.0-only
 */

import { isPluginStateResponse } from "@/lib/agent/plugin-client";
import type { PluginStateResponse } from "@/lib/agent/plugin-client-types";
import { isDemoMode } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";
import { agentStateOrigin, publishPluginEvent } from "./event-bus";
import { pluginClientForReach, resolveNodeAgentReach } from "./node-agent-reach";

/** Poll cadence, matching the local skill-state egress. */
export const AGENT_STATE_POLL_MS = 750;

/** A heartbeat slice older than this is not trusted over the node poll. */
export const CLOUD_SLICE_FRESH_MS = 15_000;

interface Feed {
  refs: number;
  timer: ReturnType<typeof setInterval>;
  inFlight: boolean;
  /** Last published `ts_ms` per topic. */
  published: Map<string, number>;
}

const feeds = new Map<string, Feed>();

/** The node's state from a fresh heartbeat slice, when signed in. */
function cloudState(pluginId: string, deviceId: string): PluginStateResponse | null {
  if (!useAuthStore.getState().isAuthenticated) return null;
  const { byDevice, updatedAt } = usePluginCloudStateStore.getState();
  const at = updatedAt[deviceId];
  if (at === undefined || Date.now() - at > CLOUD_SLICE_FRESH_MS) return null;
  const slice = byDevice[deviceId]?.[pluginId];
  return slice !== undefined && isPluginStateResponse(slice) ? slice : null;
}

async function readState(pluginId: string, deviceId: string): Promise<PluginStateResponse | null> {
  const cloud = cloudState(pluginId, deviceId);
  if (cloud) return cloud;
  const reach = resolveNodeAgentReach(deviceId);
  return reach ? pluginClientForReach(reach).getState(pluginId) : null;
}

async function tick(key: string, feed: Feed, pluginId: string, deviceId: string): Promise<void> {
  if (feed.inFlight) return;
  feed.inFlight = true;
  try {
    const state = await readState(pluginId, deviceId);
    if (!state || feeds.get(key) !== feed) return;
    const origin = agentStateOrigin(pluginId, deviceId);
    for (const [topic, entry] of Object.entries(state)) {
      if (feed.published.get(topic) === entry.ts_ms) continue;
      feed.published.set(topic, entry.ts_ms);
      publishPluginEvent(topic, entry.payload, origin);
    }
  } finally {
    feed.inFlight = false;
  }
}

/**
 * Hold the state feed for `pluginId` on `deviceId` (a bare agent device id).
 * Returns the release; the last release stops the poll. Inert in demo mode.
 */
export function acquireAgentStateFeed(pluginId: string, deviceId: string): () => void {
  if (isDemoMode()) return () => {};
  const key = `${deviceId}|${pluginId}`;
  let feed = feeds.get(key);
  if (feed) {
    feed.refs += 1;
  } else {
    const created: Feed = {
      refs: 1,
      inFlight: false,
      published: new Map(),
      timer: setInterval(() => void tick(key, created, pluginId, deviceId), AGENT_STATE_POLL_MS),
    };
    feeds.set(key, created);
    void tick(key, created, pluginId, deviceId);
    feed = created;
  }
  const held = feed;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.refs -= 1;
    if (held.refs > 0) return;
    clearInterval(held.timer);
    if (feeds.get(key) === held) feeds.delete(key);
  };
}
