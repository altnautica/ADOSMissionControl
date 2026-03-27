/**
 * Follow-me controller.
 *
 * Streams GCS position to the drone at 4Hz via guidedGoto().
 * Uses the browser Geolocation API via gcs-location-store.
 * Auto-pauses on GPS loss (>5s without update).
 *
 * @module follow-me
 * @license GPL-3.0-only
 */

import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";

const SEND_INTERVAL_MS = 250; // 4 Hz
const GPS_TIMEOUT_MS = 5000;  // pause after 5s without GCS position update

let sendInterval: ReturnType<typeof setInterval> | null = null;
let gpsCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start follow-me mode. Begins streaming GCS position to the drone.
 */
export async function startFollowMe(protocol: DroneProtocol, altitudeOffset = 10): Promise<boolean> {
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

    // Get current drone altitude as base, add offset
    const dronePos = useTelemetryStore.getState().position.latest();
    const baseAlt = dronePos?.relativeAlt ?? 10;
    const targetAlt = Math.max(baseAlt, altitudeOffset);

    // Send guided goto to GCS position
    protocol.guidedGoto(gcsPos.lat, gcsPos.lon, targetAlt);

    // Update store
    useFollowMeStore.getState().updateAccuracy(gcsPos.accuracy);
    useFollowMeStore.getState().updateTimestamp();
  }, SEND_INTERVAL_MS);

  // GPS loss detection
  gpsCheckInterval = setInterval(() => {
    const gcsPos = useGcsLocationStore.getState().position;
    const { isActive, isPaused } = useFollowMeStore.getState();

    if (!isActive) return;

    if (!gcsPos || Date.now() - gcsPos.timestamp > GPS_TIMEOUT_MS) {
      if (!isPaused) {
        useFollowMeStore.getState().pause();
      }
    } else if (isPaused) {
      // GPS recovered
      useFollowMeStore.getState().resume();
    }
  }, 1000);

  return true;
}

/**
 * Stop follow-me mode.
 */
export function stopFollowMe(): void {
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  if (gpsCheckInterval) {
    clearInterval(gpsCheckInterval);
    gpsCheckInterval = null;
  }

  useFollowMeStore.getState().deactivate();
}
