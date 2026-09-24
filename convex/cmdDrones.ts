/**
 * @module cmdDrones
 * @description Convex functions for paired drones management.
 * User-facing functions require authentication; the agent-facing reads are
 * internal and reached through HTTP routes that validate the device API key.
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * A paired-drone row as the row's OWNER is allowed to see it.
 *
 * An explicit field list, not a rest-spread delete. That is the durable part:
 * a credential-shaped column added to `cmd_drones` later is omitted from
 * every public read by default, and has to be named here deliberately to be
 * published. The previous `.collect()` of the raw document published new
 * columns automatically.
 *
 * `apiKey` IS in the list, deliberately. It authenticates `/agent/status`,
 * `/agent/commands`, `/agent/commands/ack` and `/agent/logd/window`, and it
 * is the device's MQTT broker principal — and for a cloud-paired node this
 * row is the ONLY place the browser can obtain it, because such a node was
 * never paired on this network and has no local pairing record. Five call
 * sites depend on that:
 *
 *   - `src/components/command/pairing/use-pairing-flow.ts` — the post-pair
 *     connect, i.e. the whole "pair over the cloud, then operate" path
 *   - `src/lib/agent/theme-sync.ts` — push-theme-to-all-agents needs every
 *     owned node's key by construction
 *   - `src/lib/agent/config-access.ts` — without a key the resolver reports
 *     mode "none" and settings silently go read-only
 *   - `src/stores/agent-connection/cloud-state.ts` — the LAN-direct key for
 *     a cloud node, which otherwise degrades to relay
 *   - `src/hooks/use-fleet-nodes.ts` — `FleetNodeEntry.apiKey`, consumed by
 *     node-click, link-up, the PIN surface and the config writer
 *
 * So the guard here is ownership, not omission: every read below is scoped
 * to `getAuthUserId(ctx)` and returns nothing at all to an anonymous or
 * non-owner caller. `cmdDrones.getAgentKey` is the scoped single-device read
 * that new code uses instead of taking the key off a fleet-wide list.
 */
interface DroneRowForOwner {
  _id: Id<"cmd_drones">;
  _creationTime: number;
  userId: string;
  deviceId: string;
  name: string;
  apiKey: string;
  agentVersion?: string;
  board?: string;
  tier?: number;
  os?: string;
  mdnsHost?: string;
  lastIp?: string;
  lastSeen?: number;
  fcConnected?: boolean;
  pairedAt: number;
  runtimeMode?: string;
  manualMavlinkWsUrl?: string;
  navigationGpsDenied?: boolean;
  profile?: string;
  profileSource?: string;
  role?: string;
  installedPluginIds?: string[];
  attachedDisplayType?: string;
  peerDeviceId?: string | null;
  peerRssiDbm?: number | null;
  cameraState?: string | null;
  fcLinkHint?: string;
  cloudPosture?: string;
}

function toOwnerRow(row: Doc<"cmd_drones">): DroneRowForOwner {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    userId: row.userId,
    deviceId: row.deviceId,
    name: row.name,
    apiKey: row.apiKey,
    agentVersion: row.agentVersion,
    board: row.board,
    tier: row.tier,
    os: row.os,
    mdnsHost: row.mdnsHost,
    lastIp: row.lastIp,
    lastSeen: row.lastSeen,
    fcConnected: row.fcConnected,
    pairedAt: row.pairedAt,
    runtimeMode: row.runtimeMode,
    manualMavlinkWsUrl: row.manualMavlinkWsUrl,
    navigationGpsDenied: row.navigationGpsDenied,
    profile: row.profile,
    profileSource: row.profileSource,
    role: row.role,
    installedPluginIds: row.installedPluginIds,
    attachedDisplayType: row.attachedDisplayType,
    peerDeviceId: row.peerDeviceId,
    peerRssiDbm: row.peerRssiDbm,
    cameraState: row.cameraState,
    fcLinkHint: row.fcLinkHint,
    cloudPosture: row.cloudPosture,
  };
}

/** List every drone owned by the authenticated caller. Empty for anyone
 *  else — see `DroneRowForOwner` for what the projection publishes. */
export const listMyDrones = query({
  args: {},
  handler: async (ctx): Promise<DroneRowForOwner[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.map(toOwnerRow);
  },
});

/** One drone by id, scoped to its owner. Null for an anonymous caller and
 *  null for a signed-in caller who does not own the row. */
export const getDrone = query({
  args: { droneId: v.id("cmd_drones") },
  handler: async (ctx, { droneId }): Promise<DroneRowForOwner | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) return null;
    return toOwnerRow(drone);
  },
});

/**
 * Return the agent credential for ONE owned device.
 *
 * The browser needs this key to reach the agent's own REST surface directly
 * over the LAN for a cloud-paired node that was never paired on this network.
 * It is a separate, single-device call rather than a field on the fleet read
 * so the credential is fetched for the node actually being operated, and so
 * the read is greppable and auditable.
 *
 * Returns null — never throws — for unauthenticated, unknown or unowned
 * devices, so a render-time read is safe.
 */
export const getAgentKey = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }): Promise<{ apiKey: string } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
    if (!drone || drone.userId !== userId) return null;
    if (!drone.apiKey) return null;
    return { apiKey: drone.apiKey };
  },
});

/** Get a drone by deviceId string (for HTTP route validation). */
export const getDroneByDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    return await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
  },
});

/** Rename a paired drone. */
export const renameDrone = mutation({
  args: { droneId: v.id("cmd_drones"), name: v.string() },
  handler: async (ctx, { droneId, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(droneId, { name });
  },
});

/**
 * Unpair a drone: delete the pairing row AND every row keyed to its device.
 *
 * Deleting `cmd_drones` alone left the status row (last LAN IP, mDNS host, the
 * whole telemetry snapshot), any queued commands and its exported log windows
 * behind. `cmd_droneStatus` is keyed by deviceId with no userId, so re-pairing
 * the same device from a different account adopted the previous operator's
 * last-known state, and no retention sweep could reach any of it. Ownership is
 * checked here; the cascade itself is internal and bounded.
 */
export const unpairDrone = mutation({
  args: { droneId: v.id("cmd_drones") },
  // Explicit return type: the cascade runs an internal mutation declared in
  // another module, and inferring through `internal` from here would make this
  // file's exported types self-referential. `void` keeps the mutation's
  // published shape exactly as it was.
  handler: async (ctx, { droneId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) throw new Error("Not found");
    await ctx.runMutation(internal.cmdPairing.wipeByDeviceIds, {
      deviceIds: [drone.deviceId],
    });
  },
});

/** Deduplicate drone records — keeps newest per (userId, deviceId). */
export const deduplicateDrones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("cmd_drones").collect();
    const groups = new Map<string, typeof all>();
    for (const d of all) {
      const key = `${d.userId}:${d.deviceId}`;
      groups.set(key, [...(groups.get(key) || []), d]);
    }
    let deleted = 0;
    for (const [, drones] of groups) {
      if (drones.length <= 1) continue;
      drones.sort((a, b) => (b.pairedAt || 0) - (a.pairedAt || 0));
      for (let i = 1; i < drones.length; i++) {
        await ctx.db.delete(drones[i]._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
