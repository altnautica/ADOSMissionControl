/**
 * Follow-me controller.
 *
 * Streams GCS position to the drone at 4Hz via guidedGoto().
 * Uses the browser Geolocation API via gcs-location-store.
 * Auto-pauses on GPS loss (>5s without update).
 * Auto-stops after 30s of continuous GPS loss.
 *
 * @module follow-me
 * @license GPL-3.0-only
 */

import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { useFollowMeStore } from "@/stores/follow-me-store";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";

const SEND_INTERVAL_MS = 250;       // 4 Hz
const GPS_TIMEOUT_MS = 5000;         // pause after 5s without GCS position update
const GPS_STOP_TIMEOUT_MS = 30000;   // stop entirely after 30s GPS loss

let sendInterval: ReturnType<typeof setInterval> | null = null;
let gpsCheckInterval: ReturnType<typeof setInterval> | null = null;
let gpsLostSince = 0;

function cleanup(): void {
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  if (gpsCheckInterval) {
    clearInterval(gpsCheckInterval);
    gpsCheckInterval = null;
  }
  gpsLostSince = 0;
}

/**
 * Start follow-me mode. Begins streaming GCS position to the drone.
 * @param protocol - Connected drone protocol
 * @param minAltitude - Minimum altitude in meters (drone won't go below this). Default 10m.
 */
export async function startFollowMe(protocol: DroneProtocol, minAltitude = 10): Promise<boolean> {
  // Guard against double-start
  if (sendInterval || gpsCheckInterval) {
    return false;
  }

  const gcsStore = useGcsLocationStore.getState();
  const followStore = useFollowMeStore.getState();

  // Request geolocation permission if needed
  if (gcsStore.permission !== "granted") {
    const perm = await gcsStore.requestPermission();
    if (perm !== "granted") return false;
  }

  // Start watching GCS position
  gcsStore.startWatching();

  // Activate follow-me
  followStore.activate();

  // Position sending loop at 4Hz
  sendInterval = setInterval(() => {
    const { isActive, isPaused } = useFollowMeStore.getState();
    if (!isActive || isPaused) return;

    if (!protocol.isConnected) {
      stopFollowMe();
      return;
    }

    const gcsPos = useGcsLocationStore.getState().position;
    if (!gcsPos) return;

    // Use minimum altitude to prevent drone from descending
    const targetAlt = Math.max(minAltitude, 2);

    // Fire-and-forget: guidedGoto sends DO_REPOSITION synchronously
    // (it encodes and sends immediately, no ACK wait)
    try {
      protocol.guidedGoto(gcsPos.lat, gcsPos.lon, targetAlt);
    } catch {
      // Protocol error; will be caught by disconnect check next tick
    }

    // Update store
    useFollowMeStore.getState().updateAccuracy(gcsPos.accuracy);
    useFollowMeStore.getState().updateTimestamp();
  }, SEND_INTERVAL_MS);

  // GPS loss detection
  gpsCheckInterval = setInterval(() => {
    const gcsPos = useGcsLocationStore.getState().position;
    const { isActive, isPaused } = useFollowMeStore.getState();

    if (!isActive) return;

    const now = Date.now();
    const isGpsStale = !gcsPos || (now - gcsPos.timestamp > GPS_TIMEOUT_MS);

    if (isGpsStale) {
      if (!isPaused) {
        useFollowMeStore.getState().pause();
        gpsLostSince = gpsLostSince || now;
      }

      // Auto-stop after prolonged GPS loss
      if (gpsLostSince && now - gpsLostSince > GPS_STOP_TIMEOUT_MS) {
        stopFollowMe();
      }
    } else if (isPaused) {
      // GPS recovered
      useFollowMeStore.getState().resume();
      gpsLostSince = 0;
    }
  }, 1000);

  return true;
}

/**
 * Stop follow-me mode.
 */
export function stopFollowMe(): void {
  cleanup();
  useFollowMeStore.getState().deactivate();
}
