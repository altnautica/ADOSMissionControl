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
 * The shared viewer credential is gone entirely now, auth-gated variant
 * included. A browser's broker credential is the operator's own write grant from
 * `cmdMqttControlGrants.mint`: scoped to the drones they own, one hour long,
 * revocable, and returned in plaintext exactly once so it can be held in memory
 * rather than fetched again. Nothing here needs a session, which is what keeps
 * the public `/simulate` route's `cesiumIonToken` read working with no
 * collateral gate.
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
