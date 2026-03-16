import mqtt from "mqtt";

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const CONVEX_URL = process.env.CONVEX_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

if (!CONVEX_URL) {
  console.error("CONVEX_URL environment variable is required");
  process.exit(1);
}

const DEBOUNCE_MS = 3000;
const lastSent = new Map<string, number>();

function shouldSend(deviceId: string): boolean {
  const now = Date.now();
  const last = lastSent.get(deviceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastSent.set(deviceId, now);
  // Evict oldest entry if map grows too large (prevent unbounded memory)
  if (lastSent.size > 1000) {
    const oldest = lastSent.entries().next().value;
    if (oldest) lastSent.delete(oldest[0]);
  }
  return true;
}

async function forwardToConvex(
  deviceId: string,
  topic: string,
  payload: Record<string, unknown>
): Promise<void> {
  const endpoint = `${CONVEX_URL}/agent/status`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, topic, ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(
        `Convex POST failed: ${res.status} ${res.statusText} for device ${deviceId}`
      );
    }
  } catch (err) {
    console.error(`Convex POST error for device ${deviceId}:`, err);
  }
}

function start(): void {
  console.log(`Connecting to MQTT broker at ${MQTT_BROKER_URL}`);

  const client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    reconnectPeriod: 5000,
    clean: true,
  });

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe(["ados/+/status", "ados/+/telemetry"], (err, granted) => {
      if (err) {
        console.error("Subscribe error:", err);
        return;
      }
      for (const g of granted ?? []) {
        console.log(`Subscribed to ${g.topic} (qos ${g.qos})`);
      }
    });
  });

  client.on("message", (topic: string, message: Buffer) => {
    const parts = topic.split("/");
    if (parts.length < 3) return;

    const deviceId = parts[1];
    if (!shouldSend(deviceId)) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      console.error(`Invalid JSON from ${topic}`);
      return;
    }

    forwardToConvex(deviceId, topic, payload);
  });

  client.on("reconnect", () => {
    console.log("Reconnecting to MQTT broker...");
  });

  client.on("disconnect", () => {
    console.log("Disconnected from MQTT broker");
  });

  client.on("error", (err) => {
    console.error("MQTT error:", err);
  });

  client.on("offline", () => {
    console.log("MQTT client offline");
  });

  process.on("SIGINT", () => {
    console.log("Shutting down...");
    client.end(false, () => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    client.end(false, () => process.exit(0));
  });
}

start();
