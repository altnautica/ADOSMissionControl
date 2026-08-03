import { getAuthUserId } from "@convex-dev/auth/server";

import { query } from "./_generated/server";

/**
 * Client configuration that is safe for anyone to read.
 *
 * Deliberately carries NO credential. It used to also return the shared MQTT
 * viewer password, from a query with no auth check at all — so anyone who could
 * reach this deployment, signed in or not, could take it, and that principal
 * holds `read ados/#` on the broker: every topic of every drone in the fleet,
 * not merely the caller's own. Live telemetry, position and status for the whole
 * fleet, to anyone who asked.
 *
 * The credential moved to `getBrokerViewerCredential` below rather than this
 * whole query being gated, because the gate would have had collateral: the
 * public `/simulate` route reads `cesiumIonToken` from here with no session, and
 * requiring one would have blanked a working 3D map to fix an unrelated leak.
 * Splitting the payload closes the hole and leaves the public fields public.
 */
export const getClientConfig = query({
  args: {},
  handler: async () => {
    const rawLimit = process.env.AI_PID_WEEKLY_LIMIT;
    const parsed = rawLimit ? parseInt(rawLimit, 10) : NaN;
    return {
      cesiumIonToken: process.env.CESIUM_ION_TOKEN ?? null,
      aiPidWeeklyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 3,
      mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? null,
      videoRelayUrl: process.env.VIDEO_RELAY_URL ?? null,
    };
  },
});

/**
 * The broker's read-only viewer credential, for a signed-in operator only.
 *
 * Returns `null` rather than throwing when there is no session: a signed-out
 * visitor is a normal state on a page that also renders public content, and the
 * caller already treats an absent credential as "no cloud telemetry" — so an
 * exception here would turn a routine state into an error boundary.
 *
 * This is a HOLDING position, not the destination. The credential is still
 * shared across every operator and still grants `read ados/#` — the whole fleet
 * — so an operator who should see one drone can subscribe to all of them. The
 * fix is per-operator read grants scoped to owned devices, reusing the mint and
 * ownership machinery already built for the write side; it is blocked on
 * establishing how the broker's credential files are regenerated in production.
 * What this changes is that the credential is no longer world-readable.
 */
export const getBrokerViewerCredential = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return {
      mqttViewerUsername: process.env.MQTT_VIEWER_USERNAME ?? "gcs-viewer",
      mqttViewerPassword: process.env.MQTT_VIEWER_PASSWORD ?? null,
    };
  },
});
