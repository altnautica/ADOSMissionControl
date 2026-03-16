import { query } from "./_generated/server";

export const getClientConfig = query({
  args: {},
  handler: async () => {
    const rawLimit = process.env.AI_PID_WEEKLY_LIMIT;
    const parsed = rawLimit ? parseInt(rawLimit, 10) : NaN;
    return {
      cesiumIonToken: process.env.CESIUM_ION_TOKEN ?? null,
      openAipApiKey: process.env.OPENAIP_API_KEY ?? null,
      aiPidWeeklyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 3,
      mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? null,
      videoRelayUrl: process.env.VIDEO_RELAY_URL ?? null,
    };
  },
});
