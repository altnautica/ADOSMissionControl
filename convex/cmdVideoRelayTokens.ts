/**
 * Viewer tokens for the cloud video relay.
 *
 * The relay refuses every WebSocket upgrade without a token scoped to the
 * device in the stream path. This action is the only place a browser obtains
 * one: it proves the signed-in operator owns the paired device, then mints a
 * five-minute token with the secret the relay shares (`VIDEO_RELAY_SECRET`).
 *
 * A deployment without that secret has no relay to talk to, so it answers
 * `not-configured` rather than failing; the viewer reports that state instead
 * of retrying a stream that can never open.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwnedDroneByDeviceId } from "./cmdDroneAccess";
import { mintVideoRelayToken } from "./lib/videoRelayToken";

export type VideoRelayTokenResult =
  | { status: "ok"; token: string; expiresAt: number }
  | { status: "not-configured" };

/** Throws unless the caller is signed in and owns `deviceId`. */
export const assertOwnsDevice = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }): Promise<null> => {
    await requireOwnedDroneByDeviceId(ctx, deviceId);
    return null;
  },
});

export const mint = action({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }): Promise<VideoRelayTokenResult> => {
    await ctx.runQuery(internal.cmdVideoRelayTokens.assertOwnsDevice, { deviceId });
    const secret = process.env.VIDEO_RELAY_SECRET ?? "";
    if (!secret) return { status: "not-configured" };
    const { token, expiresAt } = await mintVideoRelayToken(deviceId, secret, Date.now());
    return { status: "ok", token, expiresAt };
  },
});
