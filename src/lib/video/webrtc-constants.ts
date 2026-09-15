/**
 * Tuned timeouts and STUN server inventory for the WebRTC client.
 *
 * Pinned constants live here so the helper module + tests + future cloud
 * relay paths can share the same values without circular imports through
 * the main client.
 *
 * @license GPL-3.0-only
 */

/**
 * A pending-timer handle, in either host environment.
 *
 * `setTimeout` returns `number` under `lib.dom` and a `Timeout` object under
 * Node's types, and this tree is checked against both. Named once here so a
 * consumer imports a type instead of restating the conditional at each
 * declaration site.
 */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Per-stage MQTT timeouts. Slow cellular initial signaling needs more
 * headroom than LAN-direct paths get.
 */
export const MQTT_CONNECT_TIMEOUT_MS = 8000;
export const MQTT_ANSWER_TIMEOUT_MS = 12000;

/** ICE gathering ceiling for cross-network signaling. */
export const ICE_GATHER_TIMEOUT_MS = 8000;

/** ontrack arrival ceiling for cross-network signaling. */
export const ONTRACK_TIMEOUT_MS = 8000;

/**
 * LAN paths get tighter timeouts. Loopback or RFC1918 destinations either
 * respond within a couple of seconds or will not respond at all.
 */
export const LAN_ICE_GATHER_TIMEOUT_MS = 3000;
export const LAN_ONTRACK_TIMEOUT_MS = 8000;

/**
 * Multi-vendor STUN server set. More candidates means a higher chance of
 * finding a working pair on cellular and corporate networks. Cloudflare
 * anycast reaches many regions, Twilio adds an independent network path,
 * Google stun2 is a third Google POP.
 */
export const CROSS_NETWORK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
];
