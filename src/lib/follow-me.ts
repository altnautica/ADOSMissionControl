/**
 * Follow-me controller.
 *
 * Streams the GCS position to one drone as MAV_CMD_DO_REPOSITION, up to 4 Hz.
 * The session is bound to the drone it was started on and reads that drone's
 * own state from the node registry, never the selected-drone telemetry store,
 * which follows the operator's selection.
 *
 * Only the reposition that starts the session asks the autopilot to change
 * into its guided mode. Every later one is sent without that flag, so a mode
 * the pilot, a failsafe or another command picks is never overridden, and
 * leaving the guided mode ends the session.
 *
 * The session ends by itself when any of these holds for the followed drone:
 * it left the guided mode after the first accepted reposition (or never
 * entered it), it disarmed, it was removed or its link dropped, its altitude
 * report is stale, another drone was selected, three repositions in a row were
 * not accepted, or the GCS location fix is stale.
 *
 * @module follow-me
 * @license GPL-3.0-only
 */

import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { isFresh } from "@/lib/telemetry/freshness";
import { notifySkill } from "@/lib/skills/registry";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";
import type { CommandResult } from "@/lib/protocol/types/core";
import type { FlightMode } from "@/lib/types";

const SEND_INTERVAL_MS = 250;        // 4 Hz
const GPS_TIMEOUT_MS = 5000;         // a GCS fix older than this is not a target

/**
 * Reported horizontal accuracy above which a browser fix is not a position
 * this may fly an aircraft to. A Wi-Fi or IP-fallback fix routinely reports
 * hundreds to thousands of metres while being fresh.
 */
const MAX_ACCURACY_M = 50;

/** Consecutive non-accepted repositions that end the session. */
const MAX_REFUSED_IN_A_ROW = 3;

/**
 * How long after the first accepted reposition the vehicle may take to report
 * the guided mode. The ack arrives before the next heartbeat shows the mode.
 */
const MODE_SETTLE_MS = 3000;

interface FollowSession {
  droneId: string;
  protocol: DroneProtocol;
  /** The mode a reposition puts this autopilot in. */
  followMode: FlightMode;
  minAltitude: number;
  startedAt: number;
  /** When the first reposition was accepted, or null before that. */
  acceptedAt: number | null;
  /** The vehicle has reported `followMode` since the first acceptance. */
  sawFollowMode: boolean;
  /** A reposition is awaiting its ack; the next one waits for it. */
  inFlight: boolean;
  refusedInARow: number;
  timer: ReturnType<typeof setInterval>;
}

let session: FollowSession | null = null;
let starting = false;

function endSession(reason: string | null): void {
  if (!session) return;
  clearInterval(session.timer);
  session = null;
  useFollowMeStore.getState().deactivate();
  if (reason) notifySkill(`Follow-me stopped: ${reason}`, "warning");
}

/** Why the session must end now, or null to keep following. */
function endReason(s: FollowSession, now: number): string | null {
  const manager = useDroneManager.getState();
  const drone = manager.drones.get(s.droneId);
  if (!drone || drone.protocol !== s.protocol) return "the drone was disconnected";
  if (!s.protocol.isConnected) return "the link to the drone dropped";
  if (manager.selectedDroneId !== s.droneId) return "another drone was selected";

  const fc = useNodeRegistryStore.getState().getEntry(s.droneId)?.fc;
  if (fc?.armState === "disarmed") return "the drone disarmed";
  if (!fc?.position || !isFresh(fc.position.timestamp, now)) {
    return "the drone's altitude report is not current";
  }

  if (s.acceptedAt !== null) {
    if (fc.flightMode === s.followMode) {
      s.sawFollowMode = true;
    } else if (s.sawFollowMode) {
      return `the drone left ${s.followMode} (now ${fc.flightMode ?? "unknown"})`;
    } else if (now - s.acceptedAt > MODE_SETTLE_MS) {
      return `the drone did not enter ${s.followMode}`;
    }
  }

  const fix = useGcsLocationStore.getState().position;
  // Only a fix taken after the session started counts: a stored fix from an
  // earlier probe may be hours and kilometres away.
  const newest = fix && fix.timestamp >= s.startedAt ? fix.timestamp : s.startedAt;
  if (now - newest > GPS_TIMEOUT_MS) return "the GCS location fix is stale";
  return null;
}

