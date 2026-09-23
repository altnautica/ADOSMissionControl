/**
 * @module config/endpoints
 * @description Single source of truth for the managed-deployment endpoint
 * defaults (MQTT broker, video relay, plugin registry).
 *
 * These constants are the FALLBACK only. At runtime the GCS resolves each
 * endpoint from the public `clientConfig` Convex query (or, for the registry,
 * a build-time env var) and uses these values only when neither is set. A
 * self-hosted deployment overrides them by setting the matching `clientConfig`
 * field (or env var); it never needs to edit this file or the call sites.
 *
 * The official deployment publishes its own endpoints through `clientConfig`,
 * so even the hosted product reaches them via the same resolution path these
 * constants back-stop. Keeping the literals here (instead of scattered across
 * transports) means there is one place to read, and one override path.
 * @license GPL-3.0-only
 */

/** Full WebSocket URL of the managed MQTT broker (telemetry + WebRTC signaling). */
export const OFFICIAL_MQTT_WS_URL = "wss://mqtt.altnautica.com/mqtt";

/** Base WebSocket URL of the managed video relay (fMP4 over WS). */
export const OFFICIAL_VIDEO_RELAY_URL = "wss://video.altnautica.com";

/** Base URL of the managed plugin registry. Not yet live; env-overridable. */
export const OFFICIAL_PLUGIN_REGISTRY_URL = "https://registry.ados.altnautica.com";