function onReply(s: FollowSession, result: CommandResult): void {
  if (session !== s) return;
  s.inFlight = false;
  if (result.success) {
    if (s.acceptedAt === null) s.acceptedAt = Date.now();
    s.refusedInARow = 0;
    useFollowMeStore.getState().updateTimestamp();
    return;
  }
  s.refusedInARow += 1;
  if (s.refusedInARow >= MAX_REFUSED_IN_A_ROW) {
    endSession(
      `the drone did not accept ${MAX_REFUSED_IN_A_ROW} repositions in a row` +
        (result.message ? ` (${result.message})` : ""),
    );
  }
}

function sendReposition(s: FollowSession, lat: number, lon: number, alt: number): void {
  s.inFlight = true;
  let reply: Promise<CommandResult>;
  try {
    reply = s.protocol.guidedGoto(lat, lon, alt, { changeMode: s.acceptedAt === null });
  } catch (err) {
    reply = Promise.resolve({ success: false, resultCode: -1, message: String(err) });
  }
  reply.then(
    (result) => onReply(s, result),
    (err: unknown) => onReply(s, { success: false, resultCode: -1, message: String(err) }),
  );
}

function tick(s: FollowSession): void {
  const now = Date.now();
  const reason = endReason(s, now);
  if (reason) {
    endSession(reason);
    return;
  }
  if (s.inFlight) return;

  // endReason proved the position is present and fresh.
  const position = useNodeRegistryStore.getState().getEntry(s.droneId)!.fc.position!;
  // Altitude FLOOR, not a fixed altitude: hold the followed drone's own
  // current height above home, never below the minimum.
  const targetAlt = Math.max(position.relativeAlt, Math.max(s.minAltitude, 2));

  const fix = useGcsLocationStore.getState().position;
  if (!fix || fix.timestamp < s.startedAt) return; // waiting for a current fix

  const store = useFollowMeStore.getState();
  store.updateAccuracy(Number.isFinite(fix.accuracy) ? fix.accuracy : null);
  if (Number.isFinite(fix.accuracy) && fix.accuracy > MAX_ACCURACY_M) {
    // An imprecise fix is not a flight target. Hold where the drone is rather
    // than leave it flying to the last target, and resume when it improves.
    if (!store.isPaused) {
      store.pause();
      if (s.acceptedAt !== null) sendReposition(s, position.lat, position.lon, targetAlt);
    }
    return;
  }
  if (store.isPaused) store.resume();
  sendReposition(s, fix.lat, fix.lon, targetAlt);
}

/** Outcome of {@link startFollowMe}: a refusal names its reason for the operator. */
export type FollowMeStart = { ok: true } | { ok: false; reason: string };

/**
 * Start following the GCS with drone `droneId`.
 * @param droneId - drone-manager id of the drone to command
 * @param minAltitude - Minimum altitude in meters (drone won't go below this). Default 10m.
 * @returns a refusal with its reason when a session is running, the drone is
 *   not connected and armed, or the GCS location cannot be read.
 */
export async function startFollowMe(droneId: string, minAltitude = 10): Promise<FollowMeStart> {
  if (session || starting) return { ok: false, reason: "a follow-me session is already running" };
  const drone = useDroneManager.getState().drones.get(droneId);
  if (!drone?.protocol.isConnected) return { ok: false, reason: "the drone is not connected" };
  if (useNodeRegistryStore.getState().getEntry(droneId)?.fc.armState !== "armed") {
    return { ok: false, reason: "the drone is not armed" };
  }

  starting = true;
  try {
    const startedAt = Date.now();
    const gcsStore = useGcsLocationStore.getState();
    if (gcsStore.permission !== "granted") {
      const perm = await gcsStore.requestPermission();
      if (perm !== "granted") {
        return { ok: false, reason: "location permission was not granted to this browser" };
      }
    }
    gcsStore.startWatching();

    const protocol = drone.protocol;
    const s: FollowSession = {
      droneId,
      protocol,
      // PX4 answers a reposition by entering Hold, which reads as LOITER.
      followMode: protocol.getVehicleInfo()?.firmwareType === "px4" ? "LOITER" : "GUIDED",
      minAltitude,
      startedAt,
      acceptedAt: null,
      sawFollowMode: false,
      inFlight: false,
      refusedInARow: 0,
      timer: setInterval(() => tick(s), SEND_INTERVAL_MS),
    };
    session = s;
    useFollowMeStore.getState().activate(droneId, drone.name);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `the GCS location could not be read (${String(err)})` };
  } finally {
    starting = false;
  }
}

/** Stop follow-me. The operator's stop, so nothing is announced. */
export function stopFollowMe(): void {
  endSession(null);
}
